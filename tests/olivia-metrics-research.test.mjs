import test from "node:test";
import assert from "node:assert/strict";
import { fixture, start, functionResponse, textResponse } from "./helpers/olivia-fixture.mjs";
import { runTool } from "../netlify/functions/_lib/olivia/tools.mjs";
import { salesMetrics, readSales } from "../netlify/functions/_lib/olivia/analytics.mjs";
import { capabilityAllowed, selectCapabilities } from "../src/shared/oliviaCapabilities.mjs";
import { providerUsage } from "../netlify/functions/_lib/olivia/provider.mjs";
import { costForUsage } from "../src/shared/oliviaContracts.mjs";
import { oliviaInlineParts } from "../src/gestion/olivia/messageFormatting.mjs";

const historyArgs = { startDate: null, endDate: null, locationId: null, productId: null, sellerId: null };
const citation = { type: "url_citation", url: "https://example.org/formula", title: "Fórmula" };
const researchResponse = () => ({ ...textResponse("Método externo verificado."), output: [{ type: "web_search_call", action: { type: "search" } }, { type: "message", content: [{ type: "output_text", text: "Método externo verificado.", annotations: [citation, citation, { type: "url_citation", url: "javascript:alert(1)" }] }] }] });

test("missing metric period asks instead of reading an assumed month", async () => {
  const f = fixture({ role: "admin" });
  const result = await runTool({ session: f.session, store: f.store, name: "get_sales_metrics", args: historyArgs, context: {}, now: f.clock() });
  assert.equal(result.state, "DATOS_INCOMPLETOS");
  assert.match(result.data.message, /mes.*rango.*historial/);
});

test("selected all-time period persists beyond recent chat messages and missing period stays a natural question", async () => {
  let asked = false;
  const f = fixture({ role: "admin", provider: async (path, request) => {
    const context = JSON.parse(request.input[0].content);
    if (asked) assert.equal(context.selectedMetricsPeriod.scope, "all-time");
    if (request.input.some((item) => item.type === "function_call_output")) return textResponse("Todo el historial registrado.");
    if (asked) return functionResponse("get_sales_metrics", historyArgs);
    return functionResponse("get_all_time_sales_metrics", { locationId: null, productId: null, sellerId: null });
  } });
  const { conversationId } = await start(f);
  await f.engine.chat(f.session, { conversationId, requestId: "all_time", message: "¿Cuánto vendimos en todo el historial?", screenContext: { module: "metrics" } });
  assert.equal(f.documents.get(`oliviaConversations/${conversationId}`).metricsPeriod.scope, "all-time");
  f.documents.get(`oliviaConversations/${conversationId}`).messages = [];
  asked = true; f.advance(2000);
  const result = await f.engine.chat(f.session, { conversationId, requestId: "missing_period", message: "Quiero cambiar el período del ticket promedio", screenContext: { module: "metrics" } });
  assert.match(result.messages.at(-1).content, /Qué período.*mes.*historial/);
  assert.equal(result.state, "DATOS_INCOMPLETOS");
});

test("all recorded history includes old years, ranks units independently of revenue and has no fake comparison", async () => {
  const f = fixture({ role: "admin" });
  for (const [path] of f.documents) if (path.startsWith("sales/")) f.documents.delete(path);
  const sales = [
    { id: "old", createdAt: new Date("2022-01-01T14:00:00Z"), locationId: "local_a", total: 100, items: [{ productId: "a", name: "Muchos", qty: 10, subtotal: 100 }] },
    { id: "recent", createdAt: f.clock(), locationId: "local_a", total: 1000, items: [{ productId: "b", name: "Caro", qty: 1, subtotal: 1000 }] },
    { id: "other", createdAt: f.clock(), locationId: "local_b", total: 9000, items: [] },
  ];
  for (const sale of sales) f.documents.set(`sales/${sale.id}`, sale);
  const result = await salesMetrics({ store: f.store, args: { allTime: true, locationId: "local_a" }, now: f.clock() });
  assert.equal(result.total, 1100); assert.equal(result.count, 2); assert.equal(result.averageTicket, 550);
  assert.equal(result.topProductsByUnits[0].productId, "a");
  assert.equal(result.period.start, "2022-01-01"); assert.equal(result.period.scope, "all-time");
  assert.equal(result.previous, null); assert.equal(result.changePercent, null); assert.equal(result.partial, false);
  const range = await salesMetrics({ store: f.store, args: { startDate: "2022-01-01", endDate: "2026-10-04", locationId: "local_a" }, now: f.clock() });
  assert.equal(range.total, 1100);
});

test("all-time paging remains explicitly partial at the bound and empty history has no invented first date", async () => {
  const f = fixture({ role: "admin" });
  for (const [path] of f.documents) if (path.startsWith("sales/")) f.documents.delete(path);
  const empty = await salesMetrics({ store: f.store, args: { allTime: true }, now: f.clock() });
  assert.equal(empty.period.start, null); assert.equal(empty.averageTicket, null);
  for (let n = 0; n < 151; n++) f.documents.set(`sales/s${n}`, { id: `s${n}`, createdAt: f.clock(), total: 1, items: [] });
  const partial = await readSales({ store: f.store, args: { allTime: true }, maxPages: 1, now: f.clock() });
  assert.equal(partial.partial, true); assert.equal(partial.period.startComplete, false); assert.equal(partial.fetched, 150);
  const full = await readSales({ store: f.store, args: { allTime: true }, now: f.clock() });
  assert.equal(full.fetched, 151); assert.equal(full.partial, false);
});

test("web research is limited to administrators and current server permission, with no business context sent", async () => {
  for (const role of ["seller", "operational_admin"]) {
    const f = fixture({ role });
    assert.equal(capabilityAllowed(f.session, "research_web_metric"), false);
    await assert.rejects(runTool({ session: f.session, store: f.store, name: "research_web_metric", args: { topic: "ticket promedio" }, context: {}, now: f.clock() }), { code: "permission-denied" });
  }
  const f = fixture({ role: "admin" });
  assert.ok(selectCapabilities(f.session, "Investiga una métrica en internet").includes("research_web_metric"));
  const result = await runTool({ session: f.session, store: f.store, name: "research_web_metric", args: { topic: "fórmula de rotación de inventario" }, context: { locationId: "private_local" }, now: f.clock(), provider: async (path, request) => {
    assert.equal(request.model, "gpt-6-luna"); assert.equal(request.store, false); assert.equal(request.max_tool_calls, 1);
    assert.equal(request.input, "fórmula de rotación de inventario");
    assert.doesNotMatch(JSON.stringify(request), /private_local|Local A|user_a/);
    return researchResponse();
  } });
  assert.equal(result.data.sources.length, 1); assert.equal(result.data.verified, true);
  f.documents.set("users/user_a", { ...f.session.profile, permissionDeny: { metrics: ["view", "admin"] } });
  await assert.rejects(runTool({ session: f.session, store: f.store, name: "research_web_metric", args: { topic: "ticket promedio" }, context: {}, now: f.clock() }), { code: "permission-denied" });
});

test("research engine bills nested Luna and the search, retaining clickable sources and missing business inputs", async () => {
  const f = fixture({ role: "admin", provider: async (path, request) => {
    if (request.tools?.some((tool) => tool.type === "web_search")) return researchResponse();
    if (!request.input.some((item) => item.type === "function_call_output")) return functionResponse("research_web_metric", { topic: "fórmula del margen bruto" });
    return textResponse("El margen bruto requiere costos de mercadería; faltan esos datos internos.");
  } });
  const { conversationId } = await start(f);
  const result = await f.engine.chat(f.session, { conversationId, requestId: "web_metric", message: "Investiga en la web cómo calcular margen bruto para mi negocio", screenContext: { module: "metrics" } });
  const event = f.documents.get("oliviaUsage/user_a_web_metric");
  assert.equal(event.modelCalls.length, 3);
  assert.equal(event.modelCalls.filter((call) => call.operation === "web-research").length, 1);
  assert.equal(event.totalTokens, 230);
  assert.equal(event.modelCalls[1].webSearchCalls, 1);
  assert.ok(event.actualCostUsd > 0.01);
  assert.match(result.messages.at(-1).content, /faltan.*datos internos/);
  assert.match(result.messages.at(-1).content, /\[Fórmula\]\(https:\/\/example.org\/formula\)/);
});

test("search pricing includes only search actions and keeps unknown nested usage unknown", () => {
  const payload = researchResponse();
  payload.output.push({ type: "web_search_call", action: { type: "open_page" } });
  assert.equal(providerUsage(payload, "gpt-6-luna").webSearchCalls, 1);
  const config = { pricing: { "gpt-6-luna": { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 } }, officialDollarSellRate: 1540 };
  const usage = providerUsage(payload, "gpt-6-luna");
  assert.equal(costForUsage(usage, config).actualCostUsd, 0.010009);
  assert.equal(costForUsage({ modelCalls: [usage, { model: "gpt-6-luna", measurement: "unconfirmed" }] }, config).actualCostUsd, null);
  assert.deepEqual(oliviaInlineParts("[Fuente](https://example.org/formula)"), [{ strong: false, text: "Fuente", href: "https://example.org/formula" }]);
  assert.equal(oliviaInlineParts("[Clave](https://user:pass@example.org)")[0].href, undefined);
});
