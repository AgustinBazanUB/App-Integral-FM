import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { readEventStream, streamFrame } from "../src/shared/oliviaStream.mjs";
import { openaiRequest } from "../netlify/functions/_lib/olivia/provider.mjs";
import { createOliviaTransport } from "../src/gestion/olivia/client.mjs";
import { audioBars, DictationCapture } from "../src/gestion/olivia/dictation.mjs";
import { validateAttachment, uploadAttachment, resolveAttachments } from "../netlify/functions/_lib/olivia/attachments.mjs";
import { boundedMultipart, boundedBody } from "../netlify/functions/_lib/olivia/requestBody.mjs";
import { OLIVIA_CAPABILITIES, selectCapabilities } from "../src/shared/oliviaCapabilities.mjs";
import { discoverSkills, routeSkills, loadSkill } from "../netlify/functions/_lib/olivia/skills.mjs";
import { toolDefinitions, runTool } from "../netlify/functions/_lib/olivia/tools.mjs";
import { executeToolBatch } from "../netlify/functions/_lib/olivia/toolExecution.mjs";
import { aggregateSales, fairForecast } from "../src/shared/oliviaAnalytics.mjs";
import { reduceConversationMemory } from "../src/shared/oliviaMemory.mjs";
import { fixture, start, textResponse } from "./helpers/olivia-fixture.mjs";

const stream = (bytes, width = 1) => new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width)); controller.close(); } });
const file = (name, bytes, type) => new File([bytes], name, { type });
const formFor = (conversationId, attachment, requestId = "file_a") => { const form = new FormData(); form.set("file", attachment); form.set("conversationId", conversationId); form.set("requestId", requestId); return form; };
test("SSE delivers split Argentine UTF-8, CRLF, multiple events and comments", async () => {
  const events = [], bytes = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"type":"delta",\r\ndata: "delta":"Flor Mía 🌸"}\r\n\r\ndata: [DONE]\r\n\r\n');
  await readEventStream(stream(bytes), (event) => events.push(event));
  assert.deepEqual(events, [{ type: "delta", delta: "Flor Mía 🌸" }]);
});
test("SSE rejects truncated frames, oversized data and aborts an open reader", async () => {
  await assert.rejects(readEventStream(stream(new TextEncoder().encode('data: {"type":"delta"}')), () => {}), /interrumpió/);
  await assert.rejects(readEventStream(stream(new TextEncoder().encode("x".repeat(20))), () => {}, { maxFrameBytes: 10 }), /límite/);
  const abort = new AbortController(); let cancelled = false;
  const open = new ReadableStream({ cancel() { cancelled = true; } });
  const read = readEventStream(open, () => {}, { signal: abort.signal }); abort.abort();
  await assert.rejects(read, { name: "AbortError" }); assert.equal(cancelled, true);
});
test("provider streams text before returning the measured response and supports GET/DELETE", async () => {
  const events = [], completed = textResponse("Hola 🌸");
  const bytes = new Uint8Array([...streamFrame({ type: "response.output_text.delta", delta: "Hola 🌸" }), ...streamFrame({ type: "response.completed", response: completed })]);
  const result = await openaiRequest("responses", { stream: true }, { env: { OPENAI_API_KEY: "fixture" }, onEvent: (event) => events.push(event), fetchImpl: async () => new Response(stream(bytes), { headers: { "content-type": "text/event-stream" } }) });
  assert.equal(events[0].delta, "Hola 🌸"); assert.deepEqual(result, completed);
  for (const method of ["GET", "DELETE"]) await openaiRequest("files/file-fixture", null, { method, env: { OPENAI_API_KEY: "fixture" }, fetchImpl: async (_, init) => { assert.equal(init.body, undefined); return Response.json({ id: "file-fixture" }); } });
  assert.deepEqual(await openaiRequest("files/file-fixture", null, { method: "DELETE", env: { OPENAI_API_KEY: "fixture" }, fetchImpl: async () => new Response(null, { status: 404 }) }), { deleted: true });
});
test("client consumes final state once and surfaces missing completion", async () => {
  const events = [], transport = createOliviaTransport({ getToken: async () => "fixture", fetchImpl: async () => new Response(stream(new Uint8Array([...streamFrame({ type: "delta", delta: "Hola" }), ...streamFrame({ type: "completed", result: { messages: [{ id: "one" }] } })])), { headers: { "content-type": "text/event-stream" } }) });
  const result = await transport.request({ operation: "chat" }, { onEvent: (event) => events.push(event) });
  assert.equal(events.length, 2); assert.equal(result.messages.length, 1);
  const broken = createOliviaTransport({ getToken: async () => "fixture", fetchImpl: async () => new Response(stream(streamFrame({ type: "delta", delta: "Parcial" })), { headers: { "content-type": "text/event-stream" } }) });
  await assert.rejects(broken.request({ operation: "chat" }, { onEvent() {} }), { code: "stream-incomplete" });
});
test("engine emits accepted input before deltas and persists exactly one user/assistant", async () => {
  const events = [], f = fixture({ provider: async (_, body, options) => { assert.equal(body.stream, true); assert.equal(events[0].type, "accepted"); options.onEvent({ type: "delta", delta: "Hola" }); return textResponse("Hola"); } });
  const state = await start(f), fields = { conversationId: state.conversationId, requestId: "stream_a", message: "Hola" };
  const result = await f.engine.chat(f.session, fields, { onEvent: (event) => events.push(event) });
  assert.equal(result.messages.filter((m) => m.role === "user").length, 1);
  assert.equal(result.messages.filter((m) => m.role === "assistant").length, 1);
  await assert.rejects(f.engine.chat(f.session, fields, { onEvent() {} }), { code: "request-already-used" });
  assert.equal(f.providerCalls(), 1);
});
test("waveform reflects actual amplitude, including silence", () => {
  assert.ok(audioBars(new Uint8Array(512).fill(128)).every((bar) => bar === 0));
  assert.ok(audioBars(new Uint8Array(512).fill(200)).every((bar) => bar > 0.9));
  const samples = new Uint8Array(512).fill(128); samples.fill(200, 0, 256);
  const bars = audioBars(samples); assert.ok(bars.slice(0, 12).every((bar) => bar > .9)); assert.ok(bars.slice(12).every((bar) => bar === 0));
});
function captureFixture() {
  const tracks = [{ stopCount: 0, stop() { this.stopCount++; } }], completed = [], frames = [], errors = [];
  class Recorder {
    static isTypeSupported(type) { return type === "audio/mp4"; }
    constructor(_, options) { this.mimeType = options.mimeType; this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable({ data: new Blob(["a".repeat(256)], { type: this.mimeType }) }); this.onstop(); }
  }
  class AudioContext {
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { getByteTimeDomainData(array) { array.fill(200); }, disconnect() {} }; }
    close() { this.closed = true; return Promise.resolve(); }
  }
  const capture = new DictationCapture({ Recorder, AudioContext, mediaDevices: { getUserMedia: async () => ({ getTracks: () => tracks }) }, frame: () => 1, cancelFrame() {}, onComplete: (audio, action) => completed.push({ audio, action }), onFrame: (frame) => frames.push(frame), onError: (error) => errors.push(error) });
  return { capture, tracks, completed, frames, errors };
}
for (const action of ["stop", "send", "cancel"]) test(`dictation ${action} releases all capture resources and respects editing/send semantics`, async () => {
  const f = captureFixture(); await f.capture.start();
  assert.ok(f.frames[0].bars[0] > .9);
  f.capture.stop(action); f.capture.stop(action);
  assert.ok(f.tracks[0].stopCount >= 1); assert.equal(f.capture.context, null); assert.equal(f.capture.recorder.state, "inactive");
  assert.equal(f.completed.length, action === "cancel" ? 0 : 1);
  if (action !== "cancel") { assert.equal(f.completed[0].action, action); assert.equal(f.completed[0].audio.type, "audio/mp4"); }
});
test("cancel during delayed permission stops the newly acquired stream", async () => {
  let grant, stopped = false;
  const f = captureFixture(); f.capture.mediaDevices = { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) };
  const pending = f.capture.start(); f.capture.stop("cancel"); grant({ getTracks: () => [{ stop() { stopped = true; } }] }); await pending;
  assert.equal(stopped, true); assert.equal(f.completed.length, 0);
});
const formats = [
  ["report.pdf", "%PDF-1.7\nfixture", "application/pdf"], ["photo.jpg", new Uint8Array([255,216,255,1]), "image/jpeg"],
  ["photo.png", new Uint8Array([137,80,78,71,13,10,26,10]), "image/png"], ["photo.webp", "RIFF0000WEBPfixture", "image/webp"],
  ["data.csv", "producto,unidades\nAceite,10", "text/csv"], ["procedure.txt", "Flor Mía: procedimiento", "text/plain"],
  ["procedure.docx", zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<document/>") }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["data.xlsx", zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "xl/workbook.xml": strToU8("<workbook/>") }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
];
for (const [name, bytes, type] of formats) test(`attachment validates ${name} metadata and content`, async () => { const result = await validateAttachment(file(name, bytes, type)); assert.equal(result.name, name); assert.equal(result.type, type); });
test("attachment rejects MIME spoofing, executable signatures, zip bombs, macros and oversize", async () => {
  await assert.rejects(validateAttachment(file("report.pdf", "%PDF-fixture", "image/png")), { code: "invalid-file" });
  await assert.rejects(validateAttachment(file("report.pdf", "MZ executable", "application/pdf")), { code: "invalid-file-content" });
  await assert.rejects(validateAttachment(file("large.txt", new Uint8Array(4194305), "text/plain")), { code: "invalid-file" });
  for (const dangerous of ["word/vbaProject.bin", "../escape.xml"]) await assert.rejects(validateAttachment(file("evil.docx", zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8("<document/>"), [dangerous]: strToU8("evil") }), formats[6][2])), { code: "invalid-file-content" });
  await assert.rejects(validateAttachment(file("bomb.docx", zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": new Uint8Array(21 * 1024 * 1024) }), formats[6][2])), { code: "invalid-file-content" });
});
test("upload is owner-bound and idempotent; expired/foreign attachments never reach a model", async () => {
  const f = fixture(), state = await start(f); let calls = 0;
  const form = formFor(state.conversationId, file(...formats[5]));
  const provider = async (path, body) => { calls++; assert.equal(path, "files"); assert.equal(body.get("purpose"), "user_data"); assert.equal(body.get("expires_after[seconds]"), "86400"); return { id: "file-fixture" }; };
  const first = await uploadAttachment({ ...f, form, provider, now: f.clock() });
  assert.equal(first.attachment.id, "file_a");
  await uploadAttachment({ ...f, form, provider, now: f.clock() }); assert.equal(calls, 1);
  assert.ok(first.attachment.expiresAt);
  const changed = formFor(state.conversationId, file("notes.txt", "Different bytes", "text/plain"));
  await assert.rejects(uploadAttachment({ ...f, form: changed, provider, now: f.clock() }), { code: "request-already-used" });
  await resolveAttachments({ ...f, ids: ["file_a"], conversationId: state.conversationId, now: f.clock() });
  await assert.rejects(resolveAttachments({ ...f, ids: ["file_a"], conversationId: "other", now: f.clock() }), { code: "file-unavailable" });
  await assert.rejects(resolveAttachments({ ...f, ids: ["file_a"], conversationId: state.conversationId, now: new Date(f.clock().getTime() + 86400001) }), { code: "file-unavailable" });
});
test("prior message files are rehydrated in a follow-up, bounded by the same conversation", async () => {
  const f = fixture(), state = await start(f), form = formFor(state.conversationId, file(...formats[0]));
  await uploadAttachment({ ...f, form, provider: async () => ({ id: "file-fixture" }), now: f.clock() });
  for (const [requestId, attachmentIds] of [["file_chat", ["file_a"]], ["followup", []]]) { await f.engine.chat(f.session, { requestId, conversationId: state.conversationId, message: "Explicá el documento", attachmentIds }); f.advance(2000); }
  const inputs = f.providerRequests.at(-1).input;
  assert.ok(inputs.some((item) => Array.isArray(item.content) && item.content.some((part) => part.file_id === "file-fixture")));
  assert.equal((await f.engine.state(f.session, state.conversationId)).messages[0].attachments[0].name, "report.pdf");
});
test("multipart has a real streamed byte cap and rejects duplicate file fields", async () => {
  const f = new FormData(); f.append("file", file(...formats[5])); f.append("file", file(...formats[0]));
  await assert.rejects(boundedMultipart(new Request("https://fixture.test", { method: "POST", body: f })), { code: "invalid-file" });
  await assert.rejects(boundedBody(new Request("https://fixture.test", { method: "POST", body: new Uint8Array(11) }), 10), { code: "request-too-large" });
});
test("selective tools and Skills exclude all administrative schemas from sellers", async () => {
  const seller = fixture().session, admin = fixture({ role: "admin" }).session;
  for (const query of ["creá ubicación y transferí stock", "usuarios roles auditoría", "pronosticá feria"]) {
    const tools = toolDefinitions(seller, { query, context: { module: "finance" }, loaded: Object.keys(OLIVIA_CAPABILITIES) });
    assert.equal(tools.some((tool) => tool.name === "prepare_stock_transfer" || tool.name === "get_users" || tool.name === "forecast_fair"), false);
    assert.ok(tools.some((tool) => tool.name === "search_tools"));
  }
  assert.ok(selectCapabilities(admin, "pronosticá la feria", {}).includes("forecast_fair"));
  assert.equal(selectCapabilities(admin, "envíos", {}).includes("get_users"), false);
  assert.ok(discoverSkills(admin).some((skill) => skill.name === "pronosticar-feria"));
  assert.ok((await routeSkills(admin, "¿Qué mercadería llevo a Pilar el fin de semana?")).some((skill) => skill.name === "pronosticar-feria"));
  assert.equal((await loadSkill(admin, "pronosticar-feria")).version, "1.0.0");
  assert.equal((await routeSkills(admin, "Prepará eso", [{ name: "pronosticar-feria", version: "1.0.0" }]))[0].name, "pronosticar-feria");
  assert.equal((await routeSkills(seller, "Prepará eso", [{ name: "pronosticar-feria", version: "1.0.0" }])).length, 0);
  assert.equal((await routeSkills(admin, "Prepará eso", [{ name: "pronosticar-feria", version: "0.1" }])).length, 0);
  assert.equal((await routeSkills(admin, "Hola", [{ name: "pronosticar-feria", version: "1.0.0" }])).length, 0);
  await assert.rejects(loadSkill(seller, "pronosticar-feria"), { code: "skill-not-allowed" });
  await assert.rejects(loadSkill(admin, "../../secret"), { code: "skill-not-allowed" });
});
test("tool batch runs independent reads together and respects preparation barriers", async () => {
  let active = 0, maximum = 0; const order = [];
  const calls = ["get_stock", "search_products", "prepare_sale", "get_stock"].map((name, i) => ({ name, call_id: String(i) }));
  const results = await executeToolBatch(calls, async (call) => { active++; maximum = Math.max(maximum, active); order.push(`start:${call.call_id}`); await new Promise((resolve) => setTimeout(resolve, 5)); order.push(`end:${call.call_id}`); active--; return call.name; });
  assert.equal(maximum, 2); assert.ok(order.indexOf("end:1") < order.indexOf("start:2")); assert.ok(order.indexOf("end:2") < order.indexOf("start:3")); assert.deepEqual(results.map((entry) => entry.value), calls.map((entry) => entry.name));
});
const sale = (id, date, qty = 10, locationId = "fair") => ({ id, locationId, sellerId: "seller", status: "active", createdAt: new Date(`${date}T15:00:00Z`), total: qty * 100, items: [{ productId: "oil", name: "Aceite", qty, unitPrice: 100 }], paymentMethod: "cash" });
test("forecast produces evidence, scenarios, daily operations, real mix and configurable +20%", () => {
  const forecast = fairForecast({ location: { id: "fair", name: "Pilar" }, startDate: "2026-10-10", days: 2, observedAt: new Date("2026-10-05"), sales: [sale("1", "2026-09-26"), sale("2", "2026-09-27"), sale("3", "2026-10-03"), sale("4", "2026-10-04")] });
  assert.equal(forecast.kind, "estimate"); assert.equal(forecast.daily.length, 2); assert.equal(forecast.scenarios.expected, 2000); assert.equal(forecast.expectedOperations, 2); assert.equal(forecast.expectedTicket, 1000);
  assert.equal(forecast.products[0].expectedUnits, 20); assert.equal(forecast.products[0].recommendedStock, 24); assert.equal(forecast.products[0].mix, 1);
  assert.ok(forecast.scenarios.conservative < forecast.scenarios.expected && forecast.scenarios.high > forecast.scenarios.expected);
  const zero = fairForecast({ location: { id: "fair" }, startDate: "2026-10-10", days: 1, safetyStockPercent: 0, sales: [sale("1", "2026-10-03")] }); assert.equal(zero.products[0].recommendedStock, 10);
});
test("forecast rejects impossible dates and respects operational calendars, canceled sales and absent history", () => {
  const base = { location: { id: "fair", operatingCalendar: { weekdays: [6] } }, startDate: "2026-10-10", days: 2 };
  assert.throws(() => fairForecast({ ...base, startDate: "2026-02-30" }), /fecha/);
  assert.equal(fairForecast({ ...base, sales: [] }).scenarios, null);
  const forecast = fairForecast({ ...base, sales: [sale("a", "2026-10-03"), { ...sale("b", "2026-10-04", 10000), status: "cancelled" }] });
  assert.equal(forecast.evidence.saleCount, 1); assert.equal(forecast.daily[1].expected, 0); assert.equal(forecast.daily[1].high, 0); assert.equal(forecast.confidence, "baja");
  assert.equal(aggregateSales([sale("a", "2026-10-03"), sale("a", "2026-10-03")]).count, 1);
});

test("forecast adjusts commercial duration only when both event calendars provide real hours", () => {
  const base = { location: { id: "future", operatingCalendar: { openingTime: "10:00", closingTime: "18:00" } }, comparableLocations: [{ id: "past", operatingCalendar: { openingTime: "10:00", closingTime: "14:00" } }], startDate: "2026-10-10", days: 1, sales: [sale("a", "2026-10-03", 10, "past")] };
  const forecast = fairForecast(base);
  assert.equal(forecast.scenarios.expected, 2000);
  assert.equal(forecast.products[0].expectedUnits, 20);
  assert.equal(forecast.factors.targetOperatingHours, 8);
  assert.equal(fairForecast({ ...base, comparableLocations: [{ id: "past" }] }).scenarios.expected, 1000);
  assert.equal(fairForecast({ ...base, location: { id: "future", operatingCalendar: { openingTime: "22:00", closingTime: "02:00" } } }).scenarios.expected, 1000);
});
test("extractive memory remains bounded and preserves references without replaying all messages", () => {
  const messages = Array.from({ length: 60 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? "assistant" : "user", content: "Contexto real ".repeat(100) }));
  const memory = reduceConversationMemory(null, messages); assert.ok(JSON.stringify(memory).length < 6000); assert.ok(JSON.stringify(memory).includes("m43"));
});
test("admin metrics query applies product/date scope and flags limits rather than fabricating totals", async () => {
  const f = fixture({ role: "admin" });
  const result = await runTool({ ...f, name: "get_sales_metrics", args: { startDate: "2026-10-04", endDate: "2026-10-04", locationId: null, productId: null, sellerId: "user_a" }, context: {}, now: f.clock() });
  assert.equal(result.data.count, 1); assert.equal(result.data.total, 1500); assert.equal(result.data.partial, false);
});
