import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createShippingSale, createCourierSession, readCourierSession, shippingOperation, limitShippingPublic } from "../netlify/functions/_lib/shipping.mjs";
import { cancelSaleAndInvoice } from "../netlify/functions/_lib/arca/saleCancellation.mjs";
import { shippingBucket, courierAction, customerTrackingView, validatePoint, deliveryProof, distanceMeters } from "../src/shared/shippingDomain.mjs";
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
test("direct courier: scoped action, no internal data, one contextual delivery, server-approved exception; delivery stops GPS", async () => {
  const s = await setup(true);
  await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  const detail = await s.op("detail", { token }, null);
  assert.equal(detail.action.action, "pickup"); assert.equal(detail.itemsSnapshot, undefined); assert.equal(detail.customerSnapshot, undefined);
  await assert.rejects(s.op("courier_action", { token, action: "deliver" }, null), /no corresponde/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  await assert.rejects(s.op("courier_action", { token, action: "deliver" }, null), /geocerca/);
  await assert.rejects(s.op("delivery_exception", { token, grantHash: sha(token), reason: "Sin señal" }, null), /permiso/);
  await s.op("delivery_exception", { grantHash: sha(token), reason: "Entrega verificada por llamada" });
  const body = { mode: "courier_action", shipmentId: s.result.shipmentId, token, requestId: "delivery-once", action: "deliver" };
  await shippingOperation({ body, runTransaction: s.runTransaction, now });
  await shippingOperation({ body, runTransaction: s.runTransaction, now });
  assert.equal(s.shipment().status, "entregado"); assert.equal(s.shipment().lastPosition, null);
  assert.equal([...s.documents.values()].filter(row => row.event === "delivery_completed").length, 2);
  await assert.rejects(s.op("position", { token, point: { lat: 0, lng: 0, accuracy: 5, observedAt: now.toISOString() } }, null), /permiso/);
});
test("repository has separate legs, hides customer from first courier and GPS until final departure", async () => {
  const s = await setup(); await s.op("approve", { ...approval, deliveryType: "repository" }); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  assert.equal((await s.op("tracking", { token: trackToken }, null)).position, null);
  await s.op("issue_access", { kind: "courier", leg: "origin", newToken: token });
  await s.op("issue_access", { kind: "courier", leg: "final", newToken: token2 });
  const detail = await s.op("detail", { token }, null); assert.equal(detail.customerPhone, null); assert.equal(detail.destination.displayName, "Repositorio de Flor Mía"); assert.equal(detail.destination.displayAddress, undefined);
  await assert.rejects(s.op("position", { token, point: {} }, null), /permiso/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  await assert.rejects(s.op("courier_action", { token: token2, action: "repository_depart" }, null), /no corresponde/);
  await s.op("courier_action", { token, action: "repository_receive" }, null);
  const received = await s.op("tracking", { token: trackToken }, null);
  assert.equal(received.label, "En repositorio"); assert.equal(received.position, null); assert.equal(received.destination, undefined);
  await s.op("courier_action", { token: token2, action: "repository_depart" }, null);
  assert.equal(s.shipment().status, "reparto_final");
  assert.equal((await s.op("tracking", { token: trackToken }, null)).label, "En camino a tu domicilio");
  await s.op("issue_access", { kind: "tracking", newToken: "d".repeat(43) });
  await assert.rejects(s.op("tracking", { token: trackToken }, null), /permiso/);
  assert.equal(courierAction(s.shipment(), "origin"), null);
});
test("tracking is readonly, distinct, revocable, excludes PII and only exposes fresh final-mile GPS", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  await s.op("issue_access", { kind: "courier", newToken: token });
  const view = await s.op("tracking", { token: trackToken }, null);
  assert.equal(view.position, null); assert.equal(view.destination, null); assert.equal(view.customerSnapshot, undefined);
  await assert.rejects(s.op("courier_action", { token: trackToken, action: "pickup" }, null), /permiso/);
  await s.op("courier_action", { token, action: "pickup" }, null);
  await s.op("gps_start", { token, gpsSessionId: "gps-test" }, null);
  await s.op("position", { token, gpsSessionId: "gps-test", point: { lat: -34.6, lng: -58.4, accuracy: 10, observedAt: now.toISOString() } }, null);
  const live = await s.op("tracking", { token: trackToken }, null);
  assert(live.position); assert.equal(live.trail.length, 1); assert.equal(live.destination, null);
  assert.equal((await s.op("tracking", { token: trackToken }, null, new Date(now.valueOf() + 130000))).position, null);
  await assert.rejects(s.op("detail", { token }, null, new Date(now.valueOf() + 5 * 3600000)), /vencido/);
  await s.op("revoke_access");
  await assert.rejects(s.op("tracking", { token: trackToken }, null), /permiso/);
  await assert.rejects(s.op("detail", { token }, null), /permiso/);
});

test("QR courier authorization is bound to its printed shipment, not another valid credential", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  const detail = await s.op("detail", { token, lookupId: s.shipment().publicLookupId }, null);
  assert.equal(detail.leg, "direct"); assert.equal(detail.gpsAllowed, false); assert(detail.accessExpiresAt);
  await assert.rejects(s.op("detail", { token, lookupId: "another_label_lookup" }, null), /permiso/);
  await assert.rejects(s.op("courier_action", { token, lookupId: "another_label_lookup", action: "pickup" }, null), /permiso/);
  assert.equal(s.shipment().status, "listo_retirar");
  await assert.rejects(s.op("gps_start", { token, gpsSessionId: "early" }, null), /únicamente/);
});

test("GPS stop clears tracking immediately; late points and old sessions cannot restart publication", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  await s.op("courier_action", { token, action: "pickup" }, null);
  const point = { lat: -34.6, lng: -58.4, accuracy: 10, observedAt: now.toISOString() };
  await assert.rejects(s.op("position", { token, point }, null), /sesión GPS/);
  await s.op("gps_start", { token, gpsSessionId: "first" }, null);
  const saved = await s.op("position", { token, gpsSessionId: "first", point }, null);
  assert(saved.saved); assert(saved.receivedAt); assert((await s.op("tracking", { token: trackToken }, null)).position);
  await s.op("gps_stop", { token, gpsSessionId: "first" }, null);
  assert.equal(s.shipment().lastPosition, null);
  assert.equal((await s.op("tracking", { token: trackToken }, null)).position, null);
  await assert.rejects(s.op("position", { token, gpsSessionId: "first", point }, null), /sesión GPS/);
  await s.op("gps_start", { token, gpsSessionId: "second" }, null);
  await s.op("position", { token, gpsSessionId: "second", point }, null);
  await s.op("gps_stop", { token, gpsSessionId: "first" }, null);
  assert(s.shipment().lastPosition);
  assert.equal(s.shipment().activeGpsSession.id, "second");
  await s.op("delivery_exception", { grantHash: sha(token), reason: "Cierre supervisado de prueba GPS" });
  await s.op("courier_action", { token, action: "deliver" }, null);
  assert.equal(s.shipment().activeGpsSession, null); assert.equal(s.shipment().lastPosition, null); assert.deepEqual(s.shipment().gpsTrail, []);
  await assert.rejects(s.op("gps_start", { token, gpsSessionId: "after-delivery" }, null), /únicamente/);
});
test("one temporary courier session shares GPS once across multiple orders and closes after the last delivery", async () => {
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
  const initial = await courier("detail"); assert.equal(initial.kind, "courier_route"); assert.equal(initial.shipments.length, 2);
  await courier("courier_action", shipments[0], { requestId: "pickup-first", action: "pickup" });
  await courier("gps_start", null, { gpsSessionId: "shared-gps" });
  const point = { lat: -34.6, lng: -58.4, accuracy: 15, observedAt: now.toISOString() };
  await courier("position", null, { gpsSessionId: "shared-gps", point });
  assert.equal(store.documents.get(`deliverySessions/${route.sessionId}`).lastPosition.lat, point.lat);
  assert(shipments.every(id => store.documents.get(`shipments/${id}`).lastPosition == null), "the live point is stored once per route, not copied onto each order");
  assert((await shippingOperation({ body: { mode: "tracking", token: trackToken }, runTransaction: store.runTransaction, now, env: {} })).position);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position, null);
  await courier("courier_action", shipments[1], { requestId: "pickup-second", action: "pickup" });
  for (const shipmentId of shipments) await shippingOperation({ body: { mode: "delivery_exception", shipmentId, requestId: `exception-${shipmentId}`, grantHash: sha(routeToken), reason: "Excepción QA autorizada" }, session: session(admin), runTransaction: store.runTransaction, now, env: {} });
  await courier("courier_action", shipments[0], { requestId: "deliver-first", action: "deliver" });
  assert.equal(store.documents.get(`deliverySessions/${route.sessionId}`).gpsEnabled, true);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackToken }, runTransaction: store.runTransaction, now, env: {} })).position, null);
  assert((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position);
  await courier("courier_action", shipments[1], { requestId: "deliver-second", action: "deliver" });
  const completed = store.documents.get(`deliverySessions/${route.sessionId}`);
  assert.equal(completed.status, "completed"); assert.equal(completed.gpsEnabled, false); assert.equal(completed.lastPosition, null);
  const receipt = await courier("detail"); assert.equal(receipt.status, "completed"); assert.equal(receipt.shipments[0].customerPhone, undefined);
  assert.equal((await shippingOperation({ body: { mode: "tracking", token: trackTokenTwo }, runTransaction: store.runTransaction, now, env: {} })).position, null);
  await assert.rejects(courier("position", null, { gpsSessionId: "shared-gps", point }), /ya terminó/);
});

test("courier-session management fallback requires shipping-view permission and returns only live route fields", async () => {
  const store = memoryStore(), nowPosition = { lat: -34.6, lng: -58.4, accuracy: 12, observedAt: now.toISOString(), receivedAt: now };
  store.documents.set("deliverySessions/manager-view", { status: "active", leg: "direct", shipmentIds: ["one"], createdBy: "admin", accessHash: "secret-hash", gpsEnabled: true, expiresAt: new Date(now.valueOf() + 3600000), lastPosition: { ...nowPosition, grantHash: "sensitive-hash" }, gpsTrail: [nowPosition], gpsSession: { id: "internal", accessHash: "sensitive-hash" } });
  const view = await readCourierSession({ sessionId: "manager-view", session: session(admin), runTransaction: store.runTransaction, now });
  assert.equal(view.gpsEnabled, true); assert.deepEqual(view.lastPosition, { lat: nowPosition.lat, lng: nowPosition.lng, accuracy: nowPosition.accuracy, observedAt: nowPosition.observedAt });
  assert.equal(view.gpsTrail.length, 1); assert.equal(view.accessHash, undefined); assert.equal(view.gpsSession, undefined); assert.equal(view.createdBy, undefined);
  await assert.rejects(readCourierSession({ sessionId: "manager-view", session: session(seller), runTransaction: store.runTransaction, now }), /permiso/);
});

test("GPS rejects anomalous jumps and returns only a bounded, PII-free route to the customer", async () => {
  const s = await setup(true); await s.op("ready", {}, preparer);
  await s.op("issue_access", { kind: "courier", newToken: token });
  await s.op("issue_access", { kind: "tracking", newToken: trackToken });
  await s.op("courier_action", { token, action: "pickup" }, null);
  await s.op("gps_start", { token, gpsSessionId: "route" }, null);
  const first = { lat: -34.6, lng: -58.4, accuracy: 10, observedAt: now.toISOString() };
  await s.op("position", { token, gpsSessionId: "route", point: first }, null);
  const later = new Date(now.valueOf() + 10000);
  await assert.rejects(s.op("position", { token, gpsSessionId: "route", point: { ...first, lat: -34.5, observedAt: later.toISOString() } }, null, later), /salto GPS/);
  assert.equal(s.shipment().gpsTrail.length, 1);
  const view = await s.op("tracking", { token: trackToken }, null);
  assert.deepEqual(view.trail, [{ lat: first.lat, lng: first.lng, observedAt: first.observedAt }]);
  assert.equal(view.customerSnapshot, undefined); assert.equal(view.destination, null);
});

test("geofence validates accuracy, age, current grant, verified marker and destination revision of exceptions", () => {
  const point = { lat: -34.6, lng: -58.4, accuracy: 10, observedAt: now.toISOString(), grantHash: "hash" };
  const shipment = { destination: { lat: -34.6, lng: -58.4, verified: true }, lastPosition: point }, grant = { hash: "hash", actorId: "courier" }, config = { radiusMeters: 60, maxAccuracyMeters: 30, maxAgeMs: 120000 };
  assert.equal(deliveryProof(shipment, grant, now, config).method, "geofence");
  assert.throws(() => deliveryProof({ ...shipment, lastPosition: { ...point, accuracy: 100 } }, grant, now, config), /precisa/);
  assert.throws(() => deliveryProof(shipment, { ...grant, hash: "other" }, now, config), /precisa/);
  assert.throws(() => deliveryProof(shipment, grant, new Date(now.valueOf() + 130000), config), /reciente/);
  assert.throws(() => deliveryProof({ ...shipment, destination: { ...shipment.destination, lng: -58 } }, grant, now, config), /fuera/);
  assert.equal(validatePoint({ ...point, lat: "-34.6" }, now), false);
  assert(distanceMeters(point, { ...point, lat: -34.601 }) > 100);
});
test("terminal exceptions never count as delivered and neither return nor cancel restock", async () => {
  for (const mode of ["cancel", "return", "undelivered"]) {
    const s = await setup(true); await s.op(mode, { reason: "Prueba de cierre" });
    assert.equal(shippingBucket(s.shipment()), "exceptions"); assert.equal(s.documents.get("locationStock/valle/items/oil").currentStock, 8);
  }
  assert.equal(customerTrackingView({ publicCode: "test", status: "hacia_repositorio", lastPosition: { lat: 0, lng: 0, accuracy: 1, observedAt: now.toISOString() } }, now).position, null);
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
