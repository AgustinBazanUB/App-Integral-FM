import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createShippingSale, createCourierSession, activateCourierQr, readCourierSession, shippingOperation, limitShippingPublic } from "../netlify/functions/_lib/shipping.mjs";
import { cancelSaleAndInvoice } from "../netlify/functions/_lib/arca/saleCancellation.mjs";
import { shippingBucket, courierAction, customerTrackingView, validCoordinates } from "../src/shared/shippingDomain.mjs";
import { admin, seller, preparer, manager, session, sale, now, memoryStore } from "./helpers/shippingFixtures.mjs";
const token = "a".repeat(43), token2 = "b".repeat(43), trackToken = "c".repeat(43), routeToken = "d".repeat(43), trackTokenTwo = "e".repeat(43);
const sha = value => createHash("sha256").update(value).digest("hex");
async function setup(administrative = false, overrides = {}) {
  const store = memoryStore();
  const result = await createShippingSale({ sale: sale(overrides), session: session(administrative ? admin : seller), requestId: "sale-1", administrative, runTransaction: store.runTransaction, now });
  let sequence = 0;
  const op = (mode, data = {}, profile = admin, at = now) => shippingOperation({ body: { mode, shipmentId: result.shipmentId, requestId: `op-${++sequence}`, ...data }, session: profile ? session(profile) : null, runTransaction: store.runTransaction, now: at, env: {} });
  return { ...store, result, op, shipment: () => store.documents.get(`shipments/${result.shipmentId}`) };
}
const approval = { originType: "warehouse", originId: "infal", assignedPreparerIds: [preparer.id], deliveryType: "manual" };

test("seller: atomic sale/request, no deduction; approval deducts only actual origin and preserves commercial location", async () => {
  const s = await setup();
  assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, 10);
  assert.equal(s.shipment().stockCommitState, "pending");
  assert.equal(s.documents.get(`sales/${s.result.id}`).stockOriginId, null);
  await s.op("review", { reason: "Verificación antes de aprobar" });
  const first = await s.op("approve", approval);
  assert.equal(first.id, s.result.shipmentId);
  assert.equal(s.documents.get("warehouseStock/infal/items/oil").currentStock, 18);
  assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, 10);
  assert.equal(s.documents.get(`sales/${s.result.id}`).locationId, "valle");
  assert.equal(s.documents.get(`sales/${s.result.id}`).stockOriginId, "infal");
  assert.equal(s.shipment().approvalReview, null);
  await assert.rejects(s.op("approve", approval), /ya se aprobó/);
});
test("administrative sale commits stock once across concurrent retries, lookup stable", async () => {
  const store = memoryStore(), input = { sale: sale(), administrative: true, session: session(admin), requestId: "stable", runTransaction: store.runTransaction, now };
  const results = await Promise.all([createShippingSale(input), createShippingSale(input), createShippingSale(input)]);
  assert.equal(new Set(results.map(row => row.shipmentId)).size, 1);
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, 8);
  assert.equal([...store.documents.keys()].filter(key => key.startsWith("shipments/") && key.split("/").length === 2).length, 1);
  assert.equal([...store.documents.keys()].filter(key => key.startsWith("stockMovements/")).length, 1);
  await assert.rejects(createShippingSale({ ...input, sale: sale({ items: [{ productId: "oil", name: "Oil", qty: 3, unitPrice: 1000 }] }) }), /otra venta/);
});

test("a pre-upgrade Quick Sale pending confirmation recovers the legacy sale without a second sale or stock deduction", async () => {
  const store = memoryStore(), input = sale({ shipping: undefined });
  const fingerprint = JSON.stringify({ origin: input.stockOrigin, channel: input.channel, items: input.items, discounts: [], paymentMethod: input.paymentMethod, payments: [], customer: input.customer, customerDni: "", invoiceRequested: false, deliveryMethod: "shipping" });
  store.documents.set("sales/quick_admin_legacy", { sellerId: admin.id, requestFingerprint: fingerprint, saleCode: "LEGACY-QA", status: "active" });
  const result = await createShippingSale({ sale: input, administrative: true, session: session(admin), requestId: "legacy", runTransaction: store.runTransaction, now });
  assert.equal(result.id, "quick_admin_legacy"); assert.equal(result.shippingLegacyReviewRequired, true);
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, 10);
  assert.equal([...store.documents.keys()].filter(path => path.startsWith("sales/")).length, 1);
});
test("permissions and denials: seller cannot impersonate admin, approve, prepare unassigned, or change stock", async () => {
  const store = memoryStore();
  await assert.rejects(createShippingSale({ sale: sale(), administrative: true, session: session(seller), requestId: "blocked", runTransaction: store.runTransaction, now }), /permiso/);
  const s = await setup();
  await assert.rejects(s.op("approve", approval, seller), /permiso/);
  await assert.rejects(s.op("approve", approval, manager), /permiso/);
  await s.op("approve", approval);
  await assert.rejects(s.op("ready", {}, seller), /permiso/);
  await assert.rejects(s.op("ready", {}, admin), /permiso/);
  s.documents.set("users/admin", { ...admin, permissionDeny: { shipping: ["view", "admin", "approve", "edit"] } });
  await assert.rejects(s.op("address", { displayAddress: "Calle nueva 111", reason: "Corrección" }), /permiso/);
});
test("insufficient warehouse stock rolls back all sale and shipment writes; deferred approval also blocks insufficient stock", async () => {
  const store = memoryStore(); store.documents.get("warehouseStock/infal/items/oil").currentStock = 1;
  await assert.rejects(createShippingSale({ sale: sale({ stockOrigin: { type: "warehouse", id: "infal" } }), administrative: true, session: session(admin), requestId: "insufficient", runTransaction: store.runTransaction, now }), /stock disponible/);
  assert.equal([...store.documents.keys()].filter(key => key.startsWith("sales/")).length, 0);
  const s = await setup(); s.documents.get("warehouseStock/infal/items/oil").currentStock = 1;
  await assert.rejects(s.op("approve", approval), /stock insuficiente/);
  assert.equal(s.shipment().status, "solicitud_pendiente");
});
test("immediate location sale follows existing negative stock policy, deferred creation ignores local insufficiency", async () => {
  const store = memoryStore(); store.documents.get("locationStock/valle/items/oil").currentStock = 0;
  const result = await createShippingSale({ sale: sale(), administrative: true, session: session(admin), requestId: "negative", runTransaction: store.runTransaction, now });
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, -2);
  assert.equal(result.stockDiscrepancies.length, 1);
  const deferred = await createShippingSale({ sale: sale(), session: session(seller), requestId: "deferred", runTransaction: store.runTransaction, now });
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, -2);
  assert.equal(store.documents.get(`shipments/${deferred.shipmentId}`).stockCommitState, "pending");
});
test("offline shipping rejected before any write; arbitrary product price and discounts rejected", async () => {
  const store = memoryStore(), input = { session: session(seller), requestId: "offline", runTransaction: store.runTransaction, now };
  await assert.rejects(createShippingSale({ ...input, sale: sale({ offlineSale: { localId: "x" } }) }), /requieren conexión/);
  await assert.rejects(createShippingSale({ ...input, sale: sale({ items: [{ productId: "oil", qty: 2, unitPrice: 1 }] }) }), /precio cambió/);
  await assert.rejects(createShippingSale({ ...input, sale: sale({ discounts: [{ source: "manual", type: "percent", value: 101 }] }) }), /inválido/);
});
test("preparation and labels never deduct stock; labels idempotently reauthorize current assignment", async () => {
  const s = await setup(true), count = () => s.documents.get("locationStock/valle/items/oil").currentStock;
  await s.op("start_preparing", {}, preparer); await s.op("ready", {}, preparer);
  const body = { mode: "labels", shipmentId: s.result.shipmentId, requestId: "print" };
  const first = await shippingOperation({ body, session: session(preparer), runTransaction: s.runTransaction, now });
  const again = await shippingOperation({ body, session: session(preparer), runTransaction: s.runTransaction, now });
  assert.equal(first.shipment.id, again.shipment.id);
  assert.equal(count(), 8); assert.equal(s.shipment().labelGenerations, 1);
});
test("critical incidents deduplicate, pause actions, notify managers and resolve with immutable history", async () => {
  const s = await setup(true);
  const body = { mode: "incident", reason: "No hay bolsas/cajas", note: "Prueba", shipmentId: s.result.shipmentId, requestId: "critical" };
  await shippingOperation({ body, session: session(preparer), runTransaction: s.runTransaction, now });
  await shippingOperation({ body, session: session(preparer), runTransaction: s.runTransaction, now });
  const critical = [...s.documents.values()].filter(row => row.severity === "critical");
  assert.equal(critical.length, 2); assert(critical.some(row => row.responsibleId === manager.id));
  await assert.rejects(s.op("ready", {}, preparer), /incidencia/);
  await s.op("resolve", { reason: "Embalajes repuestos" });
  assert.equal(s.shipment().incident, null);
  assert.equal([...s.documents.values()].filter(row => row.severity === "critical" && row.active).length, 0);
  await s.op("ready", {}, preparer);
});
test("direct courier: scoped actions confirm delivery without collecting GPS or requiring a geofence", async () => {
  const s = await setup(true);
  await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  const detail = await s.op("detail", { token }, null);
  assert.equal(detail.action.action, "pickup"); assert.equal(detail.itemsSnapshot, undefined); assert.equal(detail.customerSnapshot, undefined);
  await assert.rejects(s.op("courier_action", { token, action: "deliver" }, null), /no corresponde/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  const body = { mode: "courier_action", shipmentId: s.result.shipmentId, token, requestId: "delivery-once", action: "deliver" };
  await shippingOperation({ body, runTransaction: s.runTransaction, now });
  await shippingOperation({ body, runTransaction: s.runTransaction, now });
  assert.equal(s.shipment().status, "entregado"); assert.equal(s.shipment().lastPosition, null);
  assert.equal([...s.documents.values()].filter(row => row.event === "delivery_completed").length, 2);
  await assert.rejects(s.op("position", { token, point: { lat: 0, lng: 0, accuracy: 5, observedAt: now.toISOString() } }, null), /GPS está desactivado/);
});
test("printed shipment QR opens one short-lived courier stage without a manually entered code", async () => {
  const s = await setup(true);
  await s.op("ready", {}, preparer);
  const shipment = s.shipment(), newToken = "f".repeat(43);
  const body = { lookupId: shipment.publicLookupId, sessionId: "qr-direct-session", requestId: "qr-direct-activation", newToken };
  const result = await activateCourierQr({ body, runTransaction: s.runTransaction, now, env: {} });
  const retried = await activateCourierQr({ body, runTransaction: s.runTransaction, now, env: {} });
  assert.deepEqual(retried, result);
  assert.equal(result.sessionId, body.sessionId);
  assert.equal(s.documents.get(`deliverySessions/${body.sessionId}`).leg, "direct");
  assert.equal(s.documents.get(`deliverySessions/${body.sessionId}`).source, "printed_shipment_qr");
  assert.equal(s.documents.get(`deliverySessionAccess/${sha(newToken)}`).kind, "courier_route");
  const replacementToken = "g".repeat(43);
  await activateCourierQr({ body: { ...body, requestId: "another-scan", sessionId: "second-session", newToken: replacementToken }, runTransaction: s.runTransaction, now, env: {} });
  assert.equal(s.shipment().courierSessionId, "second-session");
  assert.equal(s.documents.get(`deliverySessions/${body.sessionId}`).status, "revoked");
  await assert.rejects(shippingOperation({ body: { mode: "courier_action", shipmentId: s.result.shipmentId, token: newToken, action: "pickup", requestId: "old-courier" }, runTransaction: s.runTransaction, now, env: {} }));
  await shippingOperation({ body: { mode: "courier_action", shipmentId: s.result.shipmentId, token: replacementToken, action: "pickup", requestId: "new-courier" }, runTransaction: s.runTransaction, now, env: {} });
});
test("printed QR cannot activate an unapproved, incident-paused, or not-ready shipment", async () => {
  const s = await setup();
  const body = { lookupId: s.shipment().publicLookupId, sessionId: "qr-blocked", requestId: "qr-blocked-request", newToken: "j".repeat(43) };
  await assert.rejects(activateCourierQr({ body, runTransaction: s.runTransaction, now, env: {} }), /disponible/);
  assert.equal(s.documents.has(`deliverySessions/${body.sessionId}`), false);
  await s.op("approve", approval);
  await assert.rejects(activateCourierQr({ body: { ...body, sessionId: "qr-not-ready", requestId: "qr-not-ready-request" }, runTransaction: s.runTransaction, now, env: {} }), /siguiente tramo/);
  await s.op("incident", { reason: "No hay bolsas/cajas", note: "Prueba" }, preparer);
  await assert.rejects(activateCourierQr({ body: { ...body, sessionId: "qr-paused", requestId: "qr-paused-request" }, runTransaction: s.runTransaction, now, env: {} }), /disponible/);
});
test("repository has separate legs, hides customer from the first courier and tracks stages without GPS", async () => {
  const s = await setup(); await s.op("approve", { ...approval, deliveryType: "repository" }); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  assert.equal((await s.op("tracking", { token: trackToken }, null)).position, undefined);
  await s.op("issue_access", { kind: "courier", leg: "origin", newToken: token });
  await s.op("issue_access", { kind: "courier", leg: "final", newToken: token2 });
  const detail = await s.op("detail", { token }, null); assert.equal(detail.customerName, null); assert.equal(detail.customerPhone, null); assert.equal(detail.destination.displayName, "Repositorio de Flor Mía"); assert.equal(detail.destination.displayAddress, undefined);
  await assert.rejects(s.op("position", { token, point: {} }, null), /GPS está desactivado/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  await assert.rejects(s.op("courier_action", { token: token2, action: "repository_depart" }, null), /no corresponde/);
  await s.op("courier_action", { token, action: "repository_receive" }, null);
  const received = await s.op("tracking", { token: trackToken }, null);
  assert.equal(received.label, "En el repositorio, esperando el siguiente tramo"); assert.equal(received.position, undefined); assert.equal(received.destination, undefined);
  await s.op("courier_action", { token: token2, action: "repository_depart" }, null);
  assert.equal(s.shipment().status, "reparto_final");
  const tracking = await s.op("tracking", { token: trackToken }, null);
  assert.equal(tracking.label, "En camino a tu domicilio"); assert.equal(tracking.deliveryType, "repository"); assert.equal(tracking.position, undefined);
  await s.op("issue_access", { kind: "tracking", newToken: "d".repeat(43) });
  await assert.rejects(s.op("tracking", { token: trackToken }, null), /permiso/);
  assert.equal(courierAction(s.shipment(), "origin"), null);
});
test("the same printed repository label activates the next courier leg only after repository receipt", async () => {
  const s = await setup(); await s.op("approve", { ...approval, deliveryType: "repository" }); await s.op("ready", {}, preparer);
  const lookupId = s.shipment().publicLookupId;
  const activate = (sessionId, requestId, newToken) => activateCourierQr({ body: { lookupId, sessionId, requestId, newToken }, runTransaction: s.runTransaction, now, env: {} });
  const originToken = "h".repeat(43), origin = await activate("qr-origin", "qr-origin-request", originToken);
  assert.equal(s.documents.get(`deliverySessions/${origin.sessionId}`).leg, "origin");
  const courier = (token, action, requestId) => shippingOperation({ body: { mode: "courier_action", shipmentId: s.result.shipmentId, token, action, requestId }, runTransaction: s.runTransaction, now, env: {} });
  await courier(originToken, "pickup", "qr-pickup");
  await courier(originToken, "repository_receive", "qr-receive");
  assert.equal(s.shipment().status, "recibido_repositorio");
  assert.equal(s.shipment().courierSessionId, null);
  const final = await activate("qr-final", "qr-final-request", "i".repeat(43));
  assert.equal(s.documents.get(`deliverySessions/${final.sessionId}`).leg, "final");
});
test("tracking is readonly, distinct, revocable, excludes PII and never exposes GPS data", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  await s.op("issue_access", { kind: "courier", newToken: token });
  const view = await s.op("tracking", { token: trackToken }, null);
  assert.equal(view.position, undefined); assert.equal(view.destination, undefined); assert.equal(view.customerSnapshot, undefined); assert.equal(view.customerName, undefined);
  await assert.rejects(s.op("courier_action", { token: trackToken, action: "pickup" }, null), /permiso/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  const live = await s.op("tracking", { token: trackToken }, null);
  assert.equal(live.position, undefined); assert.equal(live.trail, undefined); assert.equal(live.destination, undefined);
  await assert.rejects(s.op("gps_start", { token, gpsSessionId: "gps-test" }, null), /GPS está desactivado/);
  await assert.rejects(s.op("detail", { token }, null, new Date(now.valueOf() + 5 * 3600000)), /vencido/);
  await s.op("revoke_access");
  await assert.rejects(s.op("tracking", { token: trackToken }, null), /permiso/);
  await assert.rejects(s.op("detail", { token }, null), /permiso/);
});

test("QR courier authorization is bound to its printed shipment, not another valid credential", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  const detail = await s.op("detail", { token, lookupId: s.shipment().publicLookupId }, null);
  assert.equal(detail.leg, "direct"); assert.equal(detail.customerName, "Cliente de prueba"); assert.equal(detail.gpsAllowed, undefined); assert(detail.accessExpiresAt);
  await assert.rejects(s.op("detail", { token, lookupId: "another_label_lookup" }, null), /permiso/);
  await assert.rejects(s.op("courier_action", { token, lookupId: "another_label_lookup", action: "pickup" }, null), /permiso/);
  assert.equal(s.shipment().status, "listo_retirar");
  await assert.rejects(s.op("gps_start", { token, gpsSessionId: "early" }, null), /GPS está desactivado/);
});

test("all GPS operations are rejected before they can read or write shipment location", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  const beforeShipment = structuredClone(s.shipment());
  const beforeWrites = s.documents.size;
  for (const mode of ["gps_start", "gps_stop", "position", "delivery_exception"]) {
    await assert.rejects(s.op(mode, { token, gpsSessionId: "disabled", point: { lat: -34.6, lng: -58.4 } }, null), /GPS está desactivado/);
  }
  assert.deepEqual(s.shipment(), beforeShipment);
  assert.equal(s.documents.size, beforeWrites);
});
test("one temporary courier session advances multiple orders without collecting GPS and closes after the last delivery", async () => {
  const store = memoryStore(), shipments = [];
  for (let index = 0; index < 2; index++) {
    const created = await createShippingSale({ sale: sale(), session: session(admin), requestId: `route-sale-${index}`, administrative: true, runTransaction: store.runTransaction, now });
    shipments.push(created.shipmentId);
    await shippingOperation({ body: { mode: "ready", shipmentId: created.shipmentId, requestId: `route-ready-${index}` }, session: session(preparer), runTransaction: store.runTransaction, now, env: {} });
  }
  assert.equal(store.documents.get("locationStock/valle/items/oil").currentStock, 6);
  const route = await createCourierSession({ body: { sessionId: "shared-route", requestId: "route-create", shipmentIds: shipments, leg: "direct", newToken: routeToken }, session: session(admin), runTransaction: store.runTransaction, now, env: {} });
  assert.equal(route.shipmentIds.length, 2);
  assert(shipments.every(id => store.documents.get(`shipments/${id}`).courierSessionId === route.sessionId));
  const courier = (mode, shipmentId, data = {}) => shippingOperation({ body: { mode, token: routeToken, ...(shipmentId ? { shipmentId } : {}), ...data }, runTransaction: store.runTransaction, now, env: {} });
  const staff = (shipmentId, data) => shippingOperation({ body: { mode: "issue_access", shipmentId, requestId: `track-${shipmentId}`, kind: "tracking", newToken: data }, session: session(admin), runTransaction: store.runTransaction, now, env: {} });
  await staff(shipments[0], trackToken); await staff(shipments[1], trackTokenTwo);
  const initial = await courier("detail"); assert.equal(initial.kind, "courier_route"); assert.equal(initial.shipments.length, 2); assert.equal(initial.position, undefined); assert.equal(initial.trail, undefined);
  await courier("courier_action", shipments[0], { requestId: "pickup-first", action: "pickup" });
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackToken }, runTransaction: store.runTransaction, now, env: {} })).position, undefined);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position, undefined);
  await courier("courier_action", shipments[1], { requestId: "pickup-second", action: "pickup" });
  await courier("courier_action", shipments[0], { requestId: "deliver-first", action: "deliver" });
  assert.equal(store.documents.get(`deliverySessions/${route.sessionId}`).gpsEnabled, false);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackToken }, runTransaction: store.runTransaction, now, env: {} })).position, undefined);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position, undefined);
  await courier("courier_action", shipments[1], { requestId: "deliver-second", action: "deliver" });
  const completed = store.documents.get(`deliverySessions/${route.sessionId}`);
  assert.equal(completed.status, "completed"); assert.equal(completed.gpsEnabled, false); assert.equal(completed.lastPosition, null);
  const receipt = await courier("detail"); assert.equal(receipt.status, "completed"); assert.equal(receipt.shipments[0].customerPhone, undefined); assert.equal(receipt.position, undefined);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position, undefined);
  await assert.rejects(courier("position", null, { gpsSessionId: "disabled", point: {} }), /GPS está desactivado/);
});

test("repository handoff releases each order for its own final-mile route", async () => {
  const store = memoryStore();
  const createReadyRepositoryShipment = async suffix => {
    const created = await createShippingSale({ sale: sale({ shipping: { ...sale().shipping, deliveryType: "repository" } }), session: session(admin), requestId: `repository-route-sale-${suffix}`, administrative: true, runTransaction: store.runTransaction, now });
    await shippingOperation({ body: { mode: "ready", shipmentId: created.shipmentId, requestId: `repository-route-ready-${suffix}` }, session: session(preparer), runTransaction: store.runTransaction, now, env: {} });
    return created.shipmentId;
  };
  const [first, second] = await Promise.all([createReadyRepositoryShipment("one"), createReadyRepositoryShipment("two")]);
  const createRoute = (sessionId, requestId, shipmentIds, leg, newToken) => createCourierSession({ body: { sessionId, requestId, shipmentIds, leg, newToken }, session: session(admin), runTransaction: store.runTransaction, now, env: {} });
  const originToken = "f".repeat(43), finalToken = "g".repeat(43);
  const origin = await createRoute("origin-route", "origin-route-create", [first, second], "origin", originToken);
  const courier = (token, mode, shipmentId, data = {}) => shippingOperation({ body: { mode, token, ...(shipmentId ? { shipmentId } : {}), ...data }, runTransaction: store.runTransaction, now, env: {} });
  await courier(originToken, "courier_action", first, { requestId: "origin-pickup-first", action: "pickup" });
  await courier(originToken, "courier_action", first, { requestId: "origin-receive-first", action: "repository_receive" });
  assert.deepEqual(store.documents.get(`deliverySessions/${origin.sessionId}`).shipmentIds, [second]);
  assert.equal(store.documents.get(`shipments/${first}`).courierSessionId, null);
  const nextRoute = await createRoute("final-route", "final-route-create", [first], "final", finalToken);
  const remainingOriginRoute = await courier(originToken, "detail");
  assert.deepEqual(remainingOriginRoute.shipments.map(row => row.id), [second]);
  await assert.rejects(courier(originToken, "courier_action", first, { requestId: "stale-origin-action", action: "repository_receive" }), /no pertenece/);
  await courier(originToken, "courier_action", second, { requestId: "origin-pickup-second", action: "pickup" });
  await courier(originToken, "courier_action", second, { requestId: "origin-receive-second", action: "repository_receive" });
  assert.equal(store.documents.get(`deliverySessions/${origin.sessionId}`).status, "completed");
  assert.deepEqual(store.documents.get(`deliverySessions/${origin.sessionId}`).shipmentIds, []);
  await courier(finalToken, "courier_action", first, { requestId: "final-depart", action: "repository_depart" });
  await assert.rejects(courier(finalToken, "gps_start", null, { gpsSessionId: "disabled" }), /GPS está desactivado/);
  assert.equal(store.documents.get(`deliverySessions/${nextRoute.sessionId}`).lastPosition, null);
});

test("courier-session management fallback requires shipping-view permission and never returns location fields", async () => {
  const store = memoryStore(), nowPosition = { lat: -34.6, lng: -58.4, accuracy: 12, observedAt: now.toISOString(), receivedAt: now };
  store.documents.set("deliverySessions/manager-view", { status: "active", leg: "direct", shipmentIds: ["one"], createdBy: "admin", accessHash: "secret-hash", gpsEnabled: true, expiresAt: new Date(now.valueOf() + 3600000), lastPosition: { ...nowPosition, grantHash: "sensitive-hash" }, gpsTrail: [nowPosition], gpsSession: { id: "internal", accessHash: "sensitive-hash" } });
  const view = await readCourierSession({ sessionId: "manager-view", session: session(admin), runTransaction: store.runTransaction, now });
  assert.equal(view.gpsEnabled, undefined); assert.equal(view.lastPosition, undefined); assert.equal(view.gpsTrail, undefined);
  assert.equal(view.accessHash, undefined); assert.equal(view.gpsSession, undefined); assert.equal(view.createdBy, undefined);
  await assert.rejects(readCourierSession({ sessionId: "manager-view", session: session(seller), runTransaction: store.runTransaction, now }), /permiso/);
});

test("public tracking returns only stage information, never destination or location coordinates", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  await s.op("courier_action", { token, action: "pickup" }, null);
  const view = await s.op("tracking", { token: trackToken }, null);
  assert.equal(view.status, "reparto_final"); assert.equal(view.deliveryType, "manual");
  assert.equal(view.customerSnapshot, undefined); assert.equal(view.destination, undefined);
  assert.equal(view.position, undefined); assert.equal(view.trail, undefined);
  assert.equal(view.hasIncident, false);
});

test("manual delivery address coordinates retain numeric validation", () => {
  const point = { lat: -34.6, lng: -58.4 };
  assert.equal(validCoordinates(point), true);
  assert.equal(validCoordinates({ ...point, lat: "-34.6" }), false);
  assert.equal(validCoordinates({ ...point, lng: -181 }), false);
});
test("terminal exceptions never count as delivered and neither return nor cancel restock", async () => {
  for (const mode of ["cancel", "return", "undelivered"]) {
    const s = await setup(true); await s.op(mode, { reason: "Prueba de cierre" });
    assert.equal(shippingBucket(s.shipment()), "exceptions"); assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, 8);
  }
  assert.equal(customerTrackingView({ publicCode: "test", status: "hacia_repositorio", lastPosition: { lat: 0, lng: 0, accuracy: 1, observedAt: now.toISOString() } }).position, undefined);
  const paused = customerTrackingView({ publicCode: "test", status: "reparto_final", incident: { reason: "Privado" }, lastPosition: { lat: 0, lng: 0 } });
  assert.equal(paused.hasIncident, true); assert.match(paused.label, /revisando una incidencia/); assert.equal(paused.position, undefined); assert.equal(paused.incident, undefined);
});
test("fiscal cancellation guards shipping sales before invoice or stock operations", async () => {
  let commits = 0;
  await assert.rejects(cancelSaleAndInvoice({ saleId: "shipping-sale", session: session(admin), runTransaction: work => work({ getDocument: async () => ({ data: { shipmentId: "shipment", status: "active" } }), commitDocuments: async () => { commits++; } }), now }), /envío vinculado/);
  assert.equal(commits, 0);
});
test("public rate limit persists and enforces per-minute bucket", async () => {
  const store = memoryStore();
  for (let i = 0; i < 90; i++) await limitShippingPublic("127.0.0.1", { now, runTransaction: store.runTransaction });
  await assert.rejects(limitShippingPublic("127.0.0.1", { now, runTransaction: store.runTransaction }), /Demasiadas/);
});

test("review and retry are audited without charging stock again, correcting address invalidates previous proof", async () => {
  const s = await setup();
  await s.op("review", { reason: "Confirmar piso y departamento" });
  assert.equal(s.shipment().stockCommitState, "pending");
  await s.op("approve", { ...approval, displayAddress: "Calle corregida 123, CABA", notes: "Piso 2" });
  assert.equal(s.shipment().destination.displayAddress, "Calle corregida 123, CABA");
  assert.equal(s.shipment().destinationRevision, 1);
  await s.op("ready", {}, preparer); await s.op("undelivered", { reason: "Cliente ausente verificado" });
  await assert.rejects(s.op("retry", { retryFrom: "final", reason: "Cliente disponible" }), /físicamente/);
  await s.op("retry", { retryFrom: "final", physicalPositionConfirmed: true, reason: "El cliente confirmó su disponibilidad" });
  assert.equal(s.shipment().status, "reparto_final");
  assert.equal(s.documents.get("warehouseStock/infal/items/oil").currentStock, 18);
});

test("preparer reassignment validates the new person and preserves assignment history", async () => {
  const s = await setup(true);
  s.documents.set(`users/${preparer.id}`, { ...preparer, active: false });
  await assert.rejects(s.op("assign", { assignedPreparerIds: [preparer.id], reason: "Cambio de personal" }), /no está activo/);
  await s.op("assign", { assignedPreparerIds: [seller.id], reason: "Cambio de personal" });
  assert.deepEqual(s.shipment().assignedPreparerIds, [seller.id]);
  const event = [...s.documents.entries()].find(([path, value]) => path.includes("/events/") && value.action === "assign")[1];
  assert.deepEqual(event.before.assignedPreparerIds, [preparer.id]);
  assert.deepEqual(event.after.assignedPreparerIds, [seller.id]);
  assert.equal(event.actorId, admin.id);
  assert.ok(s.documents.has(`sales/${s.result.id}`));
});

test("web pickup follows preparation, ready-to-pick-up and customer-code confirmation without a courier or another stock write", async () => {
  const s = await setup(true), shipment = s.shipment(), saleId = s.result.id, pickupCode = "A1B2C3D4E5";
  shipment.creationSource = "ecommerce"; shipment.orderId = "pickup-order-qa"; shipment.fulfillmentType = "pickup"; shipment.deliveryType = "pickup"; shipment.pickupCode = pickupCode;
  shipment.pickupLocationId = "valle"; shipment.pickupLocationName = "Local Valle";
  s.documents.set(`shipments/${shipment.id}`, shipment);
  const saleDoc = s.documents.get(`sales/${saleId}`); saleDoc.sourceType = "ecommerce"; saleDoc.shipmentId = shipment.id; saleDoc.deliveryMethod = "pickup"; s.documents.set(`sales/${saleId}`, saleDoc);
  s.documents.set("orders/pickup-order-qa", { status: "paid", saleId, shipmentId: shipment.id, shipping: { method: "pickup", amount: 0 }, pickupCode });
  const stock = s.documents.get("locationStock/valle/items/oil").currentStock;
  await s.op("start_preparing", {}, preparer); await s.op("ready", {}, preparer);
  assert.equal(s.shipment().status, "listo_retirar"); assert.equal(courierAction(s.shipment()), null);
  await assert.rejects(s.op("pickup_complete", { pickupCode: "0000000000" }), /código de retiro no coincide/);
  await s.op("pickup_complete", { pickupCode });
  assert.equal(s.shipment().status, "entregado"); assert.equal(shippingBucket(s.shipment()), "completed");
  assert.equal(s.documents.get("orders/pickup-order-qa").status, "completed");
  assert.equal(s.documents.get("orders/pickup-order-qa").fulfillmentStatus, "entregado");
  assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, stock);
});

test("web fulfillment changes atomically switch between pickup and manual delivery without touching sale or stock", async () => {
  const s = await setup(true), shipment = s.shipment(), saleId = s.result.id;
  shipment.creationSource = "ecommerce"; shipment.orderId = "web-order-qa"; shipment.fulfillmentType = "delivery"; shipment.paymentStatus = "approved";
  s.documents.set(`shipments/${shipment.id}`, shipment);
  const saleDoc = s.documents.get(`sales/${saleId}`); saleDoc.sourceType = "ecommerce"; saleDoc.deliveryMethod = "shipping"; saleDoc.shipmentId = shipment.id;
  s.documents.set(`sales/${saleId}`, saleDoc);
  s.documents.set("orders/web-order-qa", { status: "paid", saleId, shipmentId: shipment.id, deliveryMethod: "shipping", pickupCode: null, shipping: { method: "delivery", amount: 500, address: { street: "Calle previa", number: "123" }, pickup: null } });
  s.documents.set("locations/pickup-qa", { name: "Local de retiro QA", address: "Av. Prueba 123, CABA", active: true });
  const stock = s.documents.get("locationStock/valle/items/oil").currentStock;
  const movements = [...s.documents.keys()].filter(path => path.startsWith("stockMovements/")).length;
  await s.op("ready", {}, preparer);
  await createCourierSession({ body: { sessionId: "fulfillment-route", requestId: "fulfillment-route-create", shipmentIds: [shipment.id], leg: "direct", newToken: routeToken }, session: session(admin), runTransaction: s.runTransaction, now, env: {} });

  await s.op("fulfillment", { fulfillmentType: "pickup", pickupLocationId: "pickup-qa", reason: "El cliente prefiere retirar" });
  const pickup = s.shipment(), pickupOrder = s.documents.get("orders/web-order-qa");
  assert.equal(pickup.fulfillmentType, "pickup"); assert.equal(pickup.deliveryType, "pickup"); assert.equal(pickup.pickupLocationName, "Local de retiro QA");
  assert.equal(pickup.destination.displayAddress, "Av. Prueba 123, CABA"); assert.match(pickup.pickupCode, /^[A-F0-9]{10}$/);
  assert.equal(pickupOrder.shipping.method, "pickup"); assert.equal(pickupOrder.shipping.address, null); assert.equal(pickupOrder.deliveryMethod, "pickup"); assert.equal(pickupOrder.pickupCode, pickup.pickupCode);
  assert.equal(s.documents.get(`sales/${saleId}`).deliveryMethod, "pickup");
  assert.equal(s.documents.get("deliverySessions/fulfillment-route").status, "revoked");

  await s.op("fulfillment", { fulfillmentType: "delivery", deliveryType: "manual", displayAddress: "Calle nueva 456, CABA", notes: "Entregar por la tarde", reason: "El cliente cambia a envío" });
  const delivery = s.shipment(), deliveryOrder = s.documents.get("orders/web-order-qa");
  assert.equal(delivery.fulfillmentType, "delivery"); assert.equal(delivery.deliveryType, "manual"); assert.equal(delivery.pickupCode, null);
  assert.equal(delivery.destination.displayAddress, "Calle nueva 456, CABA"); assert.equal(delivery.destination.notes, "Entregar por la tarde");
  assert.equal(deliveryOrder.shipping.method, "delivery"); assert.deepEqual(deliveryOrder.shipping.address, { displayAddress: "Calle nueva 456, CABA" }); assert.equal(deliveryOrder.shipping.amount, 500);
  assert.equal(deliveryOrder.deliveryMethod, "delivery"); assert.equal(deliveryOrder.pickupCode, null); assert.equal(s.documents.get(`sales/${saleId}`).deliveryMethod, "delivery");
  assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, stock);
  assert.equal([...s.documents.keys()].filter(path => path.startsWith("stockMovements/")).length, movements);
  const event = [...s.documents.entries()].filter(([path, value]) => path.startsWith(`shipments/${shipment.id}/events/`) && value.action === "fulfillment").at(-1);
  assert.equal(event[1].before, "pickup"); assert.equal(event[1].after, "delivery"); assert.equal(event[1].actorRole, "admin");
});

test("web fulfillment changes require an editable web order and reject invalid targets before writes", async () => {
  const s = await setup(true), shipment = s.shipment();
  shipment.creationSource = "ecommerce"; shipment.orderId = "web-order-qa"; shipment.fulfillmentType = "delivery";
  s.documents.set(`shipments/${shipment.id}`, shipment);
  const saleDoc = s.documents.get(`sales/${s.result.id}`); saleDoc.sourceType = "ecommerce"; saleDoc.shipmentId = shipment.id; s.documents.set(`sales/${s.result.id}`, saleDoc);
  s.documents.set("orders/web-order-qa", { saleId: s.result.id, shipmentId: shipment.id, shipping: { method: "delivery" } });
  const original = structuredClone(shipment), before = s.documents.size;
  await assert.rejects(s.op("fulfillment", { fulfillmentType: "pickup", pickupLocationId: "missing", reason: "Cambio de entrega" }), /local activo/);
  assert.deepEqual(s.shipment(), original); assert.equal(s.documents.size, before);
  await assert.rejects(s.op("fulfillment", { fulfillmentType: "pickup", pickupLocationId: "valle", reason: "Cambio de entrega" }, seller), /permiso/);
  await assert.rejects(s.op("fulfillment", { fulfillmentType: "invalid", reason: "Cambio de entrega" }), /modalidad/);
  assert.deepEqual(s.shipment(), original); assert.equal(s.documents.size, before);
});

test("bulk courier replacement is atomic, audited, idempotent and preserves other route members", async () => {
  const store = memoryStore(), shipments = [];
  for (let i = 0; i < 3; i++) {
    const created = await createShippingSale({ sale: sale(), session: session(admin), requestId: `replacement-sale-${i}`, administrative: true, runTransaction: store.runTransaction, now });
    shipments.push(created.shipmentId);
    await shippingOperation({ body: { mode: "ready", shipmentId: created.shipmentId, requestId: `replacement-ready-${i}` }, session: session(preparer), runTransaction: store.runTransaction, now, env: {} });
  }
  const makeRoute = (body, user = admin) => createCourierSession({ body, session: session(user), runTransaction: store.runTransaction, now, env: {} });
  const original = { sessionId: "old-route", requestId: "old-route-req", shipmentIds: shipments, leg: "direct", newToken: routeToken };
  await makeRoute(original);
  const replacement = { sessionId: "replacement-route", requestId: "replacement-request", shipmentIds: shipments.slice(0, 2), leg: "direct", newToken: token2, replaceExisting: true, reason: "Cambio de turno QA" };
  await assert.rejects(makeRoute(replacement, seller), /permiso/);
  await assert.rejects(makeRoute({ ...replacement, replaceExisting: false }), /reparto activo/);
  const before = structuredClone(store.documents.get(`shipments/${shipments[0]}`));
  const closed = store.documents.get(`shipments/${shipments[1]}`); closed.status = "entregado";
  await assert.rejects(makeRoute(replacement), /estado o transporte/);
  assert.deepEqual(store.documents.get(`shipments/${shipments[0]}`), before);
  closed.status = "listo_retirar";
  const result = await makeRoute(replacement);
  assert.deepEqual(await makeRoute(replacement), result);
  assert.deepEqual(store.documents.get("deliverySessions/old-route").shipmentIds, [shipments[2]]);
  assert.equal(store.documents.get("deliverySessions/old-route").status, "active");
  for (const shipmentId of shipments.slice(0, 2)) {
    assert.equal(store.documents.get(`shipments/${shipmentId}`).courierSessionId, "replacement-route");
    const events = [...store.documents.entries()].filter(([key, value]) => key.startsWith(`shipments/${shipmentId}/events/`) && value.action === "courier_reassigned");
    assert.equal(events.length, 1); assert.equal(events[0][1].previousSessionId, "old-route"); assert.equal(events[0][1].actorId, admin.id);
    await assert.rejects(shippingOperation({ body: { mode: "courier_action", shipmentId, token: routeToken, action: "pickup", requestId: `stale-${shipmentId}` }, runTransaction: store.runTransaction, now, env: {} }));
  }
  const remaining = await shippingOperation({ body: { mode: "detail", token: routeToken }, runTransaction: store.runTransaction, now, env: {} });
  assert.deepEqual(remaining.shipments.map(item => item.id), [shipments[2]]);
  const next = await shippingOperation({ body: { mode: "detail", token: token2 }, runTransaction: store.runTransaction, now, env: {} });
  assert.equal(next.shipments.length, 2);
});
