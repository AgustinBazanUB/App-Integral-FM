import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MESSAGE_TYPES,
  extensionConnectionState,
  statusFromResponse,
} from "../src/gestion/marketing/whatsapp/extensionBridge.js";

function statusEnvelope(payload) {
  return {
    channel: EXTENSION_CHANNEL,
    protocolVersion: 1,
    type: EXTENSION_MESSAGE_TYPES.status,
    payload,
  };
}

test("una respuesta válida del bridge mantiene conexión aunque WhatsApp no esté operativo", () => {
  const status = statusFromResponse(statusEnvelope({
    operational: false,
    runtimeAvailable: true,
    errorCode: "extension_not_ready",
    message: "WhatsApp Web todavía está cargando.",
    extensionVersion: "0.9.4.2",
  }));

  assert.equal(status.connectionState, "connected");
  assert.equal(status.operational, false);
  assert.equal(status.runtimeAvailable, true);
});

test("sin respuesta o runtime inválido continúa figurando desconectado", () => {
  assert.equal(extensionConnectionState({ operational: false, errorCode: "extension_unavailable" }), "disconnected");
  assert.equal(extensionConnectionState({ operational: false, responded: true, runtimeAvailable: false }), "disconnected");
});

test("un contexto invalidado sigue pidiendo recarga controlada", () => {
  assert.equal(extensionConnectionState({
    operational: false,
    responded: true,
    runtimeAvailable: false,
    errorCode: "EXTENSION_CONTEXT_INVALIDATED",
  }), "needs_page_reload");
});
