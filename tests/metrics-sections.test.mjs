import test from "node:test";
import assert from "node:assert/strict";
import { applyMetricsSection, changeMetricsSection, metricsLocationChoices, metricsLocationTypes, metricsContactChannels } from "../src/modules/locations/domain/metricsSections.js";
import { applyMetricsFilters, buildMetricsDateRange, calculateMetrics } from "../src/modules/locations/domain/metrics.js";
import { saleChannelId } from "../src/modules/locations/domain/channels.js";

const locations = [{ id: "store", type: "store" }, { id: "fair", type: "fair" }, { id: "event", type: "event", active: false }];
const state = { section: "all", locationType: "all", locationIds: [], channelIds: [] };
const sale = (id, locationId, sourceChannel, total, extra = {}) => ({ id, locationId, sourceChannel, total, status: "active", paymentStatus: "approved", createdAt: "2026-10-30T15:00:00Z", items: [{ productId: "oil", qty: 1, subtotal: total }], ...extra });
const sales = [sale("local", "store", "in_person", 1000), sale("fair-sale", "fair", "in_person", 2000), sale("event-sale", "event", "instagram", 500), sale("web", "store", "ecommerce", 1500), sale("chat", "", "whatsapp", 700, { stockOriginType: "warehouse" }), sale("legacy", "store", undefined, 300)];
const range = buildMetricsDateRange("month", "2026-10");
const report = (rows, view = state, filters = {}) => calculateMetrics(applyMetricsFilters(applyMetricsSection(rows, view, locations), filters, range), range);

test("ventas generales conserva todas las ventas una sola vez, sin sumar las vistas entre sí", () => {
  const metrics = report([...sales, sales[0]]);
  assert.equal(metrics.total, 6000);
  assert.equal(metrics.salesCount, 6);
  assert.equal(metrics.totalItems, 6);
  assert.equal(metrics.byChannel.reduce((sum, row) => sum + row.total, 0), metrics.total);
  assert.equal(report(sales, { ...state, section: "locations" }).total, 3300);
  assert.equal(report(sales, { ...state, section: "ecommerce" }).total, 1500);
  assert.equal(report(sales, { ...state, section: "channels" }).total, 1200);
  assert.equal(["locations", "ecommerce", "channels"].reduce((sum, section) => sum + report(sales, { ...state, section }).total, 0), metrics.total);
});

test("ubicaciones filtra por tipo y admite una o varias ubicaciones, sin incluir depósitos", () => {
  const view = { ...state, section: "locations" };
  assert.equal(report(sales, { ...view, locationType: "store" }).total, 1300);
  assert.equal(report(sales, { ...view, locationType: "fair" }).total, 2000);
  assert.equal(report(sales, { ...view, locationType: "event" }).total, 0);
  assert.equal(report(sales, { ...view, locationIds: ["store", "fair"] }).total, 3300);
  assert.equal(report(sales, { ...view, locationType: "fair", locationIds: ["store"] }).total, 0);
  assert.equal(report(sales, { ...view, locationIds: ["missing"] }).salesCount, 0);
});

test("canales admite selecciones múltiples y mantiene página web como vista independiente", () => {
  const view = { ...state, section: "channels", channelIds: ["whatsapp", "instagram"] };
  assert.deepEqual(applyMetricsSection(sales, view, locations).map(row => row.id), ["event-sale", "chat"]);
  assert.equal(report(sales, view).total, 1200);
  assert.equal(report(sales, { ...view, channelIds: ["ecommerce"] }).salesCount, 0);
  assert.deepEqual(metricsContactChannels(sales).map(row => row.id), ["whatsapp", "instagram", "phone"]);
});

test("cambiar de vista limpia sólo las subselecciones, conservando período y filtros comunes", () => {
  const original = { ...state, section: "locations", locationType: "fair", locationIds: ["fair"], channelIds: ["instagram"], month: "2026-10", sellerIds: ["seller"], productIds: ["oil"], discountIds: ["cash"], paymentMethods: ["debit"] };
  const next = changeMetricsSection(original, "ecommerce");
  assert.deepEqual({ section: next.section, type: next.locationType, locations: next.locationIds, channels: next.channelIds }, { section: "ecommerce", type: "all", locations: [], channels: [] });
  for (const key of ["month", "sellerIds", "productIds", "discountIds", "paymentMethods"]) assert.deepEqual(next[key], original[key]);
  assert.deepEqual(original.locationIds, ["fair"]);
});

test("página web no necesita subconjunto y los históricos se identifican por sus referencias", () => {
  const rows = [sale("source", "store", undefined, 1000, { sourceType: "ecommerce" }), sale("channel", "store", undefined, 500, { channelId: "ecommerce" }), ...sales];
  const view = { ...state, section: "ecommerce", locationIds: ["fair"], channelIds: ["instagram"] };
  assert.equal(report(rows, view).total, 3000);
  assert.equal(report(rows, view).byChannel.length, 1);
  assert.equal(saleChannelId(rows[0]), "ecommerce");
});

test("todas las vistas usan los mismos cálculos y excluyen simulaciones, pagos pendientes y anulaciones", () => {
  const web = sales[3];
  const cancelled = { ...web, id: "cancelled", status: "cancelled" };
  const rows = [web, web, { ...web, id: "sim", simulated: true }, { ...web, id: "provider", paymentProvider: "simulation" }, { ...web, id: "pending", paymentStatus: "pending" }, { ...web, id: "draft", status: "pending_payment", paymentStatus: undefined }, { ...web, id: "rejected", paymentStatus: "rejected" }, cancelled, cancelled, { ...web, id: "outside", createdAt: "2026-11-01T03:00:00Z" }];
  for (const section of ["all", "ecommerce"]) {
    const metrics = report(rows, { ...state, section }, { productIds: ["oil"] });
    assert.equal(metrics.total, 1500);
    assert.equal(metrics.salesCount, 1);
    assert.equal(metrics.cancelledTotal, 1500);
    assert.equal(metrics.ticket, 1500);
    assert.equal(metrics.timeline.reduce((sum, point) => sum + point.total, 0), 1500);
  }
});

test("los tipos disponibles conservan ubicaciones históricas y no ocultan eventos inactivos", () => {
  assert.equal(metricsLocationChoices(locations, "event").length, 1);
  assert.equal(metricsLocationChoices([{ id: "old" }], "store").length, 1);
  assert.ok(metricsLocationTypes([...locations, { id: "temp", type: "temporary" }]).some(row => row.id === "temporary"));
  const empty = report([], { ...state, section: "ecommerce" });
  assert.equal(empty.total, 0);
  assert.equal(empty.salesCount, 0);
  assert.equal(empty.ticket, 0);
});
