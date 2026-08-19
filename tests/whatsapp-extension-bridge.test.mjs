import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MESSAGE_TYPES,
  EXTENSION_TIMEOUTS,
  extensionConnectionState,
  pingWhatsAppExtension,
  prepareCampaignForExtension,
  requestCampaignStart,
  requestWhatsAppPreflight,
} from "../src/gestion/marketing/whatsapp/extensionBridge.js";

async function withExtensionReply(replyType, run, payloadOverride = null) {
  const listeners = new Set();
  const posted = [];
  const fakeWindow = {
    location: { origin: "https://deploy-preview-7--appintegralflormia.netlify.app" },
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    setTimeout,
    postMessage(envelope, origin, transfer = []) {
      posted.push({ envelope, origin, transfer });
      queueMicrotask(() => {
        const response = {
          channel: EXTENSION_CHANNEL,
          protocolVersion: 1,
          type: replyType,
          replyTo: envelope.requestId,
          campaignId: envelope.campaignId,
          sequence: 2,
          payload: payloadOverride || (replyType === EXTENSION_MESSAGE_TYPES.status
            ? {
                operational: true,
                message: "Conexión operativa",
                configuredLimit: 1000,
                sentToday: 0,
                availableToday: 1000,
                extensionVersion: "0.9.4",
                bridgeInstanceId: "bridge-2",
                bridgeGeneration: 2,
                bridgeCreatedAt: "2026-08-19T03:00:00.000Z",
                runtimeAvailable: true,
              }
            : { campaignId: envelope.campaignId, sequence: 2 }),
        };
        for (const listener of listeners) listener({ source: fakeWindow, origin, data: response });
      });
    },
  };
  globalThis.window = fakeWindow;
  try {
    await run(posted);
  } finally {
    delete globalThis.window;
  }
}

test("los timeouts de la integración cubren operaciones reales de WhatsApp", () => {
  assert.equal(EXTENSION_TIMEOUTS.ping, 5000);
  assert.equal(EXTENSION_TIMEOUTS.prepare, 30000);
  assert.equal(EXTENSION_TIMEOUTS.preflight, 35000);
  assert.equal(EXTENSION_TIMEOUTS.control, 35000);
});

test("PREPARE serializa imágenes como dataBase64 compatible con la extensión", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.accepted, async (posted) => {
    await prepareCampaignForExtension({
      campaignId: "campaign-1",
      campaignName: "Prueba",
      createdBy: "owner",
      recipients: [{ recipientId: "recipient-1", phone: "5491112345678", source: "flor_mia" }],
      message: "Prueba técnica",
      totalRecipients: 1,
    }, [{ file: { name: "test.png", type: "image/png", size: 3, arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer } }]);
    const [{ envelope, transfer }] = posted;
    assert.equal(envelope.type, EXTENSION_MESSAGE_TYPES.prepare);
    assert.equal(envelope.payload.images[0].dataBase64, "AQID");
    assert.equal("data" in envelope.payload.images[0], false);
    assert.deepEqual(transfer, []);
  });
});

test("PREPARE entrega exactamente el mensaje escrito por el usuario, incluido Unicode y saltos", async () => {
  const message = "  Hola, esto es una prueba 👋\nÁrbol y acción  ";
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.accepted, async (posted) => {
    await prepareCampaignForExtension({
      campaignId: "campaign-exact-text",
      campaignName: "Texto exacto",
      createdBy: "owner",
      recipients: [{ recipientId: "recipient-1", phone: "5491112345678", source: "flor_mia" }],
      message,
      totalRecipients: 1,
    });
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.prepare);
    assert.equal(posted[0].envelope.payload.message, message);
  });
});

test("START se envía separado de PREPARE con campaignId y expectedSequence", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.started, async (posted) => {
    const response = await requestCampaignStart("campaign-1", { sequence: 1 });
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.startRequest);
    assert.equal(posted[0].envelope.campaignId, "campaign-1");
    assert.equal(posted[0].envelope.sequence, 1);
    assert.equal(response.sequence, 2);
  });
});

test("Comprobar solicita un preflight nuevo en vez de leer solamente el estado anterior", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.status, async (posted) => {
    const status = await requestWhatsAppPreflight();
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.preflightRequest);
    assert.equal(status.operational, true);
  });
});

test("PING concurrente se deduplica y conserva una sola comprobación lightweight", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.status, async (posted) => {
    const [first, second] = await Promise.all([pingWhatsAppExtension(), pingWhatsAppExtension()]);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.ping);
    assert.equal(first.connectionState, "connected");
    assert.deepEqual(first, second);
    assert.equal(first.bridgeGeneration, 2);
  });
});

test("EXTENSION_CONTEXT_INVALIDATED pide reload controlado en vez de reintentos infinitos", () => {
  assert.equal(extensionConnectionState({ operational: false, errorCode: "EXTENSION_CONTEXT_INVALIDATED" }), "needs_page_reload");
  assert.equal(extensionConnectionState({ operational: true }), "connected");
  assert.equal(extensionConnectionState({ operational: false, errorCode: "extension_unavailable" }), "disconnected");
});
