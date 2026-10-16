import { createHash, randomBytes } from "node:crypto";
import { adminRunTransaction, adminListDocuments } from "./firestoreAdminRest.mjs";
import { can, canAccessAdministration, canAccessSellerPanel, effectiveSellerLocations, normalizedRole } from "../../../src/gestion/permissions.js";
import { buildCustomerDraft, customerDocumentId } from "../../../src/gestion/customers/customerDomain.js";
import { buildOperationalSalePlan, cleanOperationalSaleItems, customerSaleWrite, resolveOperationalCustomer } from "../../../src/shared/operationalWritePlans.mjs";
import { calculateDiscountSummary } from "../../../src/modules/locations/domain/discounts.js";
import { isDiscountAvailable } from "../../../src/modules/locations/domain/dashboard.js";
import { effectiveLocationPrice } from "../../../src/modules/inventory/domain/inventory.js";
import { normalizePayment } from "../../../src/modules/locations/domain/payments.js";
import { argentinaDateKey } from "../../../src/modules/locations/domain/time.js";
import { SALES_CHANNELS } from "../../../src/modules/locations/domain/channels.js";
import { isLocationActiveNow } from "../../../src/modules/locations/domain/locations.js";
import { cleanShippingDraft, shippingError, CLOSED_SHIPPING_STATES, courierAction, deliveryProof, customerTrackingView, validatePoint, PREPARATION_PROBLEMS, COURIER_PROBLEMS, TRANSPORTS } from "../../../src/shared/shippingDomain.mjs";

const hash = value => createHash("sha256").update(String(value)).digest("hex");
const id = value => { if (!/^[A-Za-z0-9_-]{1,200}$/.test(value || "")) throw shippingError("Identificador inválido.", 400); return value; };
const create = (path, data) => ({ type: "create", path, data });
const update = (path, data) => ({ type: "update", path, data });
const name = profile => profile.name || profile.email || "Usuario";
const forbidden = () => { throw shippingError("No tenés permiso para esta operación.", 403); };
const assert = (condition, message) => { if (!condition) throw shippingError(message); };
const management = profile => can(profile, "shipping", "view");
const edit = profile => can(profile, "shipping", "edit");
const approve = profile => can(profile, "shipping", "approve");
const readAllowed = (profile, shipment) => management(profile) || shipment.createdBy === profile.id || shipment.assignedPreparerIds.includes(profile.id);
const configNumber = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
function config(env) {
  return { radiusMeters: configNumber(env.SHIPPING_GEOFENCE_RADIUS_METERS, 10, 1000), maxAccuracyMeters: configNumber(env.SHIPPING_GPS_MAX_ACCURACY_METERS, 5, 200), maxAgeMs: configNumber(env.SHIPPING_GPS_MAX_AGE_SECONDS, 10, 300) * 1000 || null };
}
function repository(env) {
  const address = String(env.SHIPPING_REPOSITORY_ADDRESS || "").trim();
  assert(address.length >= 6, "Configurá la dirección real del repositorio antes de usar este transporte.");
  return { displayAddress: address };
}
async function preparers(transaction, ids) {
  assert(ids.length > 0 && ids.length <= 12, "Asigná entre uno y doce preparadores.");
  const profiles = [];
  for (const uid of ids) {
    const profile = (await transaction.getDocument(`users/${id(uid)}`))?.data;
    assert(profile?.active === true && (canAccessSellerPanel(profile) || canAccessAdministration(profile)), "Un preparador no está activo o no tiene acceso operativo.");
    profiles.push({ id: uid, name: name(profile) });
  }
  return profiles;
}
async function notifications(transaction, shipment, event, { title, critical = false, assigned = false, stamp, eventId }) {
  const users = await transaction.listDocuments("users", { maxDocuments: 180 });
  const recipients = users.filter(user => user.active === true && (assigned ? shipment.assignedPreparerIds.includes(user.id) : management(user)));
  return recipients.map(user => create(`alerts/shipping_${hash(`${shipment.id}:${eventId}:${user.id}`).slice(0, 48)}`, {
    source: "shipping", moduleId: "shipping", entityType: "shipment", entityId: shipment.id,
    event, title, description: shipment.publicCode, responsibleId: user.id, severity: critical ? "critical" : "info",
    active: true, status: "new", read: false, createdBy: "shipping_backend", createdAt: stamp, updatedAt: stamp,
    href: `/gestion/shipping?shipment=${shipment.id}`,
  }));
}
function eventWrite(shipment, eventId, action, actor, previous, stamp, detail = {}) {
  const leg = status => shipment.deliveryType !== "repository" ? "direct" : ["solicitud_pendiente", "aprobado", "en_preparacion", "listo_retirar", "hacia_repositorio"].includes(status) ? "origin" : "final";
  return create(`shipments/${shipment.id}/events/${eventId}`, { action, sequence: shipment.revision || 0, actorId: actor, previousStatus: previous, status: shipment.status, previousLeg: previous ? leg(previous) : null, leg: leg(shipment.status), createdAt: stamp, ...detail });
}

export async function createShippingSale({ sale, session, requestId, administrative = false, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  id(requestId);
  if (sale.offlineSale) throw shippingError("Los envíos requieren conexión. No se agregan a la cola de ventas presenciales.", 400);
  const fingerprint = hash(JSON.stringify({ ...sale, profile: undefined, seller: undefined, requestId: undefined }));
  const saleId = `ship_${hash(`${session.uid}:${requestId}`).slice(0, 48)}`;
  const shipmentId = `shipment_${saleId}`;
  const publicLookupId = randomBytes(24).toString("base64url");
  return runTransaction(async transaction => {
    const profile = { ...(await transaction.getDocument(`users/${session.uid}`))?.data, id: session.uid };
    if (profile.active !== true || !can(profile, "quick-sales", "create") || (administrative && !canAccessAdministration(profile))) forbidden();
    const existing = (await transaction.getDocument(`sales/${saleId}`))?.data;
    if (existing) {
      if (existing.requestFingerprint !== fingerprint || existing.sellerId !== session.uid) throw Object.assign(shippingError("Este intento corresponde a otra venta. Recuperá la confirmación original."), { code: "shipping/request-conflict" });
      return { id: saleId, ...existing, alreadySynced: true };
    }
    if (administrative) {
      const legacyId = `quick_${session.uid}_${requestId}`;
      const legacy = (await transaction.getDocument(`sales/${legacyId}`))?.data;
      if (legacy) {
        const legacyFingerprint = JSON.stringify({ origin: sale.stockOrigin, channel: sale.channel, items: sale.items, discounts: sale.discounts || [], paymentMethod: sale.paymentMethod, payments: sale.payments || [], customer: sale.customer || null, customerDni: sale.customerDni || "", invoiceRequested: sale.invoiceRequested === true, deliveryMethod: sale.deliveryMethod || "pickup" });
        if (legacy.sellerId !== session.uid || legacy.requestFingerprint !== legacyFingerprint) throw Object.assign(shippingError("Este intento corresponde a una venta anterior. Recuperá su confirmación original."), { code: "shipping/request-conflict" });
        return { id: legacyId, ...legacy, alreadySynced: true, shippingLegacyReviewRequired: !legacy.shipmentId };
      }
    }
    const draft = cleanShippingDraft(sale.shipping, administrative);
    const originType = administrative ? sale.stockOrigin?.type : "location";
    assert(["location", "warehouse"].includes(originType), "Elegí un origen físico válido.");
    const originId = id(administrative ? sale.stockOrigin?.id : sale.location?.id);
    const location = { ...(await transaction.getDocument(`${originType === "warehouse" ? "warehouses" : "locations"}/${originId}`))?.data, id: originId };
    assert(location.name && location.deleted !== true && (originType === "warehouse" ? location.active !== false : isLocationActiveNow(location, now)), "El origen no está activo.");
    if (originType === "warehouse" ? !can(profile, "warehouse", "edit") : !effectiveSellerLocations(profile, [location], now).length) forbidden();
    if (administrative) assert(SALES_CHANNELS.some(channel => channel.value === sale.channel), "Elegí un canal comercial válido.");
    const items = cleanOperationalSaleItems(sale.items);
    assert(items.length <= 80, "La venta admite hasta 80 productos distintos.");
    const stocks = [], priceOverrides = [];
    for (const item of items) {
      id(item.productId);
      const product = (await transaction.getDocument(`products/${item.productId}`))?.data;
      assert(product && product.active !== false && product.deleted !== true, "Un producto ya no está activo.");
      const stock = (await transaction.getDocument(`${originType === "warehouse" ? "warehouseStock" : "locationStock"}/${originId}/items/${item.productId}`))?.data;
      assert(stock && stock.active !== false && stock.deleted !== true && stock.productDeleted !== true, `${product.name} no está habilitado en el origen.`);
      const suggestedPrice = originType === "warehouse" ? Number(product.defaultPrice || 0) : effectiveLocationPrice(product, stock);
      if (!administrative) assert(item.unitPrice === suggestedPrice, "El precio cambió. Actualizá el carrito.");
      else if (suggestedPrice !== item.unitPrice) priceOverrides.push({ productId: item.productId, suggestedPrice, unitPrice: item.unitPrice });
      item.name = product.name; item.categoryId = product.categoryId || null; stocks.push(stock);
    }
    const discounts = [], savedIds = new Set();
    assert((sale.discounts || []).length <= 20, "Demasiados descuentos.");
    for (const requested of sale.discounts || []) {
      if (!can(profile, "quick-sales", "useDiscounts")) forbidden();
      if (requested.source === "manual" || requested.discountId === "manual") {
        if (!can(profile, "quick-sales", "useManualDiscounts")) forbidden();
        assert(["fixed", "percent"].includes(requested.type) && Number.isSafeInteger(Number(requested.value)) && Number(requested.value) > 0 && (requested.type !== "percent" || Number(requested.value) <= 100), "Descuento manual inválido.");
        discounts.push({ discountId: "manual", name: String(requested.name || "Descuento manual").slice(0, 150), source: "manual", type: requested.type, value: Number(requested.value) });
      } else {
        const discountId = id(requested.discountId || requested.id);
        if (savedIds.has(discountId)) continue;
        savedIds.add(discountId);
        const discount = { ...(await transaction.getDocument(`discounts/${discountId}`))?.data, id: discountId };
        assert(isDiscountAvailable(discount, originType === "warehouse" ? {} : location, now, { profile, items }), "Un descuento ya no está disponible.");
        discounts.push({ discountId, name: discount.name, type: discount.type, value: discount.value, source: "saved" });
      }
    }
    if (sale.paymentMethod === "multiple" && !can(profile, "quick-sales", "useMultiplePayments")) forbidden();
    if ((sale.ticketRequested || sale.invoiceRequested) && !can(profile, "quick-sales", "requestTicket")) forbidden();
    const summary = calculateDiscountSummary(discounts, items.reduce((sum, item) => sum + item.subtotal, 0), { paymentMethod: sale.paymentMethod, roundCashTotal: administrative });
    const payment = normalizePayment(sale.paymentMethod, sale.paymentMethodLabel, sale.payments || [], summary.total);
    const prepared = buildCustomerDraft({ ...sale.customer, phone: sale.customer?.phone || sale.customer?.phoneNormalized });
    assert(prepared.name && prepared.name.length <= 200, "El cliente necesita nombre y teléfono.");
    prepared.id = await customerDocumentId(prepared.phoneNormalized);
    const customerDocument = await transaction.getDocument(`customers/${prepared.id}`);
    const customer = resolveOperationalCustomer(customerDocument?.data, prepared);
    const assigned = administrative ? await preparers(transaction, draft.assignedPreparerIds) : [];
    const repositorySnapshot = draft.deliveryType === "repository" ? repository(env) : null;
    const dateKey = argentinaDateKey(now).replaceAll("-", "");
    const prefix = String(location.codePrefix || (originType === "warehouse" ? "VR" : "LOC")).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "LOC";
    const counterPath = `counters/${prefix}_${dateKey}`;
    const counter = (await transaction.getDocument(counterPath))?.data || {};
    const movementIds = items.map(item => `shipping_sale_${saleId}_${item.productId}`);
    const plan = buildOperationalSalePlan({ profile, location, items, stocks, counter, saleId, movementIds, dateKey, prefix, stamp: now,
      localFields: { saleDate: argentinaDateKey(now), saleTime: new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now) },
      discountSummary: summary, payment, customer, stockType: originType, administrative, requestId, requestFingerprint: fingerprint, priceOverrides,
      ticketRequested: sale.ticketRequested === true, invoiceRequested: sale.invoiceRequested === true, customerDni: sale.customerDni || "", deliveryMethod: "shipping", channel: administrative ? sale.channel : "in_person", deferredStock: !administrative });
    Object.assign(plan.saleData, { sourceType: administrative ? "admin_quick_sale" : "seller_sale", deliveryMethod: "shipping", shipmentId, requestId, requestFingerprint: fingerprint, stockCommitState: administrative ? "committed" : "pending", ...(!administrative ? { stockOriginType: null, stockOriginId: null, stockOriginName: null } : {}) });
    const shipment = { id: shipmentId, shippingSchemaVersion: 1, saleId, saleCode: plan.saleData.saleCode, publicCode: `FM-E-${publicLookupId.slice(0, 8).toUpperCase()}`, publicLookupId,
      creationSource: plan.saleData.sourceType, createdBy: session.uid, commercialLocationId: plan.saleData.locationId, commercialLocationName: plan.saleData.locationName,
      stockOriginType: administrative ? originType : null, stockOriginId: administrative ? originId : null, stockOriginName: administrative ? location.name : null,
      stockCommitMode: administrative ? "immediate" : "deferred", stockCommitState: administrative ? "committed" : "pending",
      stockMovementIds: administrative ? movementIds : [], status: administrative ? "aprobado" : "solicitud_pendiente", deliveryType: draft.deliveryType,
      customerSnapshot: { name: customer.name, phone: customer.phone }, itemsSnapshot: items, destination: { displayAddress: draft.displayAddress, notes: draft.notes, verified: false }, destinationRevision: 0,
      assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name), repository: repositorySnapshot, incident: null, lastPosition: null,
      courierVersions: { origin: 0, final: 0, direct: 0 }, trackingVersion: 0, revision: 0, createdAt: now, saleCreatedAt: now, updatedAt: now };
    const notices = await notifications(transaction, shipment, administrative ? "preparation_assigned" : "seller_request_created", { title: administrative ? "Tenés un pedido para preparar" : "Nueva solicitud de envío", assigned: administrative, stamp: now, eventId: "created" });
    const customerWrite = customerSaleWrite({ existing: customerDocument?.data, customer, profile, saleId, stamp: now, source: plan.saleData.sourceType });
    const operations = [create(`sales/${saleId}`, plan.saleData), create(`shipments/${shipmentId}`, shipment), create(`shipmentLookups/${publicLookupId}`, { shipmentId }),
      eventWrite(shipment, "created", "created", session.uid, null, now, { actorRole: normalizedRole(profile) }), create(`auditLogs/shipping_sale_${saleId}`, plan.auditData),
      counter.lastNumber == null ? create(counterPath, plan.counterData) : update(counterPath, plan.counterData),
      customerDocument ? update(`customers/${customer.id}`, customerWrite) : create(`customers/${customer.id}`, customerWrite), ...notices];
    plan.stockWrites.forEach((write, index) => operations.push(update(`${originType === "warehouse" ? "warehouseStock" : "locationStock"}/${originId}/items/${write.productId}`, write.stockData), create(`stockMovements/${movementIds[index]}`, write.movementData)));
    await transaction.commitDocuments(operations);
    return { ...plan.result, shipmentId, stockCommitState: shipment.stockCommitState, createdAt: now };
  }, { env });
}

// Read/write capabilities are checked in the transaction, including grant revocation,
// user deactivation and request identity. Neither a QR nor a shipment ID authorizes writes.
export async function shippingOperation({ body, session = null, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  return runTransaction(async transaction => {
    let profile = null, grant = null, shipmentId = body.shipmentId;
    if (session) {
      profile = { ...(await transaction.getDocument(`users/${session.uid}`))?.data, id: session.uid };
      if (profile.active !== true) forbidden();
    } else {
      assert(typeof body.token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(body.token), "Acceso inválido o vencido.");
      const credentialHash = hash(body.token);
      grant = { ...(await transaction.getDocument(`shipmentAccess/${credentialHash}`))?.data, hash: credentialHash, actorId: `courier_${credentialHash.slice(0, 16)}` };
      assert(grant.shipmentId && !grant.revoked && new Date(grant.expiresAt) > now, "Acceso inválido o vencido.");
      shipmentId = grant.shipmentId;
    }
    if (body.lookupId && profile) shipmentId = (await transaction.getDocument(`shipmentLookups/${id(body.lookupId)}`))?.data?.shipmentId;
    const shipment = { ...(await transaction.getDocument(`shipments/${id(shipmentId)}`))?.data, id: shipmentId };
    assert(shipment.saleId, "El envío no existe.");
    if (profile ? !readAllowed(profile, shipment) : grant.kind === "tracking" ? grant.version !== shipment.trackingVersion : grant.version !== shipment.courierVersions?.[grant.leg]) forbidden();
    if (!profile && grant.kind === "tracking") {
      if (body.mode !== "tracking") forbidden();
      return customerTrackingView(shipment, now, config(env).maxAgeMs || 120000);
    }
    if (!profile && grant.kind !== "courier") forbidden();
    if (body.mode === "detail") {
      if (!profile) return { id: shipment.id, publicCode: shipment.publicCode, status: shipment.status, destination: grant.leg === "origin" ? shipment.repository : shipment.destination, customerPhone: grant.leg === "origin" ? null : shipment.customerSnapshot.phone, action: courierAction(shipment, grant.leg), incident: shipment.incident ? { reason: shipment.incident.reason } : null, gpsAllowed: shipment.status === "reparto_final" && grant.leg !== "origin" };
      const events = await transaction.listDocuments(`shipments/${shipment.id}/events`, { maxDocuments: 1000 });
      return { ...shipment, events: events.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || new Date(a.createdAt) - new Date(b.createdAt)), geofenceConfigured: Boolean(config(env).radiusMeters && config(env).maxAccuracyMeters && config(env).maxAgeMs) };
    }
    if (body.mode === "position") {
      if (profile || grant.leg === "origin" || shipment.status !== "reparto_final" || CLOSED_SHIPPING_STATES.includes(shipment.status)) forbidden();
      assert(validatePoint(body.point, now), "La ubicación es inválida o está vencida.");
      const previous = shipment.lastPosition;
      assert(!previous || now - new Date(previous.receivedAt) >= 5000, "Esperá unos segundos antes de actualizar la ubicación.");
      const point = { lat: body.point.lat, lng: body.point.lng, accuracy: body.point.accuracy, observedAt: body.point.observedAt, receivedAt: now, expiresAt: new Date(now.valueOf() + (config(env).maxAgeMs || 120000)), grantHash: grant.hash };
      await transaction.commitDocuments([update(`shipments/${shipment.id}`, { lastPosition: point })]);
      return { saved: true };
    }
    const actor = profile?.id || grant.actorId;
    id(body.requestId);
    const operationId = hash(`${actor}:${body.requestId}`).slice(0, 48);
    const receiptPath = `shipments/${shipment.id}/operations/${operationId}`;
    const receipt = (await transaction.getDocument(receiptPath))?.data;
    const fingerprint = hash(JSON.stringify(body));
    if (receipt) {
      assert(receipt.fingerprint === fingerprint, "El intento ya se usó con otros datos.");
      if (body.mode === "labels") { if (!profile || (!edit(profile) && !shipment.assignedPreparerIds.includes(actor))) forbidden(); return { shipment }; }
      return receipt.result;
    }
    assert(!CLOSED_SHIPPING_STATES.includes(shipment.status) || body.mode === "labels" || body.mode === "retry" && shipment.status === "no_entregado", "Este envío ya está cerrado.");
    const previous = shipment.status, changes = {}, operations = [];
    let notice = null, result = { id: shipment.id }, detail = {};
    const requireEdit = () => { if (!profile || !edit(profile)) forbidden(); };
    const requireApproval = () => { if (!profile || !approve(profile)) forbidden(); };
    const reason = () => { const value = String(body.reason || "").trim(); assert(value.length >= 4 && value.length <= 1000, "Indicá un motivo de entre 4 y 1000 caracteres."); return value; };
    if (body.mode === "approve") {
      requireApproval();
      assert(shipment.status === "solicitud_pendiente" && shipment.stockCommitState === "pending", "La solicitud ya se aprobó o no está pendiente.");
      assert(["location", "warehouse"].includes(body.originType), "Elegí el tipo de origen.");
      const originId = id(body.originId), type = body.originType;
      const origin = { ...(await transaction.getDocument(`${type === "warehouse" ? "warehouses" : "locations"}/${originId}`))?.data, id: originId };
      assert(origin.name && origin.deleted !== true && (type === "warehouse" ? origin.active !== false : isLocationActiveNow(origin, now)), "El origen no está activo.");
      if (type === "warehouse" ? !can(profile, "warehouse", "edit") : !can(profile, "locations", "adjustStock")) forbidden();
      const draft = cleanShippingDraft({ ...shipment.destination, ...body }, true);
      const assigned = await preparers(transaction, draft.assignedPreparerIds);
      const repo = draft.deliveryType === "repository" ? repository(env) : null;
      const movements = [];
      for (const item of shipment.itemsSnapshot) {
        const path = `${type === "warehouse" ? "warehouseStock" : "locationStock"}/${originId}/items/${id(item.productId)}`;
        const stock = (await transaction.getDocument(path))?.data;
        assert(stock && stock.active !== false && stock.deleted !== true && stock.productDeleted !== true && Number.isSafeInteger(stock.currentStock), `${item.name}: falta configurar stock en el origen.`);
        assert(stock.currentStock >= item.qty, `${item.name}: stock insuficiente (${stock.currentStock}). Regularizá el origen antes de aprobar.`);
        const movementId = `shipping_approval_${shipment.id}_${item.productId}`; movements.push(movementId);
        operations.push(update(path, { currentStock: stock.currentStock - item.qty, lastSaleId: shipment.saleId, lastMovementId: movementId, updatedAt: now }), create(`stockMovements/${movementId}`, { inventoryType: type, ...(type === "warehouse" ? { warehouseId: originId, warehouseName: origin.name } : { locationId: originId, locationName: origin.name }), productId: item.productId, productName: item.name, qty: -item.qty, previousStock: stock.currentStock, newStock: stock.currentStock - item.qty, type: "shipping_approval", saleId: shipment.saleId, shipmentId: shipment.id, userId: actor, userName: name(profile), createdAt: now, reason: "Origen aprobado para envío" }));
      }
      const sale = (await transaction.getDocument(`sales/${shipment.saleId}`))?.data;
      assert(sale?.status === "active" && sale.stockCommitState === "pending", "La venta no está pendiente de stock.");
      operations.push(update(`sales/${shipment.saleId}`, { stockCommitState: "committed", stockOriginType: type, stockOriginId: originId, stockOriginName: origin.name, updatedAt: now }));
      Object.assign(changes, { status: "aprobado", stockCommitState: "committed", stockOriginType: type, stockOriginId: originId, stockOriginName: origin.name, stockMovementIds: movements, deliveryType: draft.deliveryType, assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name), repository: repo, approvedBy: actor, approvedAt: now });
      if (draft.displayAddress !== shipment.destination.displayAddress || draft.notes !== shipment.destination.notes) {
        changes.destination = { displayAddress: draft.displayAddress, notes: draft.notes, verified: false };
        changes.destinationRevision = (shipment.destinationRevision || 0) + 1;
        detail = { reason: "Destino revisado durante la aprobación", before: shipment.destination, after: changes.destination };
      }
      notice = { event: "preparation_assigned", title: "Tenés un pedido para preparar", assigned: true };
    } else if (["start_preparing", "ready"].includes(body.mode)) {
      if (!profile || !shipment.assignedPreparerIds.includes(actor)) forbidden();
      assert(!shipment.incident && shipment.stockCommitState === "committed", "Resolvé la incidencia antes de preparar.");
      assert(body.mode === "ready" ? ["aprobado", "en_preparacion"].includes(shipment.status) : shipment.status === "aprobado", "El pedido ya cambió de estado.");
      changes.status = body.mode === "ready" ? "listo_retirar" : "en_preparacion";
      if (body.mode === "ready") notice = { event: "ready_for_pickup", title: "Pedido listo para retirar" };
    } else if (body.mode === "incident") {
      assert(!shipment.incident, "Ya hay una incidencia abierta; gestión debe resolverla.");
      if (profile && !edit(profile) && !shipment.assignedPreparerIds.includes(actor)) forbidden();
      if (!profile && !courierAction(shipment, grant.leg)) forbidden();
      const allowedReasons = profile ? [...PREPARATION_PROBLEMS, ...COURIER_PROBLEMS] : COURIER_PROBLEMS;
      assert(allowedReasons.includes(body.reason), "Elegí un motivo válido.");
      const note = String(body.note || "").trim(); assert(note.length <= 1000 && (body.reason !== "Otro" || note.length >= 4), "Indicá el detalle del problema.");
      changes.incident = { reason: body.reason, note, actorId: actor, createdAt: now, previousStatus: previous };
      notice = { event: "shipping_incident", title: `Problema de envío: ${body.reason}`, critical: true }; detail = changes.incident;
    } else if (body.mode === "resolve") {
      requireEdit(); assert(shipment.incident, "No hay una incidencia abierta.");
      detail = { reason: reason(), incident: shipment.incident }; changes.incident = null;
      for (const path of shipment.incident.alertPaths || []) operations.push(update(path, { active: false, status: "resolved", resolvedBy: actor, updatedAt: now }));
    } else if (body.mode === "reject") {
      requireApproval(); assert(shipment.status === "solicitud_pendiente", "La solicitud ya no está pendiente.");
      changes.status = "rechazado"; detail.reason = reason();
    } else if (body.mode === "review") {
      requireApproval(); assert(shipment.status === "solicitud_pendiente", "La solicitud ya no está pendiente.");
      changes.approvalReview = { reason: reason(), reviewedBy: actor, reviewedAt: now }; detail = changes.approvalReview;
    } else if (body.mode === "retry") {
      requireEdit(); assert(shipment.status === "no_entregado" && shipment.stockCommitState === "committed", "Sólo se reintentan envíos no entregados con stock ya imputado.");
      assert(body.physicalPositionConfirmed === true && ["origin", "repository", "final"].includes(body.retryFrom), "Confirmá dónde se encuentra físicamente el pedido.");
      assert(body.retryFrom !== "repository" || shipment.deliveryType === "repository", "Este pedido no usa repositorio.");
      changes.status = { origin: "listo_retirar", repository: "recibido_repositorio", final: "reparto_final" }[body.retryFrom];
      changes.incident = null; changes.deliveryException = null; changes.lastPosition = null;
      detail = { reason: reason(), retryFrom: body.retryFrom, stockAndFinance: "Reintento sin descuento adicional de stock ni cambios financieros" };
      for (const path of shipment.incident?.alertPaths || []) operations.push(update(path, { active: false, status: "resolved", resolvedBy: actor, updatedAt: now }));
    } else if (["cancel", "return", "undelivered"].includes(body.mode)) {
      requireEdit(); detail.reason = reason();
      changes.status = { cancel: "cancelado", return: "devuelto", undelivered: "no_entregado" }[body.mode];
      changes.lastPosition = null; changes.trackingVersion = shipment.trackingVersion + 1;
      changes.courierVersions = Object.fromEntries(Object.entries(shipment.courierVersions).map(([key, value]) => [key, value + 1]));
      detail.stockAndFinance = "Sin devolución automática: requiere movimiento de inventario y operación financiera separados.";
    } else if (body.mode === "address") {
      requireEdit(); detail = { reason: reason(), before: shipment.destination };
      const draft = cleanShippingDraft(body);
      const destination = { displayAddress: draft.displayAddress, notes: draft.notes, verified: false };
      if (body.verified === true) {
        assert(validatePoint({ lat: body.lat, lng: body.lng, accuracy: 1, observedAt: now.toISOString() }, now), "Coordenadas inválidas.");
        Object.assign(destination, { lat: body.lat, lng: body.lng, verified: true, verifiedBy: actor, verifiedAt: now,
          provinceOrCaba: String(body.provinceOrCaba || "").slice(0, 100), neighborhoodOrLocality: String(body.neighborhoodOrLocality || "").slice(0, 100) });
      }
      changes.destination = destination; changes.destinationRevision = (shipment.destinationRevision || 0) + 1; changes.deliveryException = null; detail.after = destination;
    } else if (body.mode === "assign") {
      requireEdit(); assert(["aprobado", "en_preparacion", "listo_retirar"].includes(previous), "Reasigná antes del retiro.");
      const assigned = await preparers(transaction, [...new Set(body.assignedPreparerIds || [])]);
      Object.assign(changes, { assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name) });
      detail.reason = reason(); notice = { event: "preparation_assigned", title: "Se actualizó tu asignación de preparación", assigned: true };
    } else if (body.mode === "issue_access") {
      requireEdit();
      assert(body.kind === "courier" || body.kind === "tracking", "Tipo de acceso inválido.");
      if (body.kind === "tracking" && shipment.deliveryType === "repository") assert(shipment.status === "reparto_final", "El enlace del cliente se habilita al salir del repositorio.");
      if (body.kind === "courier") assert(shipment.stockCommitState === "committed", "Aprobá el origen antes de autorizar al repartidor.");
      const leg = body.kind === "tracking" ? "tracking" : shipment.deliveryType === "repository" ? body.leg : "direct";
      assert(["origin", "final", "direct", "tracking"].includes(leg) && (shipment.deliveryType === "repository" ? leg !== "direct" : !["origin", "final"].includes(leg)), "Tramo inválido.");
      const token = String(body.newToken || ""); assert(/^[A-Za-z0-9_-]{43,128}$/.test(token), "La credencial debe ser aleatoria y segura.");
      const version = body.kind === "tracking" ? shipment.trackingVersion + 1 : shipment.courierVersions[leg] + 1;
      if (body.kind === "tracking") changes.trackingVersion = version;
      else { changes.courierVersions = { ...shipment.courierVersions, [leg]: version }; changes.courierGrantHashes = { ...shipment.courierGrantHashes, [leg]: hash(token) }; changes.deliveryException = null; changes.lastPosition = null; }
      const hours = body.kind === "courier" ? configNumber(env.SHIPPING_COURIER_TTL_HOURS, 1, 24) || 4 : configNumber(env.SHIPPING_TRACKING_TTL_HOURS, 1, 720) || 168;
      operations.push(create(`shipmentAccess/${hash(token)}`, { shipmentId: shipment.id, kind: body.kind, leg, version, issuedBy: actor, expiresAt: new Date(now.valueOf() + hours * 3600000), createdAt: now }));
      result = { id: shipment.id, expiresAt: new Date(now.valueOf() + hours * 3600000) };
      if (body.kind === "tracking") operations.push(create(`shippingOutbox/${operationId}`, { event: "shipping.tracking_ready", shipmentId: shipment.id, adapter: "disabled", createdAt: now }));
    } else if (body.mode === "revoke_access") {
      requireEdit(); changes.trackingVersion = shipment.trackingVersion + 1;
      changes.courierVersions = Object.fromEntries(Object.entries(shipment.courierVersions).map(([key, value]) => [key, value + 1])); changes.lastPosition = null;
    } else if (body.mode === "delivery_exception") {
      requireApproval(); assert(previous === "reparto_final", "La excepción sólo se aprueba durante el reparto final.");
      const accessHash = String(body.grantHash || ""); assert(/^[a-f0-9]{64}$/.test(accessHash), "Elegí la autorización vigente del repartidor.");
      const access = (await transaction.getDocument(`shipmentAccess/${accessHash}`))?.data;
      assert(access?.shipmentId === shipment.id && access.kind === "courier" && access.leg !== "origin" && access.version === shipment.courierVersions[access.leg] && new Date(access.expiresAt) > now, "La autorización no está vigente.");
      assert(access.issuedBy !== `courier_${accessHash.slice(0, 16)}` && actor !== `courier_${accessHash.slice(0, 16)}`, "El repartidor no puede aprobar su propia excepción.");
      changes.deliveryException = { approvedBy: actor, reason: reason(), grantHash: accessHash, destinationRevision: shipment.destinationRevision || 0, expiresAt: new Date(now.valueOf() + 30 * 60000).toISOString() };
      detail = changes.deliveryException;
    } else if (body.mode === "courier_action") {
      if (profile) forbidden();
      const action = courierAction(shipment, grant.leg);
      assert(action && action.action === body.action, "La acción no corresponde al estado o tramo actual.");
      if (action.action === "deliver") {
        detail.proof = deliveryProof(shipment, grant, now, config(env)); changes.lastPosition = null; changes.deliveredAt = now;
        notice = { event: "delivery_completed", title: "Pedido entregado" };
      }
      changes.status = action.next;
    } else if (body.mode === "labels") {
      if (!profile || (shipment.stockCommitState !== "committed") || (!edit(profile) && !shipment.assignedPreparerIds.includes(actor))) forbidden();
      changes.labelGenerations = (shipment.labelGenerations || 0) + 1;
      detail = { kind: changes.labelGenerations > 1 ? "reprint" : "first_print", destinationRevision: shipment.destinationRevision || 0 };
      result = { shipment: { ...shipment, events: undefined } };
    } else throw shippingError("Operación desconocida.", 400);
    Object.assign(changes, { updatedAt: now, revision: (shipment.revision || 0) + 1 });
    const next = { ...shipment, ...changes };
    if (notice) {
      const notices = await notifications(transaction, next, notice.event, { ...notice, stamp: now, eventId: operationId });
      operations.push(...notices);
      if (changes.incident) changes.incident.alertPaths = notices.map(operation => operation.path);
    }
    operations.push(update(`shipments/${shipment.id}`, changes), eventWrite(next, operationId, body.mode, actor, previous, now, { ...detail, actorRole: profile ? normalizedRole(profile) : "external_courier" }), create(receiptPath, { fingerprint, result: body.mode === "labels" ? { authorized: true } : result, createdAt: now }));
    await transaction.commitDocuments(operations);
    return result;
  }, { env });
}

export async function listShippingResources(session, options = {}) {
  if (!can(session.profile, "quick-sales", "create") && !management(session.profile)) forbidden();
  const users = await adminListDocuments("users", { ...options, maxDocuments: 180 });
  return users.filter(user => user.active && (canAccessSellerPanel(user) || canAccessAdministration(user))).map(user => ({ id: user.id, name: name(user) }));
}

export async function limitShippingPublic(ip, { env = process.env, now = new Date(), runTransaction = adminRunTransaction } = {}) {
  const bucket = Math.floor(now.valueOf() / 60000), path = `shippingRateLimits/${hash(`${ip}:${bucket}`)}`;
  await runTransaction(async transaction => {
    const row = (await transaction.getDocument(path))?.data;
    if ((row?.count || 0) >= 90) throw shippingError("Demasiadas solicitudes. Intentá dentro de un minuto.", 429);
    const data = { count: (row?.count || 0) + 1, expiresAt: new Date(now.valueOf() + 120000) };
    await transaction.commitDocuments([row ? update(path, data) : create(path, data)]);
  }, { env });
}
