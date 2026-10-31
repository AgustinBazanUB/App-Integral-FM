import test from "node:test";
import assert from "node:assert/strict";
import { applyMetricsFilters, buildMetricsDateRange, calculateMetrics } from "../src/modules/locations/domain/metrics.js";
import { metricsChannelOptions, saleChannelId } from "../src/modules/locations/domain/channels.js";
import { summarizeEcommerceMetrics } from "../src/modules/locations/domain/ecommerceMetrics.js";

const range = buildMetricsDateRange("month", "2026-10");
const sale = (id, extra = {}) => ({ id, status: "active", sourceChannel: "ecommerce", paymentStatus: "approved", createdAt: "2026-10-30T15:00:00Z", total: 1500, shippingAmount: 500, deliveryMethod: "delivery", locationId: "qa-location", paymentMethod: "debit", items: [{ productId: "qa-oil", name: "Aceite QA", qty: 2, unitPrice: 500, subtotal: 1000 }], ...extra });
const report = (sales, filters = {}) => calculateMetrics(applyMetricsFilters(sales, filters, range), range);

test("ventas web concilian total, envío, productos, unidades y participación sin duplicar ventas", () => {
  const delivery = sale("delivery");
  const pickup = sale("pickup", { total: 1000, shippingAmount: 0, deliveryMethod: "pickup", items: [{ productId: "qa-oil", qty: 1, subtotal: 1000 }] });
  const manual = sale("manual", { sourceChannel: "in_person", total: 2500 });
  const metrics = report([delivery, delivery, pickup, manual]);
  const web = summarizeEcommerceMetrics(metrics);
  assert.equal(metrics.total, 5000);
  assert.equal(metrics.byChannel.find(row => row.key === "ecommerce").total, web.total);
  assert.deepEqual({ total: web.total, count: web.count, units: web.units, ticket: web.ticket, share: web.share }, { total: 2500, count: 2, units: 3, ticket: 1250, share: 50 });
  assert.equal(web.byDelivery.reduce((sum, row) => sum + row.productsTotal + row.shippingTotal, 0), web.total);
  assert.equal(web.byDelivery.find(row => row.key === "delivery").shippingTotal, 500);
  assert.equal(web.byDelivery.find(row => row.key === "pickup").shippingTotal, 0);
});

test("el canal web siempre se puede seleccionar y reconoce referencias históricas sin confundir envíos manuales", () => {
  assert.ok(metricsChannelOptions([]).some(row => row.id === "ecommerce"));
  const data = [sale("source", { sourceChannel: undefined, sourceType: "ecommerce" }), sale("channel", { sourceChannel: undefined, channelId: "ecommerce", stockOriginType: "warehouse", stockOriginId: "qa-warehouse", warehouseId: "qa-warehouse", locationId: "" }), sale("shipping", { sourceChannel: "whatsapp", sourceType: "shipping" })];
  const metrics = report(data, { channelIds: ["ecommerce"] });
  assert.equal(metrics.salesCount, 2);
  assert.equal(metrics.byChannel.length, 1);
  assert.equal(saleChannelId(data[2]), "whatsapp");
  assert.equal(metricsChannelOptions(data).filter(row => row.id === "ecommerce").length, 1);
  assert.equal(metrics.byStockOrigin.find(row => row.type === "warehouse").total, 1500);
  assert.equal(report(data, { channelIds: ["ecommerce"], locationIds: ["qa-location"] }).salesCount, 1);
});

test("simulaciones y pagos pendientes o rechazados no suman ingresos ni cancelaciones comerciales", () => {
  const cancelled = sale("cancelled", { status: "cancelled" });
  const data = [sale("real"), sale("simulated", { simulated: true }), sale("provider", { paymentProvider: "simulation" }), sale("sim-status", { paymentStatus: "simulated_approved" }), sale("pending", { paymentStatus: "pending" }), sale("rejected", { paymentStatus: "rejected" }), sale("deleted", { deleted: true }), cancelled, cancelled, sale("sim-cancelled", { status: "cancelled", simulated: true })];
  const metrics = report([...data, sale("pending-snapshot", { status: "pending_payment", paymentStatus: undefined })]);
  assert.equal(metrics.total, 1500);
  assert.equal(metrics.salesCount, 1);
  assert.equal(metrics.cancelled.length, 1);
  assert.equal(metrics.cancelledTotal, 1500);
  assert.equal(summarizeEcommerceMetrics(metrics).count, 1);
});

test("las métricas web respetan el mismo período, origen, producto y pago del informe", () => {
  const data = [sale("matching"), sale("outside", { createdAt: "2026-11-01T03:00:00Z" }), sale("other-origin", { locationId: "other" }), sale("other-product", { items: [{ productId: "other", qty: 1 }] }), sale("other-payment", { paymentMethod: "cash" })];
  const metrics = report(data, { channelIds: ["ecommerce"], locationIds: ["qa-location"], productIds: ["qa-oil"], paymentMethods: ["debit"] });
  assert.deepEqual(metrics.active.map(row => row.id), ["matching"]);
  assert.equal(summarizeEcommerceMetrics(metrics).share, 100);
  assert.equal(metrics.timeline.reduce((sum, row) => sum + row.total, 0), 1500);
});

test("históricos sin desglose de envío se informan sin inventar importes ni modalidades", () => {
  const web = summarizeEcommerceMetrics(report([sale("legacy", { shippingAmount: undefined, deliveryMethod: undefined, paymentStatus: undefined })]));
  assert.equal(web.total, 1500);
  assert.equal(web.byDelivery[0].key, "unknown");
  assert.equal(web.byDelivery[0].productsTotal, null);
  assert.equal(web.byDelivery[0].missingShipping, 1);
  const empty = summarizeEcommerceMetrics(report([]));
  assert.deepEqual({ total: empty.total, ticket: empty.ticket, share: empty.share, rows: empty.byDelivery.length }, { total: 0, ticket: 0, share: 0, rows: 0 });
});
