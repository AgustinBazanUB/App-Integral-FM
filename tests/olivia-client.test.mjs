import test from "node:test";
import assert from "node:assert/strict";
import {
  createOliviaTransport,
  conversationForUser,
  forgetConversation,
  rememberConversation,
  safeNavigation,
  pendingExpired,
  operationLabel,
  prependHistoryMessages,
  requestId,
  UUID_PATTERN,
} from "../src/gestion/olivia/client.mjs";

const response = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => data,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("conversation identity is isolated per user and no chat is persisted in storage", () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key),
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };
  assert.equal(conversationForUser("seller-one", storage), null);
  const first = requestId();
  rememberConversation("seller-one", first, storage);
  assert.match(first, UUID_PATTERN);
  assert.equal(conversationForUser("seller-one", storage), first);
  assert.equal(conversationForUser("seller-two", storage), null);
  rememberConversation("seller-one", "not-a-conversation", storage);
  assert.equal(conversationForUser("seller-one", storage), first);
  assert.ok([...records.values()].every((value) => UUID_PATTERN.test(value)));
  const unavailableStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(conversationForUser("seller-one", unavailableStorage), null);
  forgetConversation("seller-one", storage);
  assert.equal(conversationForUser("seller-one", storage), null);
});

test("navigation only opens canonical management or seller routes on the same origin", () => {
  assert.equal(
    safeNavigation("/gestion/locations/shop?tab=stock", "https://flormia.com"),
    "/gestion/locations/shop?tab=stock",
  );
  for (const path of [
    "https://evil.test/gestion",
    "//evil.test/gestion",
    "/gestion/../checkout",
    "/\\evil.test/gestion",
    "javascript:alert(1)",
    "/gestion-other",
    "/checkout",
  ])
    assert.equal(safeNavigation(path), null, path);
  assert.equal(safeNavigation("/vendedor"), "/vendedor");
});

test("visual operation states and expiry come from the server", () => {
  assert.equal(operationLabel("COMPLETADA"), "Acción completada");
  assert.equal(operationLabel("DATOS_INCOMPLETOS"), "Faltan datos");
  assert.equal(
    operationLabel("COMPLETADA", { id: "pending" }),
    "Esperando confirmación",
  );
  assert.equal(
    pendingExpired(
      { expiresAt: "2026-10-04T12:00:00Z" },
      Date.parse("2026-10-04T12:01:00Z"),
    ),
    true,
  );
  assert.equal(pendingExpired({ expiresAt: 1791115200 }, 1791115100000), false);
});

test("authenticated requests preserve the exact confirmation idempotency key on retries", async () => {
  const sent = [];
  const client = createOliviaTransport({
    getToken: async () => "firebase-token",
    fetchImpl: async (url, options) => {
      sent.push({ url, ...options });
      return response({ ok: true, state: "COMPLETADA" });
    },
  });
  const payload = {
    operation: "confirm",
    requestId: "same-request-id",
    conversationId: "same-conversation",
    confirmationToken: "token",
    actionId: "action",
  };
  await client.request(payload);
  await client.request(payload);
  assert.equal(sent[0].body, sent[1].body);
  assert.equal(sent[0].headers.Authorization, "Bearer firebase-token");
  assert.equal(sent[0].url, "/.netlify/functions/olivia");
  assert.ok(!sent[0].body.includes("firebase-token"));
});

test("missing authentication never sends requests and server rejection stays an error", async () => {
  let calls = 0;
  const client = createOliviaTransport({
    getToken: async () => null,
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(client.request({ operation: "chat" }), /Iniciá sesión/);
  assert.equal(calls, 0);
  const denied = createOliviaTransport({
    getToken: async () => "firebase",
    fetchImpl: async () =>
      response({ ok: false, code: "forbidden", message: "Sin permiso" }, 403),
  });
  await assert.rejects(
    denied.request({ operation: "chat" }),
    (error) => error.code === "forbidden" && error.status === 403,
  );
});

test("dictation uses authenticated multipart and rejects oversized recordings before uploading", async () => {
  let sent;
  const client = createOliviaTransport({
    getToken: async () => "firebase",
    fetchImpl: async (url, options) => {
      sent = { url, ...options };
      return response({
        text: "dos Arbequinas",
        conversationId: "conversation",
      });
    },
  });
  await client.transcribe(new Blob(["sound"], { type: "audio/mp4" }), {
    conversationId: "conversation",
    requestId: "request",
  });
  assert.equal(sent.url, "/.netlify/functions/olivia-transcribe");
  assert.equal(sent.headers["Content-Type"], undefined);
  assert.equal(sent.body.get("conversationId"), "conversation");
  assert.equal(sent.body.get("audio").name, "olivia.mp4");
  assert.throws(
    () =>
      client.transcribe(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)]), {}),
    /4 MB/,
  );
});

test("a stalled transport aborts with an actionable error", async () => {
  const client = createOliviaTransport({
    getToken: async () => "firebase",
    timeoutMs: 5,
    fetchImpl: async (_, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  });
  await assert.rejects(
    client.request({ operation: "chat" }),
    (error) => error.code === "olivia-timeout",
  );
});

test("supervision prepends older pages once and preserves current messages", () => {
  const first = { id: "one", role: "user", content: "Primer mensaje" };
  const duplicate = { id: "two", role: "assistant", content: "Versión vieja" };
  const current = { ...duplicate, content: "Respuesta actual" };
  const last = { id: "three", role: "user", content: "Último mensaje" };
  assert.deepEqual(
    prependHistoryMessages([first, duplicate], [current, last]),
    [first, current, last],
  );
});

test("background client polls independent short requests and returns the complete answer", async () => {
  const bodies = [], events = []; let polls = 0;
  const transport = createOliviaTransport({ getToken: async () => "test-token", pollIntervalMs: 1, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    if (body.operation === "startChat") return response({ jobId: "job_a", conversationId: "chat_a" });
    polls++;
    return response({ jobId: "job_a", conversationId: "chat_a", status: polls === 3 ? "completed" : "running", phase: polls > 1 ? "Revisando datos…" : "Pensando…", accepted: { id: "message_a", role: "user", content: "Lista" }, text: polls > 1 ? "Respuesta" : "", ...(polls === 3 ? { result: { messages: [{ content: "Respuesta completa" }] } } : {}) });
  } });
  const result = await transport.request({ operation: "chat", background: true, message: "Lista" }, { onEvent: event => events.push(event) });
  assert.equal(result.messages[0].content, "Respuesta completa");
  assert.equal(bodies[0].operation, "startChat"); assert.equal(bodies.slice(1).every(body => body.operation === "chatStatus"), true);
  assert.equal(events.filter(event => event.type === "accepted").length, 1);
  assert.ok(events.some(event => event.type === "delta" && event.delta === "Respuesta"));
});
test("background recovery waits on the existing job and propagates report identity", async () => {
  const transport = createOliviaTransport({ getToken: async () => "test-token", fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).operation, "chatStatus");
    return response({ status: "failed", text: "", failure: { code: "provider-timeout", reportId: "report_a", message: "No pude completar la consulta." } });
  } });
  await assert.rejects(transport.request({ operation: "waitChat", jobId: "job_a" }), { code: "provider-timeout", reportId: "report_a" });
});
test("background polling recovers a transient connection loss without resubmitting the request", async () => {
  let calls = 0;
  const transport = createOliviaTransport({ getToken: async () => "test-token", pollIntervalMs: 1, fetchImpl: async (_, options) => {
    assert.equal(JSON.parse(options.body).operation, "chatStatus");
    if (++calls === 1) throw new TypeError("network interruption");
    return response({ status: "completed", text: "", result: { recovered: true } });
  } });
  assert.equal((await transport.request({ operation: "waitChat", jobId: "job_a" })).recovered, true);
  assert.equal(calls, 2);
});
