import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MESSAGE_TYPES,
  EXTENSION_TIMEOUTS,
  pingWhatsAppExtension,
  prepareCampaignForExtension,
  requestCampaignPause,
  requestCampaignStart,
  requestWhatsAppPreflight,
} from "../src/gestion/marketing/whatsapp/extensionBridge.js";

async function withExtensionReply(replyType, run) {
  const listeners = new Set();
  const posted = [];
  const fakeWindow = {
    location: { origin: "https://deploy-preview-8--appintegralflormia.netlify.app" },
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
          payload: replyType === EXTENSION_MESSAGE_TYPES.status
            ? { operational: true, message: "Diagnóstico operativo", configuredLimit: 1000, sentToday: 0, availableToday: 1000 }
            : { campaignId: envelope.campaignId, sequence: 2 },
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

test("START se envía separado de PREPARE con campaignId y expectedSequence", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.started, async (posted) => {
    const response = await requestCampaignStart("campaign-1", { sequence: 1 });
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.startRequest);
    assert.equal(posted[0].envelope.campaignId, "campaign-1");
    assert.equal(posted[0].envelope.sequence, 1);
    assert.equal(response.sequence, 2);
  });
});

test("dos refresh simultáneos reutilizan un único ping liviano", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.status, async (posted) => {
    const [first, second] = await Promise.all([pingWhatsAppExtension(), pingWhatsAppExtension()]);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.ping);
    assert.equal(first.operational, true);
    assert.equal(second.operational, true);
  });
});

test("PAUSE manda el control con requestedAt sin pedir diagnóstico pesado", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.paused, async (posted) => {
    const response = await requestCampaignPause("campaign-1");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.pauseRequest);
    assert.equal(posted[0].envelope.payload.campaignId, "campaign-1");
    assert.equal(typeof posted[0].envelope.payload.requestedAt, "number");
    assert.equal(response.completedAt >= response.requestedAt, true);
  });
});

test("Comprobar solicita un preflight nuevo en vez de leer solamente el estado anterior", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.status, async (posted) => {
    const status = await requestWhatsAppPreflight();
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.preflightRequest);
    assert.equal(status.operational, true);
  });
});
