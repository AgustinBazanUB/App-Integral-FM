import test from "node:test";
import assert from "node:assert/strict";
import { captureOliviaFailure, sendOliviaErrorReport, publicOliviaFailure } from "../netlify/functions/_lib/olivia/errorReports.mjs";
const now = new Date("2026-10-06T15:00:00Z");
function fixture() {
  const documents = new Map([["users/agustin", { name: "Agustín Bazán", role: "admin", active: true }], ["users/sender", { name: "Ana", role: "seller", active: true }], ["users/impostor", { name: "Agustin", role: "seller", active: true }]]);
  let queue = Promise.resolve();
  const apply = writes => { const next = structuredClone(documents); for (const write of writes) { if (write.type === "create" && next.has(write.path)) throw new Error("Duplicate create"); next.set(write.path, { ...(write.type === "update" ? next.get(write.path) : {}), ...structuredClone(write.data) }); } documents.clear(); for (const [path, row] of next) documents.set(path, row); };
  const store = { get: async path => documents.has(path) ? { ...structuredClone(documents.get(path)), id: path.split("/").at(-1) } : null, list: async collection => [...documents].filter(([path]) => path.startsWith(`${collection}/`) && path.split("/").length === 2).map(([path, row]) => ({ ...structuredClone(row), id: path.split("/").at(-1) })), commit: async writes => apply(writes), transaction: work => { const task = queue.then(() => { let committed = false; return work({ getDocument: async path => { assert.equal(committed, false); return documents.has(path) ? { data: structuredClone(documents.get(path)) } : null; }, commitDocuments: async writes => { assert.equal(committed, false); committed = true; apply(writes); } }); }); queue = task.catch(() => {}); return task; } };
  return { documents, store, session: { uid: "sender", authTime: 100, profile: structuredClone(documents.get("users/sender")) } };
}
const capture = f => captureOliviaFailure({ ...f, error: Object.assign(new Error("Password: secret; Customer phone 111-PRIVATE; Authorization Bearer PRIVATE"), { code: "provider-timeout", status: 503 }), operation: "chat", conversationId: "conversation_a", requestId: "request_a", now });
test("diagnostics are prepared privately and omit prompts, customer data, tokens and raw error messages", async () => {
  const f = fixture(), failure = await capture(f);
  assert.equal(failure.code, "provider-timeout"); assert.ok(failure.reportId);
  assert.equal([...f.documents].filter(([path]) => path.startsWith("alerts/")).length, 0);
  const report = f.documents.get(`oliviaErrorReports/${failure.reportId}`);
  assert.doesNotMatch(JSON.stringify(report), /Password|PRIVATE|Bearer|Customer phone/);
  assert.equal(report.diagnostics.error.code, "provider-timeout");
  assert.equal(report.diagnostics.requestId, "request_a");
});
test("one explicit report produces one alert assigned to the verified Agustin administrator", async () => {
  const f = fixture(), failure = await capture(f), body = { reportId: failure.reportId, responsibleId: "impostor", diagnostics: { injected: true } };
  const results = await Promise.all([sendOliviaErrorReport({ ...f, body, now }), sendOliviaErrorReport({ ...f, body, now })]);
  assert.ok(results.every(result => result.reported));
  const alerts = [...f.documents].filter(([path]) => path.startsWith("alerts/"));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][1].responsibleId, "agustin");
  assert.equal(alerts[0][1].severity, "red");
  assert.equal(JSON.parse(alerts[0][1].diagnosticJson).error.code, "provider-timeout");
  assert.match(alerts[0][1].codexDescription, /Revisá este error de Olivia/);
  assert.doesNotMatch(alerts[0][1].codexDescription, /PRIVATE|injected/);
  assert.equal(f.documents.get(`oliviaErrorReports/${failure.reportId}`).status, "sent");
});
test("reports reject another user, changed login and expiry before generating alerts", async () => {
  for (const variant of ["user", "login", "expiry"]) {
    const f = fixture(), failure = await capture(f);
    const session = variant === "user" ? { ...f.session, uid: "impostor" } : variant === "login" ? { ...f.session, authTime: 101 } : f.session;
    const time = variant === "expiry" ? new Date(now.getTime() + 31 * 86400000) : now;
    await assert.rejects(sendOliviaErrorReport({ ...f, session, body: { reportId: failure.reportId }, now: time }), { code: "report-not-found" });
    assert.equal([...f.documents].filter(([path]) => path.startsWith("alerts/")).length, 0);
  }
});
test("ambiguous or disabled Agustin accounts cannot receive an arbitrary user's diagnostics", async () => {
  for (const variant of ["disabled", "ambiguous"]) {
    const f = fixture(), failure = await capture(f);
    if (variant === "disabled") f.documents.get("users/agustin").active = false;
    else f.documents.set("users/other_admin", { name: "Agustin Otro", role: "admin", active: true });
    await assert.rejects(sendOliviaErrorReport({ ...f, body: { reportId: failure.reportId }, now }), { code: "report-recipient-unavailable" });
    assert.equal(f.documents.get(`oliviaErrorReports/${failure.reportId}`).status, "ready");
  }
});
test("public failures never expose unexpected internal errors or malformed codes", () => {
  assert.doesNotMatch(JSON.stringify(publicOliviaFailure(new Error("PRIVATE credentials"))), /PRIVATE|credentials/);
  assert.equal(publicOliviaFailure({ code: "Bearer PRIVATE SECRET" }).code, "assistant-error");
  assert.match(publicOliviaFailure({ code: "context-changed", status: 409 }).message, /prepar/);
});
