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
import { cleanShippingDraft, shippingError, CLOSED_SHIPPING_STATES, courierAction, customerTrackingView, validCoordinates, PREPARATION_PROBLEMS, COURIER_PROBLEMS, TRANSPORTS } from "../../../src/shared/shippingDomain.mjs";

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
function repository(env) {
  const address = String(env.SHIPPING_REPOSITORY_ADDRESS || "").trim();
  return { displayName: "Repositorio de Flor Mía", ...(address.length >= 6 ? { displayAddress: address } : {}) };
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
      assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name), repository: repositorySnapshot, incident: null,
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
export async function createCourierSession({ body, session, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  return runTransaction(async transaction => {
    const profile = { ...(await transaction.getDocument(`users/${session?.uid}`))?.data, id: session?.uid };
    if (profile.active !== true || !edit(profile)) forbidden();
    const sessionId = id(body.sessionId), requestId = id(body.requestId), leg = body.leg;
    const shipmentIds = [...new Set((Array.isArray(body.shipmentIds) ? body.shipmentIds : []).map(id))];
    assert(shipmentIds.length >= 1 && shipmentIds.length <= 25 && shipmentIds.length === body.shipmentIds.length, "Elegí entre uno y veinticinco envíos distintos.");
    assert(["direct", "origin", "final"].includes(leg), "Elegí un tramo de reparto válido.");
    const token = String(body.newToken || "");
    assert(/^[A-Za-z0-9_-]{43,128}$/.test(token), "La credencial debe ser aleatoria y segura.");
    const credentialHash = hash(token), operationId = hash(`${profile.id}:${requestId}`).slice(0, 48);
    const replacing = body.replaceExisting === true;
    const replacementReason = replacing ? String(body.reason || "").trim() : "";
    if (replacing) assert(replacementReason.length >= 4 && replacementReason.length <= 1000, "Indicá un motivo de entre 4 y 1000 caracteres.");
    const receiptPath = `shippingRouteOperations/${operationId}`, fingerprint = hash(JSON.stringify({ shipmentIds, leg, sessionId, credentialHash, ...(replacing ? { replacing, replacementReason } : {}) }));
    const receipt = (await transaction.getDocument(receiptPath))?.data;
    if (receipt) {
      assert(receipt.fingerprint === fingerprint, "El intento ya se usó con otros datos.");
      return receipt.result;
    }
    const hours = configNumber(env.SHIPPING_COURIER_TTL_HOURS, 1, 24) || 4;
    const expiresAt = new Date(now.valueOf() + hours * 3600000), updates = [], previousSessions = new Map();
    for (const shipmentId of shipmentIds) {
      const shipment = { ...(await transaction.getDocument(`shipments/${shipmentId}`))?.data, id: shipmentId };
      assert(shipment.saleId && shipment.stockCommitState === "committed" && !shipment.incident, `${shipment.publicCode || shipmentId}: el envío no está listo para asignarse.`);
      const eligible = leg === "direct"
        ? shipment.deliveryType !== "repository" && ["listo_retirar", "reparto_final"].includes(shipment.status)
        : leg === "origin"
          ? shipment.deliveryType === "repository" && ["listo_retirar", "hacia_repositorio"].includes(shipment.status)
          : shipment.deliveryType === "repository" && ["recibido_repositorio", "reparto_final"].includes(shipment.status);
      assert(eligible, `${shipment.publicCode || shipmentId}: el estado o transporte no corresponde al tramo elegido.`);
      if (shipment.courierSessionId) {
        const oldId = id(shipment.courierSessionId);
        if (!previousSessions.has(oldId)) previousSessions.set(oldId, (await transaction.getDocument(`deliverySessions/${oldId}`))?.data || null);
        const previousSession = previousSessions.get(oldId);
        assert(replacing || previousSession?.status !== "active" || new Date(previousSession.expiresAt) <= now, `${shipment.publicCode || shipmentId}: ya pertenece a un reparto activo.`);
      }
      const versions = { ...(shipment.courierVersions || {}), [leg]: (shipment.courierVersions?.[leg] || 0) + 1 };
      const changes = { courierSessionId: sessionId, courierSessionLeg: leg, courierVersions: versions, courierGrantHashes: { ...(shipment.courierGrantHashes || {}), [leg]: credentialHash }, lastPosition: null, gpsTrail: [], activeGpsSession: null, updatedAt: now, revision: (shipment.revision || 0) + 1 };
      updates.push(update(`shipments/${shipmentId}`, changes));
      if (replacing) updates.push(eventWrite({ ...shipment, ...changes }, operationId, "courier_reassigned", profile.id, shipment.status, now, { actorRole: normalizedRole(profile), leg, previousSessionId: shipment.courierSessionId || null, newSessionId: sessionId, reason: replacementReason }));
    }
    if (replacing) for (const [oldId, previous] of previousSessions) {
      if (previous?.status !== "active") continue;
      const remaining = (previous.shipmentIds || []).filter(member => !shipmentIds.includes(member));
      updates.push(update(`deliverySessions/${oldId}`, remaining.length
        ? { shipmentIds: remaining, updatedAt: now }
        : { shipmentIds: [], status: "revoked", revokedBy: profile.id, revokeReason: replacementReason, revokedAt: now, gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [] }));
    }
    const result = { sessionId, shipmentIds, expiresAt };
    updates.push(create(`deliverySessions/${sessionId}`, { shipmentIds, leg, status: "active", version: 1, accessHash: credentialHash, createdBy: profile.id, createdAt: now, expiresAt }));
    updates.push(create(`deliverySessionAccess/${credentialHash}`, { sessionId, kind: "courier_route", leg, version: 1, issuedBy: profile.id, createdAt: now, expiresAt }));
    updates.push(create(receiptPath, { fingerprint, result, createdAt: now }));
    await transaction.commitDocuments(updates);
    return result;
  }, { env });
}

// A printed shipment QR is itself the courier's short-lived, single-shipment
// capability. It can activate only the next valid stage; no code is entered.
export async function activateCourierQr({ body, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  const lookupId = id(body.lookupId), sessionId = id(body.sessionId), requestId = id(body.requestId);
  const token = String(body.newToken || "");
  assert(/^[A-Za-z0-9_-]{43,128}$/.test(token), "No se pudo abrir el acceso temporal del QR.");
  const credentialHash = hash(token), operationId = hash(`${lookupId}:${requestId}`).slice(0, 48);
  const receiptPath = `shippingQrOperations/${operationId}`;
  const fingerprint = hash(JSON.stringify({ lookupId, sessionId, credentialHash }));
  return runTransaction(async transaction => {
    const receipt = (await transaction.getDocument(receiptPath))?.data;
    if (receipt) {
      assert(receipt.fingerprint === fingerprint, "El intento ya se usó con otros datos. Volvé a escanear la etiqueta.");
      return receipt.result;
    }
    const lookup = (await transaction.getDocument(`shipmentLookups/${lookupId}`))?.data;
    assert(lookup?.shipmentId, "La etiqueta no corresponde a un envío disponible.");
    const shipment = { ...(await transaction.getDocument(`shipments/${id(lookup.shipmentId)}`))?.data, id: lookup.shipmentId };
    assert(shipment.saleId && shipment.publicLookupId === lookupId, "La etiqueta no corresponde a un envío disponible.");
    assert(shipment.stockCommitState === "committed" && !shipment.incident && !CLOSED_SHIPPING_STATES.includes(shipment.status), "El envío todavía no está disponible para reparto.");
    const leg = shipment.deliveryType === "repository"
      ? ["listo_retirar", "hacia_repositorio"].includes(shipment.status) ? "origin" : ["recibido_repositorio", "reparto_final"].includes(shipment.status) ? "final" : null
      : ["listo_retirar", "reparto_final"].includes(shipment.status) ? "direct" : null;
    assert(leg, "El envío todavía no está listo para el siguiente tramo.");
    const previousSessionId = shipment.courierSessionId || null;
    const previousSession = previousSessionId ? (await transaction.getDocument(`deliverySessions/${previousSessionId}`))?.data : null;
    // Keep other shipments in a shared route; the replaced courier loses this one atomically.
    const previousUpdates = [];
    if (previousSession?.status === "active") {
      const remaining = (previousSession.shipmentIds || []).filter(member => member !== shipment.id);
      previousUpdates.push(update(`deliverySessions/${previousSessionId}`, remaining.length
        ? { shipmentIds: remaining }
        : { shipmentIds: [], status: "revoked", revokedBy: "external_courier_qr", revokeReason: "Reemplazado mediante QR", revokedAt: now, gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [] }));
    }
    const hours = configNumber(env.SHIPPING_COURIER_TTL_HOURS, 1, 24) || 4;
    const expiresAt = new Date(now.valueOf() + hours * 3600000);
    const versions = { ...(shipment.courierVersions || {}), [leg]: (shipment.courierVersions?.[leg] || 0) + 1 };
    const result = { sessionId, shipmentIds: [shipment.id], expiresAt };
    const next = { ...shipment, courierSessionId: sessionId, courierSessionLeg: leg, courierVersions: versions, courierGrantHashes: { ...(shipment.courierGrantHashes || {}), [leg]: credentialHash }, lastPosition: null, gpsTrail: [], activeGpsSession: null, updatedAt: now, revision: (shipment.revision || 0) + 1 };
    await transaction.commitDocuments([
      ...previousUpdates,
      update(`shipments/${shipment.id}`, { courierSessionId: sessionId, courierSessionLeg: leg, courierVersions: versions, courierGrantHashes: next.courierGrantHashes, lastPosition: null, gpsTrail: [], activeGpsSession: null, updatedAt: now, revision: next.revision }),
      create(`deliverySessions/${sessionId}`, { shipmentIds: [shipment.id], leg, status: "active", version: 1, accessHash: credentialHash, createdBy: "label_qr", source: "printed_shipment_qr", createdAt: now, expiresAt }),
      create(`deliverySessionAccess/${credentialHash}`, { sessionId, kind: "courier_route", leg, version: 1, issuedBy: "printed_shipment_qr", createdAt: now, expiresAt }),
      eventWrite(next, operationId, "issue_access", "external_courier_qr", shipment.status, now, { leg, actorRole: "external_courier", previousSessionId, newSessionId: sessionId }),
      create(receiptPath, { fingerprint, result, createdAt: now }),
    ]);
    return result;
  }, { env });
}

export async function readCourierSession({ sessionId, session, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  return runTransaction(async transaction => {
    const profile = { ...(await transaction.getDocument(`users/${session?.uid}`))?.data, id: session?.uid };
    if (profile.active !== true || !management(profile)) forbidden();
    const safeSessionId = id(sessionId);
    const routeSession = (await transaction.getDocument(`deliverySessions/${safeSessionId}`))?.data;
    if (!routeSession) throw shippingError("El recorrido ya no está disponible.", 404);
    return {
      id: safeSessionId,
      status: routeSession.status,
      leg: routeSession.leg,
      shipmentIds: routeSession.shipmentIds,
      createdAt: routeSession.createdAt,
      expiresAt: routeSession.expiresAt,
    };
  }, { env });
}

async function courierRouteView(transaction, routeSession) {
  const rows = [];
  const completed = routeSession.status === "completed";
  for (const shipmentId of routeSession.shipmentIds || []) {
    const shipment = { ...(await transaction.getDocument(`shipments/${shipmentId}`))?.data, id: shipmentId };
    assert(shipment.saleId && shipment.courierSessionId === routeSession.id, "El reparto cambió. Pedí un nuevo QR a Flor Mía.");
    const destination = routeSession.leg === "origin" ? shipment.repository : shipment.destination;
    rows.push(completed || CLOSED_SHIPPING_STATES.includes(shipment.status) ? { id: shipment.id, publicCode: shipment.publicCode, customerName: routeSession.leg === "origin" ? null : shipment.customerSnapshot.name, status: shipment.status, leg: routeSession.leg, deliveryType: shipment.deliveryType, action: null }
      : {
      id: shipment.id, publicCode: shipment.publicCode, status: shipment.status, leg: routeSession.leg,
      deliveryType: shipment.deliveryType, destination: destination ? { displayAddress: destination.displayAddress || destination.displayName, verified: destination.verified === true, ...(destination.verified ? { lat: destination.lat, lng: destination.lng } : {}), notes: destination.notes || "" } : null,
      customerName: routeSession.leg === "origin" ? null : shipment.customerSnapshot.name, customerPhone: routeSession.leg === "origin" ? null : shipment.customerSnapshot.phone,
      action: courierAction(shipment, routeSession.leg), incident: shipment.incident ? { reason: shipment.incident.reason } : null,
    });
  }
  return { kind: "courier_route", sessionId: routeSession.id, leg: routeSession.leg, status: routeSession.status, accessExpiresAt: routeSession.expiresAt,
    shipments: rows };
}

export async function shippingOperation({ body, session = null, runTransaction = adminRunTransaction, env = process.env, now = new Date() }) {
  if (env.SHIPPING_ENABLED === "false") throw shippingError("El módulo de envíos está deshabilitado.", 503);
  if (["gps_start", "gps_stop", "position", "delivery_exception"].includes(body.mode)) throw shippingError("El seguimiento GPS está desactivado. Confirmá las etapas del envío desde el QR del repartidor.", 410);
  return runTransaction(async transaction => {
    let profile = null, grant = null, routeSession = null, shipmentId = body.shipmentId;
    if (session) {
      profile = { ...(await transaction.getDocument(`users/${session.uid}`))?.data, id: session.uid };
      if (profile.active !== true) forbidden();
    } else {
      assert(typeof body.token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(body.token), "Acceso inválido o vencido.");
      const credentialHash = hash(body.token);
      grant = { ...(await transaction.getDocument(`shipmentAccess/${credentialHash}`))?.data, hash: credentialHash, actorId: `courier_${credentialHash.slice(0, 16)}` };
      if (grant.shipmentId) {
        assert(!grant.revoked && new Date(grant.expiresAt) > now, "Acceso inválido o vencido.");
        shipmentId = grant.shipmentId;
      } else {
        const routeAccess = { ...(await transaction.getDocument(`deliverySessionAccess/${credentialHash}`))?.data, hash: credentialHash };
        routeSession = { ...(await transaction.getDocument(`deliverySessions/${routeAccess.sessionId || "invalid"}`))?.data, id: routeAccess.sessionId };
        assert(routeAccess.sessionId && routeAccess.kind === "courier_route" && routeAccess.version === routeSession.version && ["active", "completed"].includes(routeSession.status) && new Date(routeAccess.expiresAt) > now && new Date(routeSession.expiresAt) > now && routeSession.accessHash === credentialHash, "Acceso inválido o vencido.");
        grant = { ...routeAccess, kind: "courier", hash: credentialHash, actorId: `courier_${credentialHash.slice(0, 16)}`, routeSessionId: routeSession.id };
        if (body.mode === "detail") return courierRouteView(transaction, routeSession);
        assert(routeSession.status === "active", "Este recorrido ya terminó.");
        shipmentId = id(body.shipmentId);
        assert(routeSession.shipmentIds?.includes(shipmentId), "Este pedido no pertenece a tu recorrido.");
      }
    }
    if (body.lookupId && profile) shipmentId = (await transaction.getDocument(`shipmentLookups/${id(body.lookupId)}`))?.data?.shipmentId;
    const shipment = { ...(await transaction.getDocument(`shipments/${id(shipmentId)}`))?.data, id: shipmentId };
    assert(shipment.saleId, "El envío no existe.");
    if (!profile && body.lookupId && body.lookupId !== shipment.publicLookupId) forbidden();
    if (profile ? !readAllowed(profile, shipment) : routeSession ? routeSession.status !== "active" || routeSession.version !== grant.version || shipment.courierSessionId !== routeSession.id : grant.kind === "tracking" ? grant.version !== shipment.trackingVersion : grant.version !== shipment.courierVersions?.[grant.leg]) forbidden();
    if (!profile && grant.kind === "tracking") {
      if (body.mode !== "tracking") forbidden();
      return customerTrackingView(shipment);
    }
    if (!profile && grant.kind !== "courier") forbidden();
    if (body.mode === "detail") {
      if (!profile) return { id: shipment.id, publicCode: shipment.publicCode, customerName: grant.leg === "origin" ? null : shipment.customerSnapshot.name, status: shipment.status, leg: grant.leg, deliveryType: shipment.deliveryType, accessExpiresAt: grant.expiresAt, destination: grant.leg === "origin" ? shipment.repository : shipment.destination, customerPhone: grant.leg === "origin" ? null : shipment.customerSnapshot.phone, action: courierAction(shipment, grant.leg), incident: shipment.incident ? { reason: shipment.incident.reason } : null };
      const events = await transaction.listDocuments(`shipments/${shipment.id}/events`, { maxDocuments: 1000 });
      const safeShipment = { ...shipment };
      delete safeShipment.lastPosition; delete safeShipment.gpsTrail; delete safeShipment.activeGpsSession;
      return { ...safeShipment, events: events.sort((a, b) => (a.sequence || 0) - (b.sequence || 0) || new Date(a.createdAt) - new Date(b.createdAt)) };
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
    const revokeCourierSession = async revokeReason => {
      const routeId = shipment.courierSessionId;
      if (!routeId) return;
      const route = (await transaction.getDocument(`deliverySessions/${routeId}`))?.data;
      if (!route || route.status !== "active") return;
      const leg = route.leg;
      operations.push(update(`deliverySessions/${routeId}`, { status: "revoked", revokedBy: actor, revokeReason, revokedAt: now, gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [] }));
      for (const memberId of route.shipmentIds || []) {
        if (memberId === shipment.id) continue;
        const member = (await transaction.getDocument(`shipments/${memberId}`))?.data;
        if (member?.courierSessionId !== routeId) continue;
        operations.push(update(`shipments/${memberId}`, { courierSessionId: null, courierSessionLeg: null,
          courierVersions: { ...(member.courierVersions || {}), [leg]: (member.courierVersions?.[leg] || 0) + 1 },
          courierGrantHashes: { ...(member.courierGrantHashes || {}), [leg]: null }, lastPosition: null, gpsTrail: [], activeGpsSession: null,
          updatedAt: now, revision: (member.revision || 0) + 1 }));
      }
      changes.courierSessionId = null; changes.courierSessionLeg = null;
      changes.courierGrantHashes = { ...(shipment.courierGrantHashes || {}), [leg]: null };
      changes.courierVersions = { ...(shipment.courierVersions || {}), [leg]: (shipment.courierVersions?.[leg] || 0) + 1 };
    };
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
      Object.assign(changes, { status: "aprobado", approvalReview: null, stockCommitState: "committed", stockOriginType: type, stockOriginId: originId, stockOriginName: origin.name, stockMovementIds: movements, deliveryType: draft.deliveryType, assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name), repository: repo, approvedBy: actor, approvedAt: now });
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
      await revokeCourierSession("Reintento de envío");
      assert(body.physicalPositionConfirmed === true && ["origin", "repository", "final"].includes(body.retryFrom), "Confirmá dónde se encuentra físicamente el pedido.");
      assert(body.retryFrom !== "repository" || shipment.deliveryType === "repository", "Este pedido no usa repositorio.");
      changes.status = { origin: "listo_retirar", repository: "recibido_repositorio", final: "reparto_final" }[body.retryFrom];
      changes.incident = null; changes.deliveryException = null; changes.lastPosition = null;
      detail = { reason: reason(), retryFrom: body.retryFrom, stockAndFinance: "Reintento sin descuento adicional de stock ni cambios financieros" };
      for (const path of shipment.incident?.alertPaths || []) operations.push(update(path, { active: false, status: "resolved", resolvedBy: actor, updatedAt: now }));
    } else if (["cancel", "return", "undelivered"].includes(body.mode)) {
      requireEdit(); detail.reason = reason();
      await revokeCourierSession(`Envío ${body.mode}`);
      changes.status = { cancel: "cancelado", return: "devuelto", undelivered: "no_entregado" }[body.mode];
      changes.lastPosition = null; changes.trackingVersion = shipment.trackingVersion + 1;
      changes.courierVersions = Object.fromEntries(Object.entries(shipment.courierVersions).map(([key, value]) => [key, value + 1]));
      detail.stockAndFinance = "Sin devolución automática: requiere movimiento de inventario y operación financiera separados.";
    } else if (body.mode === "address") {
      requireEdit(); detail = { reason: reason(), before: shipment.destination };
      await revokeCourierSession("Se modificó el domicilio");
      const draft = cleanShippingDraft(body);
      const destination = { displayAddress: draft.displayAddress, notes: draft.notes, verified: false };
      if (body.verified === true) {
        assert(validCoordinates({ lat: body.lat, lng: body.lng }), "Coordenadas inválidas.");
        Object.assign(destination, { lat: body.lat, lng: body.lng, verified: true, verifiedBy: actor, verifiedAt: now,
          provinceOrCaba: String(body.provinceOrCaba || "").slice(0, 100), neighborhoodOrLocality: String(body.neighborhoodOrLocality || "").slice(0, 100) });
      }
      changes.destination = destination; changes.destinationRevision = (shipment.destinationRevision || 0) + 1; changes.deliveryException = null; changes.lastPosition = null; detail.after = destination;
    } else if (body.mode === "assign") {
      requireEdit(); assert(["aprobado", "en_preparacion", "listo_retirar"].includes(previous), "Reasigná antes del retiro.");
      const assigned = await preparers(transaction, [...new Set(body.assignedPreparerIds || [])]);
      Object.assign(changes, { assignedPreparerIds: assigned.map(user => user.id), preparerNames: assigned.map(user => user.name) });
      detail = { reason: reason(), before: { assignedPreparerIds: shipment.assignedPreparerIds, preparerNames: shipment.preparerNames }, after: { assignedPreparerIds: changes.assignedPreparerIds, preparerNames: changes.preparerNames } }; notice = { event: "preparation_assigned", title: "Se actualizó tu asignación de preparación", assigned: true };
    } else if (body.mode === "issue_access") {
      requireEdit();
      assert(body.kind === "courier" || body.kind === "tracking", "Tipo de acceso inválido.");
      if (body.kind === "courier") await revokeCourierSession("Se generó un acceso de reparto individual");
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
      await revokeCourierSession("Gestión revocó el acceso de reparto");
      changes.courierVersions = Object.fromEntries(Object.entries(shipment.courierVersions).map(([key, value]) => [key, value + 1])); changes.lastPosition = null;
    } else if (body.mode === "courier_action") {
      if (profile) forbidden();
      const action = courierAction(shipment, grant.leg);
      assert(action && action.action === body.action, "La acción no corresponde al estado o tramo actual.");
      if (action.action === "deliver") {
        detail.proof = { method: "courier_confirmation", actorId: grant.actorId, confirmedAt: now };
        changes.deliveredAt = now;
        notice = { event: "delivery_completed", title: "Pedido entregado" };
      }
      Object.assign(changes, { status: action.next, activeGpsSession: null, lastPosition: null, gpsTrail: [] });
    } else if (body.mode === "labels") {
      if (!profile || (shipment.stockCommitState !== "committed") || (!edit(profile) && !shipment.assignedPreparerIds.includes(actor))) forbidden();
      changes.labelGenerations = (shipment.labelGenerations || 0) + 1;
      detail = { kind: changes.labelGenerations > 1 ? "reprint" : "first_print", destinationRevision: shipment.destinationRevision || 0 };
      result = { shipment: { ...shipment, events: undefined } };
    } else throw shippingError("Operación desconocida.", 400);
    Object.assign(changes, { updatedAt: now, revision: (shipment.revision || 0) + 1 });
    if (changes.lastPosition === null) { changes.activeGpsSession = null; changes.gpsTrail = []; }
    const next = { ...shipment, ...changes };
    if (notice) {
      const notices = await notifications(transaction, next, notice.event, { ...notice, stamp: now, eventId: operationId });
      operations.push(...notices);
      if (changes.incident) changes.incident.alertPaths = notices.map(operation => operation.path);
    }
    if (routeSession && body.mode === "courier_action") {
      const handingOffToRepository = routeSession.leg === "origin" && body.action === "repository_receive";
      const routeMemberIds = handingOffToRepository ? (routeSession.shipmentIds || []).filter(memberId => memberId !== shipment.id) : (routeSession.shipmentIds || []);
      if (handingOffToRepository) Object.assign(changes, {
        courierSessionId: null, courierSessionLeg: null,
        courierVersions: { ...(shipment.courierVersions || {}), origin: (shipment.courierVersions?.origin || 0) + 1 },
        courierGrantHashes: { ...(shipment.courierGrantHashes || {}), origin: null },
      });
      const routeRows = [];
      for (const memberId of routeMemberIds) {
        const row = memberId === shipment.id ? { ...shipment, ...changes } : { ...(await transaction.getDocument(`shipments/${memberId}`))?.data };
        if (row.saleId && !CLOSED_SHIPPING_STATES.includes(row.status)) routeRows.push(row);
      }
      const hasFinalStop = routeRows.some(row => row.status === "reparto_final");
      const originStopsRemain = routeRows.some(row => ["listo_retirar", "hacia_repositorio"].includes(row.status));
      const sessionChanges = { updatedAt: now, gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [], gpsStoppedAt: now, ...(handingOffToRepository ? { shipmentIds: routeMemberIds } : {}) };
      if (!routeRows.length || routeSession.leg === "origin" && !originStopsRemain) Object.assign(sessionChanges, { status: "completed", completedAt: now, gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [] });
      else if (!hasFinalStop && routeSession.gpsEnabled) Object.assign(sessionChanges, { gpsEnabled: false, gpsSession: null, lastPosition: null, gpsTrail: [], gpsStoppedAt: now });
      operations.push(update(`deliverySessions/${routeSession.id}`, sessionChanges));
    }
    operations.push(update(`shipments/${shipment.id}`, changes), eventWrite(next, operationId, body.mode, actor, previous, now, { ...detail, actorRole: profile ? normalizedRole(profile) : "external_courier" }), create(receiptPath, { fingerprint, result: body.mode === "labels" ? { authorized: true } : result, createdAt: now }));
    await transaction.commitDocuments(operations);
    return result;
  }, { env });
}

export async function listShippingResources(session, options = {}) {
  if (!can(session.profile, "quick-sales", "create") && !management(session.profile)) forbidden();
  const users = await adminListDocuments("users", { ...options, maxDocuments: 180 });
  const people = users.filter(user => user.active && (canAccessSellerPanel(user) || canAccessAdministration(user)));
  return people.map(user => ({ id: user.id, name: name(user), label: people.filter(person => name(person) === name(user)).length > 1 ? `${name(user)} · ${normalizedRole(user) === "admin" ? "Administrador" : normalizedRole(user) === "seller" ? "Vendedor" : normalizedRole(user)} · ${user.id.slice(-6)}` : name(user) }));
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
