import { createHash } from "node:crypto";
import { OLIVIA_CAPABILITIES, assertExtendedCapability } from "../../../../src/shared/oliviaCapabilities.mjs";
import { validateSchema, safeId, oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { buildLocationPayload, buildModuleRecordPayload } from "../../../../src/shared/managementWritePlans.mjs";
import { buildStockTransferWrites } from "../../../../src/shared/stockTransferWritePlans.mjs";
import { buildMasterProductPayload } from "../../../../src/shared/productWritePlans.mjs";
import { reconcileTransferLine, assertUniqueInventoryProducts } from "../../../../src/modules/inventory/domain/inventory.js";
import { buildCustomerDraft, customerDocumentId, customerEnrichment } from "../../../../src/gestion/customers/customerDomain.js";
import { validateFinancialEntry } from "../../../../src/gestion/finance/financeDomain.js";
import { argentinaDateFromKey } from "../../../../src/modules/locations/domain/time.js";
import { can, canAccessAdministration, normalizedRole } from "../../../../src/gestion/permissions.js";
import { arcaSourceTypeForSale } from "../../../../src/shared/arcaSourceType.mjs";
const normalize = (value) => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter((key) => key !== "id" && !key.startsWith("__")).sort().map((key) => [key, normalize(value[key])])) : value;
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
const ownerPath = (type, id) => `${type === "warehouse" ? "warehouses" : "locations"}/${safeId(id)}`;
const stockPath = (type, id, productId) => `${type === "warehouse" ? "warehouseStock" : "locationStock"}/${safeId(id)}/items/${safeId(productId)}`;
const unavailable = (row) => !row || row.deleted || row.active === false;
const generic = { prepare_shipment_create: ["shipping", "shipments", "pending"], prepare_shipment_update: ["shipping", "shipments", null],
  prepare_alert_create: ["alerts", "alerts", "new"], prepare_supplier_create: ["suppliers", "suppliers", "active"],
  prepare_social_lead_create: ["social", "socialLeads", "new"], prepare_marketing_campaign: ["marketing", "campaigns", "draft"], prepare_warehouse_create: ["warehouse", "warehouses", "active"] };
export async function extendedOperationPlan({ session, toolName, args, store, now = new Date(), entityId = "preview", correlation = {} }) {
  assertExtendedCapability(session, toolName);
  validateSchema(args, OLIVIA_CAPABILITIES[toolName]?.parameters);
  const profile = { ...session.profile, id: session.uid }, documents = {};
  const read = async (path) => { const row = await store.get(path); documents[path] = row || null; return row ? { ...row, id: path.split("/").at(-1) } : null; };
  let writes = [], summary, module = OLIVIA_CAPABILITIES[toolName].module, affectedId = entityId, navigation = null;
  if (toolName === "prepare_stock_transfer") {
    if (!args.originId || !args.destinationId || !args.lines.length || !args.reason.trim()) return { state: "DATOS_INCOMPLETOS", missing: ["origen", "destino", "productos", "motivo"], summary: "Indicá origen, destino, mercadería y motivo. Confirmá también las cantidades preparadas y recibidas físicamente." };
    if (args.originType === args.destinationType && args.originId === args.destinationId) throw oliviaError("same-inventory", "El origen y el destino deben ser distintos.", 422);
    assertUniqueInventoryProducts(args.lines);
    const origin = await read(ownerPath(args.originType, args.originId)), destination = await read(ownerPath(args.destinationType, args.destinationId));
    if (unavailable(origin) || unavailable(destination)) throw oliviaError("inventory-unavailable", "El origen o destino no está disponible.", 409);
    if ((args.originType === "location" || args.destinationType === "location") && !can(profile, "locations", "viewStock")) throw oliviaError("permission-denied", "No tenés permiso para consultar el stock de ubicaciones.", 403);
    const prepared = [];
    for (const line of args.lines) {
      const product = await read(`products/${safeId(line.productId)}`), originRef = stockPath(args.originType, args.originId, line.productId), destinationRef = stockPath(args.destinationType, args.destinationId, line.productId);
      const originStock = await read(originRef), destinationStock = await read(destinationRef);
      if (unavailable(product) || unavailable(originStock)) throw oliviaError("product-unavailable", "Un producto no está habilitado en el inventario de origen.", 409);
      const reconciled = reconcileTransferLine({ ...line, productName: product.name }, Number(originStock.currentStock || 0));
      prepared.push({ line, productId: line.productId, product, ...reconciled, originStockRef: originRef, originStock, destinationStockRef: destinationRef, destinationStock: destinationStock?.deleted ? null : destinationStock });
    }
    const plan = buildStockTransferWrites({ prepared, origin: { ...origin, type: args.originType }, destination: { ...destination, type: args.destinationType, note: args.reason }, profile, carrierName: args.carrierName, transferId: entityId, stamp: now, correlation });
    writes = plan.writes;
    for (const write of writes) if (write.type === "create" && documents[write.path]?.deleted) {
      write.type = "update";
      write.updateMask = [...new Set([...Object.keys(documents[write.path]).filter((key) => key !== "id" && !key.startsWith("__")), ...Object.keys(write.data)])];
    }
    summary = `Transferir de ${origin.name} a ${destination.name}: ${prepared.map((line) => `${line.quantity} × ${line.product.name}; preparadas ${line.preparedQuantity}, recibidas ${line.receivedQuantity}, faltantes ${line.missingQuantity}, pérdidas ${line.lostQuantity}. Origen ${line.originStock.currentStock} → ${line.originStock.currentStock - line.quantity}; destino ${Number(line.destinationStock?.currentStock || 0)} → ${Number(line.destinationStock?.currentStock || 0) + line.receivedQuantity}`).join("; ")}. Motivo: ${args.reason}. Responsable: ${args.carrierName || profile.name || "Usuario actual"}. Se registra salida y recepción física al confirmar.`;
  } else if (["prepare_create_location", "prepare_update_location"].includes(toolName)) {
    const editing = toolName === "prepare_update_location";
    if (editing && !args.locationId) return { state: "DATOS_INCOMPLETOS", summary: "Indicá la ubicación a actualizar.", missing: ["locationId"] };
    if (!editing && args.locationId) throw oliviaError("invalid-input", "El alta requiere locationId null; para editar usá la herramienta de actualización.");
    affectedId = editing ? args.locationId : entityId;
    const previous = editing ? await read(`locations/${safeId(affectedId)}`) : null;
    if (editing && (!previous || previous.deleted)) throw oliviaError("location-unavailable", "La ubicación ya no está disponible.", 409);
    const startAt = args.startDate ? argentinaDateFromKey(args.startDate) : null, endAt = args.endDate ? new Date(argentinaDateFromKey(args.endDate).getTime() + 86400000 - 1) : null;
    const values = { ...args, scheduleStartAt: startAt?.toISOString() || "", scheduleEndAt: endAt?.toISOString() || "" };
    const payload = buildLocationPayload({ values, previous, profile, stamp: now, startAt, endAt });
    writes = [{ type: editing ? "update" : "create", path: `locations/${affectedId}`, data: payload }];
    summary = `${editing ? "Actualizar" : "Crear"} ${args.type === "fair" ? "feria" : args.type === "event" ? "evento" : "local"} ${args.name}. Prefijo ${args.codePrefix}. Fechas ${args.startDate || "sin inicio"} → ${args.endDate || "sin fin"}. DNI ${args.dniMode}. No agrega stock ni modifica vendedores.`;
  } else if (["prepare_customer_create", "prepare_customer_update"].includes(toolName)) {
    const draft = buildCustomerDraft({ ...args, zoneId: args.zoneId || "" }), derivedId = await customerDocumentId(draft.phoneNormalized);
    const editing = toolName === "prepare_customer_update";
    affectedId = editing ? safeId(args.customerId) : derivedId;
    const previous = await read(`customers/${affectedId}`);
    if (previous && unavailable(previous)) throw oliviaError("customer-inactive", "El cliente está inactivo o reemplazado. Revisá su identidad en CRM.", 409);
    if (editing && !previous) throw oliviaError("customer-unavailable", "El cliente ya no está disponible.", 409);
    if (editing && derivedId !== affectedId) throw oliviaError("customer-phone-review", "El cambio de teléfono necesita la revisión de identidad del flujo CRM.", 409);
    if (draft.zoneId) { const zone = await read(`customerZones/${safeId(draft.zoneId)}`); if (unavailable(zone) || zone.name !== draft.zoneName) throw oliviaError("zone-unavailable", "Elegí una zona actual y su nombre real.", 409); }
    const enrichment = customerEnrichment(previous || {}, draft);
    if (!editing && previous && Object.keys(enrichment.patch).length && !can(profile, "loyal-customers", "edit")) throw oliviaError("permission-denied", "No tenés permiso para completar este cliente.", 403);
    const data = previous ? editing ? { name: draft.name, zoneId: draft.zoneId, zoneName: draft.zoneName, customZone: draft.customZone } : enrichment.patch : { ...draft, customerKey: affectedId, active: true, deleted: false, source: "admin", createdBy: session.uid, createdByName: profile.name || "Usuario", createdAt: now };
    writes = [{ type: previous ? "update" : "create", path: `customers/${affectedId}`, data: { ...data, updatedBy: session.uid, updatedByName: profile.name || "Usuario", updatedAt: now } }];
    summary = `${editing ? "Actualizar" : previous ? "Completar campos vacíos de" : "Crear"} cliente ${draft.name || "sin nombre"}, teléfono ${draft.phoneNormalized}, zona ${draft.zoneName || "sin zona"}.${!editing && enrichment.conflicts.length ? " Los datos existentes en conflicto se conservan: " + enrichment.conflicts.map((item) => item.field).join(", ") + "." : ""}`;
  } else if (toolName === "prepare_expense_create") {
    const data = validateFinancialEntry({ ...args, type: "expense", amount: args.amountCents / 100, scope: args.locationId ? "location" : "general" });
    if (args.locationId && !(await read(`locations/${safeId(args.locationId)}`))) throw oliviaError("location-unavailable", "La ubicación no existe.", 409);
    writes = [{ type: "create", path: `financialEntries/${entityId}`, data: { ...data, intentPayload: data, occurredAt: argentinaDateFromKey(data.accruedOn), paidAt: data.paidOn ? argentinaDateFromKey(data.paidOn) : null, dueAt: data.dueOn ? argentinaDateFromKey(data.dueOn) : null, createdBy: session.uid, createdAt: now, updatedAt: now } }];
    summary = `Registrar gasto: ${data.name}, ARS ${data.amount.toFixed(2)}, ${data.category}, ${data.nature}. Devengado ${data.accruedOn}; pagado ${data.paidOn || "no"}, vencimiento ${data.dueOn || "sin fecha"}. Alcance ${data.scope} ${data.locationId}.`;
  } else if (generic[toolName]) {
    const [moduleId, collection, status] = generic[toolName], editing = toolName === "prepare_shipment_update";
    if (!args.name.trim()) return { state: "DATOS_INCOMPLETOS", summary: "Completá el nombre del registro.", missing: ["name"] };
    affectedId = editing ? safeId(args.entityId) : entityId;
    if (!editing && args.entityId) throw oliviaError("invalid-input", "El alta requiere entityId null.");
    const previous = editing ? await read(`${collection}/${affectedId}`) : null;
    if (editing && unavailable(previous)) throw oliviaError("record-unavailable", "El registro no está disponible.", 409);
    const data = editing ? { name: args.name.trim(), notes: args.notes.trim(), updatedAt: now, updatedBy: session.uid } : buildModuleRecordPayload(moduleId, { name: args.name, notes: args.notes, status, ...(moduleId === "alerts" ? { responsibleId: session.uid, title: args.name, severity: "yellow" } : {}) }, profile, now);
    writes = [{ type: editing ? "update" : "create", path: `${collection}/${affectedId}`, data }];
    summary = `${editing ? "Actualizar" : "Crear"} ${moduleId}: ${args.name}. ${args.notes || "Sin notas."}.${moduleId === "marketing" ? " Se guarda como borrador; no publica ni envía." : ""}`;
  } else if (toolName.endsWith("_review") || toolName === "prepare_product_create") {
    const collections = { prepare_invoice_review: "sales", prepare_sale_cancellation_review: "sales", prepare_user_role_review: "users", prepare_ecommerce_order_review: "orders" };
    const collection = collections[toolName];
    let reviewedEntity = null;
    if (collection) {
      if (!args.entityId) return { state: "DATOS_INCOMPLETOS", summary: "Indicá la entidad que querés revisar.", missing: ["entityId"] };
      reviewedEntity = await read(`${collection}/${safeId(args.entityId)}`);
      if (!reviewedEntity || reviewedEntity.deleted) throw oliviaError("not-found", "La entidad no está disponible.", 404);
    }
    if (toolName === "prepare_product_create") {
      const category = args.categoryId ? await read(`productCategories/${safeId(args.categoryId)}`) : null;
      if (args.categoryId && unavailable(category)) throw oliviaError("category-unavailable", "Elegí una categoría disponible.", 409);
      buildMasterProductPayload(args, category?.name || "Sin categoría", profile, null, now);
    }
    if (toolName === "prepare_sale_cancellation_review" && (!reviewedEntity.locationId || !can(profile, "locations", "view"))) throw oliviaError("sale-review-unavailable", "La anulación necesita una venta con ubicación accesible.", 409);
    if (toolName === "prepare_invoice_review" && !canAccessAdministration(profile)) throw oliviaError("permission-denied", "La revisión fiscal requiere acceso a Configuración.", 403);
    const routes = { prepare_invoice_review: "/gestion/settings", prepare_sale_cancellation_review: `/gestion/locations/${reviewedEntity?.locationId || ""}/sales`, prepare_user_role_review: "/gestion/administration", prepare_configuration_review: "/gestion/settings", prepare_ecommerce_order_review: "/gestion/ecommerce", prepare_product_create: "/gestion/products" };
    navigation = { path: routes[toolName], review: { toolName, entityId: args.entityId || null, draft: args, ...(toolName === "prepare_invoice_review" ? { invoiceId: reviewedEntity.fiscalInvoiceId || null, sourceType: arcaSourceTypeForSale(reviewedEntity) } : {}) } };
    summary = `Preparar revisión en ${module}: ${args.reason || args.name || "configuración"}. La tarjeta abre el flujo seguro con el resumen. La operación comercial se confirma allí; esta preparación no modifica ventas, roles, facturas ni catálogo.`;
  } else throw oliviaError("invalid-operation", "Operación no disponible.", 422);
  const snapshotFingerprint = fingerprint({ args, documents });
  if (writes.length && toolName !== "prepare_stock_transfer") {
    writes.push({ type: "create", path: `auditLogs/${entityId}`, data: { ...correlation, userId: session.uid, userName: profile.name || "Usuario", role: normalizedRole(profile), moduleId: module, action: toolName.replace("prepare_", ""), entityId: affectedId, previous: Object.values(documents)[0] || null, next: writes[0].data, status: "completed", createdAt: now, origin: "Asistente IA / Olivia" } });
  }
  if (navigation) writes.push({ type: "create", path: `auditLogs/${entityId}`, data: { ...correlation, userId: session.uid, userName: profile.name || "Usuario", role: normalizedRole(profile), moduleId: module, action: toolName, entityId: args.entityId || null, status: "review-prepared", createdAt: now, origin: "Asistente IA / Olivia" } });
  return { toolName, module, canonicalArgs: args, summary, snapshotFingerprint, writes, navigation, affectedId };
}
export async function prepareExtendedOperation(options) {
  const plan = await extendedOperationPlan(options);
  if (plan.state) return plan;
  const { writes, navigation, affectedId, ...prepared } = plan;
  return prepared;
}
export async function executeExtendedOperation({ session, prepared, transaction, now, correlation }) {
  const profile = await transaction.getDocument(`users/${session.uid}`);
  const fresh = { ...session, profile: { ...profile?.data, id: session.uid } };
  const store = { get: async (path) => (await transaction.getDocument(path))?.data || null };
  const marker = { ...correlation, skill: prepared.skill || null, userInput: prepared.userInput || null, origin: "Asistente IA / Olivia" };
  const plan = await extendedOperationPlan({ session: fresh, toolName: prepared.toolName, args: prepared.canonicalArgs, store, now, entityId: correlation.confirmationId, correlation: marker });
  if (plan.state || plan.snapshotFingerprint !== prepared.snapshotFingerprint) throw oliviaError("context-changed", "Cambió la información o tus permisos. Prepará una propuesta nueva antes de confirmar.", 409);
  return { writes: plan.writes, result: { entityId: plan.affectedId, message: plan.navigation ? "Revisión preparada. Abrí el flujo seguro para completar la operación." : `Acción completada. ${plan.summary}`, state: plan.navigation ? "INFORMACION" : "COMPLETADA", navigation: plan.navigation } };
}
