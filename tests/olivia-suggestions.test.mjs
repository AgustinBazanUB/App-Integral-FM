import test from "node:test";
import assert from "node:assert/strict";
import { isSuggestionRequest } from "../netlify/functions/_lib/olivia/suggestions.mjs";
import { fixture, start } from "./helpers/olivia-fixture.mjs";

const suggestion = { ready: true, title: "Mostrar stock al cargar mercadería", summary: "En el panel actual no se muestra el stock mientras se carga mercadería.", panel: "Panel general", expectedBehavior: "Mostrar el saldo actual al seleccionar un producto antes de cargar stock.", question: "" };
const payload = value => ({ id: "suggestion_response", status: "completed", output_text: JSON.stringify(value), output: [], usage: { input_tokens: 80, output_tokens: 40, total_tokens: 120 } });
function setup(role = "seller", response = suggestion, hook = () => {}) {
  const requests = [];
  const f = fixture({ role, provider: async (path, body) => { requests.push({ path, body }); await hook(f); return payload(typeof response === "function" ? response() : response); } });
  f.documents.set("users/agustin", { name: "Agustín", email: "agsreserva@gmail.com", role: "admin", active: true });
  f.documents.set("users/impostor", { name: "Agustín", email: "other@gmail.com", role: "admin", active: true });
  return { ...f, requests };
}
const alerts = f => [...f.documents].filter(([path]) => path.startsWith("alerts/"));
const send = (f, conversationId, message, requestId = "suggestion_one", extra = {}) => f.engine.chat(f.session, { conversationId, requestId, message, screenContext: { route: "/gestion", module: "dashboard" }, ...extra });

test("variantes de mensajes a Agustín reconocen la intención sin confundir operaciones del negocio", () => {
  for (const text of ["Olivia, ¿puedes comunicarle lo siguiente a Agustín?", "Decile a Agustín que quiero mejorar el panel", "Podés decirle a Agustín esto", "Pasale esta idea a Agustín", "Quiero enviarle una propuesta a Agustín", "Avisale a Agustín que necesito ver mejor los productos"]) assert.equal(isSuggestionRequest(text), true, text);
  for (const text of ["Mostrame las ventas", "Agustín vendió 4 productos", "Cargá stock"]) assert.equal(isSuggestionRequest(text), false, text);
});

test("vendedores y administradores envían la reformulación y el original solo a la cuenta real", async () => {
  for (const role of ["seller", "admin"]) {
    const f = setup(role), { conversationId } = await start(f);
    const original = "Olivia, comunicale a Agustín que acá al cargar stock quiero ver cuántas unidades quedan";
    const result = await send(f, conversationId, original);
    assert.equal(result.state, "COMPLETADA");
    assert.match(result.messages.at(-1).content, /Le envié tu sugerencia a Agustín/);
    assert.equal(alerts(f).length, 1);
    const row = alerts(f)[0][1];
    assert.equal(row.responsibleId, "agustin");
    assert.equal(row.reporterId, f.session.uid);
    assert.equal(row.originalMessage, original);
    assert.equal(row.suggestionSummary, suggestion.summary);
    assert.equal(row.screenContext.route, "/gestion");
    assert.match(row.codexDescription, /Comportamiento solicitado/);
    assert.match(row.codexDescription, /Mensaje original/);
    assert.equal(f.requests[0].body.model, "gpt-6-luna");
    assert.equal(f.requests[0].body.reasoning.effort, "low");
    assert.equal(f.requests[0].body.tools, undefined);
    assert.equal(JSON.parse(f.requests[0].body.input[0].content).currentScreen.name, "Panel general");
    assert.equal([...f.documents].filter(([path]) => path.startsWith("oliviaConfirmations/")).length, 0);
    assert.equal([...f.documents].filter(([path]) => path.startsWith("stockMovements/")).length, 0);
  }
});

test("una idea incompleta pregunta y conserva la pantalla hasta recibir el detalle", async () => {
  let ready = false;
  const f = setup("seller", () => ready ? suggestion : { ...suggestion, ready: false, title: "", summary: "", expectedBehavior: "", question: "¿Qué mejora querés comunicarle?" });
  const { conversationId } = await start(f);
  const first = await send(f, conversationId, "Olivia, podés decirle algo a Agustín");
  assert.equal(first.state, "DATOS_INCOMPLETOS");
  assert.equal(alerts(f).length, 0);
  ready = true;
  f.advance(2000);
  await send(f, conversationId, "Que aparezca el stock antes de cargar unidades", "suggestion_two", { screenContext: { route: "/gestion/locations", module: "locations" } });
  assert.equal(alerts(f).length, 1);
  assert.equal(alerts(f)[0][1].screenContext.module, "dashboard");
  assert.match(alerts(f)[0][1].originalMessage, /podés decirle algo/);
  assert.match(alerts(f)[0][1].originalMessage, /Que aparezca el stock/);
});

test("reintentos simultáneos no duplican la notificación", async () => {
  const f = setup(), { conversationId } = await start(f);
  const results = await Promise.allSettled([send(f, conversationId, "Comunicale a Agustín esta mejora del stock"), send(f, conversationId, "Comunicale a Agustín esta mejora del stock")]);
  assert.ok(results.some(result => result.status === "fulfilled"));
  assert.equal(alerts(f).length, 1);
});

test("cuenta receptora inactiva, remitente inactivo y respuesta inválida nunca anuncian un envío", async () => {
  for (const variant of ["recipient", "sender", "invalid"]) {
    const f = setup("seller", variant === "invalid" ? { ...suggestion, arbitraryRecipient: "impostor" } : suggestion, current => {
      if (variant === "sender") current.documents.get(`users/${current.session.uid}`).active = false;
    });
    if (variant === "recipient") f.documents.get("users/agustin").active = false;
    const { conversationId } = await start(f);
    await assert.rejects(send(f, conversationId, "Comunicale a Agustín que quiero ver el stock"));
    assert.equal(alerts(f).length, 0);
    assert.ok(!f.documents.get(`oliviaConversations/${conversationId}`).messages.some(row => /Le envié tu sugerencia/.test(row.content)));
  }
});
