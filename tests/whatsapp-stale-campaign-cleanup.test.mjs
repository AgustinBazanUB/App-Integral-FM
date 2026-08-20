import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MESSAGE_TYPES,
  requestCampaignCancellation,
} from "../src/gestion/marketing/whatsapp/extensionBridge.js";

function statusPayload(campaign) {
  return {
    operational: true,
    message: "Conexión operativa",
    configuredLimit: 1000,
    sentToday: 0,
    availableToday: 1000,
    extensionVersion: "0.9.4.4",
    runtimeAvailable: true,
    campaign,
  };
}

async function withExtensionResolver(resolveReply, run) {
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
    postMessage(envelope, origin) {
      posted.push(envelope);
      const reply = resolveReply(envelope);
      if (!reply) return;
      queueMicrotask(() => {
        const response = {
          channel: EXTENSION_CHANNEL,
          protocolVersion: 1,
          type: reply.type,
          replyTo: envelope.requestId,
          campaignId: envelope.campaignId,
          ...(Number.isInteger(reply.sequence) ? { sequence: reply.sequence } : {}),
          payload: reply.payload ?? {},
        };
        for (const listener of listeners) {
          listener({ source: fakeWindow, origin, data: response });
        }
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

test("cancelar una campaña stale la saca de activas sin tocar otra campaña real de la extensión", async () => {
  const active = {
    campaignId: "campaign-real",
    campaignName: "Campaña real",
    status: "paused",
    sequence: 12,
  };

  await withExtensionResolver((envelope) => {
    assert.equal(envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    return {
      type: EXTENSION_MESSAGE_TYPES.status,
      payload: statusPayload(active),
    };
  }, async (posted) => {
    const response = await requestCampaignCancellation("campaign-vieja");
    assert.equal(posted.length, 1);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.cancelled);
    assert.equal(response.campaignId, "campaign-vieja");
    assert.equal(response.payload.status, "cancelled");
    assert.equal(response.payload.emitterReleased, true);
    assert.equal(response.payload.staleReconciled, true);
    assert.equal(response.payload.cancellationReason, "requested_campaign_not_active_in_extension");
  });
});

test("cancelar una campaña stopped usa release como fallback para una extensión 0.9.4.4 vieja", async () => {
  const stopped = {
    campaignId: "campaign-stopped",
    campaignName: "Campaña vieja",
    status: "stopped",
    sequence: 44,
  };

  await withExtensionResolver((envelope) => {
    if (envelope.type === EXTENSION_MESSAGE_TYPES.statusRequest) {
      return {
        type: EXTENSION_MESSAGE_TYPES.status,
        payload: statusPayload(stopped),
      };
    }
    if (envelope.type === EXTENSION_MESSAGE_TYPES.cancelRequest) {
      return {
        type: EXTENSION_MESSAGE_TYPES.error,
        payload: {
          code: "internal",
          message: "Transición de campaña inválida: stopped → cancelled.",
          recoverable: false,
        },
      };
    }
    if (envelope.type === EXTENSION_MESSAGE_TYPES.deleteRequest) {
      return {
        type: EXTENSION_MESSAGE_TYPES.stopped,
        sequence: 44,
        payload: { ...stopped, emitterReleased: true },
      };
    }
    return null;
  }, async (posted) => {
    const response = await requestCampaignCancellation(stopped.campaignId);
    assert.deepEqual(posted.map((item) => item.type), [
      EXTENSION_MESSAGE_TYPES.statusRequest,
      EXTENSION_MESSAGE_TYPES.cancelRequest,
      EXTENSION_MESSAGE_TYPES.deleteRequest,
    ]);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.cancelled);
    assert.equal(response.payload.status, "cancelled");
    assert.equal(response.payload.emitterReleased, true);
    assert.equal(response.payload.cancellationReason, "legacy_stopped_campaign_released");
  });
});
