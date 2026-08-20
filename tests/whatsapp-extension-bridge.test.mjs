import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTENSION_CHANNEL,
  EXTENSION_MESSAGE_TYPES,
  EXTENSION_TIMEOUTS,
  extensionConnectionState,
  pingWhatsAppExtension,
  prepareCampaignForExtension,
  requestCampaignCancellation,
  requestCampaignDelete,
  requestCampaignDiagnosticReport,
  requestCampaignRetry,
  requestCampaignRetryFailed,
  requestCampaignStart,
  requestCampaignStatus,
  requestCampaignStop,
  requestWhatsAppPreflight,
} from "../src/gestion/marketing/whatsapp/extensionBridge.js";

function defaultStatusPayload(campaign = null) {
  return {
    operational: true,
    message: "Conexión operativa",
    configuredLimit: 1000,
    sentToday: 0,
    availableToday: 1000,
    extensionVersion: "0.9.4.4",
    bridgeInstanceId: "bridge-2",
    bridgeGeneration: 2,
    bridgeCreatedAt: "2026-08-19T03:00:00.000Z",
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
    postMessage(envelope, origin, transfer = []) {
      posted.push({ envelope, origin, transfer });
      const resolved = resolveReply(envelope, posted.length - 1);
      if (!resolved) return;
      queueMicrotask(() => {
        const response = {
          channel: EXTENSION_CHANNEL,
          protocolVersion: 1,
          type: resolved.type,
          replyTo: envelope.requestId,
          campaignId: envelope.campaignId,
          ...(Number.isInteger(resolved.sequence) ? { sequence: resolved.sequence } : {}),
          payload: resolved.payload ?? {},
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

async function withExtensionReply(replyType, run, payloadOverride = null) {
  return withExtensionResolver((envelope) => ({
    type: replyType,
    sequence: 2,
    payload: payloadOverride || (replyType === EXTENSION_MESSAGE_TYPES.status
      ? defaultStatusPayload(null)
      : { campaignId: envelope.campaignId, sequence: 2 }),
  }), run);
}

test("los timeouts de la integración cubren operaciones reales de WhatsApp sin ping agresivo", () => {
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

test("Retry y Retry Failed usan controles explícitos con campaignId", async () => {
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.resumed, async (posted) => {
    await requestCampaignRetry("campaign-retry", { sequence: 8 });
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.retryRequest);
    assert.equal(posted[0].envelope.campaignId, "campaign-retry");
    assert.equal(posted[0].envelope.sequence, 8);
  });
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.started, async (posted) => {
    await requestCampaignRetryFailed("campaign-failed", { sequence: 10 });
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.retryFailedRequest);
  });
});

test("STATUS_REQUEST consulta la campaña realmente activa de la extensión", async () => {
  const campaign = { campaignId: "campaign-live", campaignName: "Live", status: "paused", sequence: 7 };
  await withExtensionResolver((envelope) => {
    assert.equal(envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    return { type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(campaign) };
  }, async () => {
    const status = await requestCampaignStatus();
    assert.deepEqual(status.campaign, campaign);
  });
});

test("STOP sobre una campaña pausada consulta estado y luego detiene con la sequence real", async () => {
  const campaign = { campaignId: "campaign-paused", campaignName: "Pausada", status: "paused", sequence: 11 };
  await withExtensionResolver((envelope) => {
    if (envelope.type === EXTENSION_MESSAGE_TYPES.statusRequest) {
      return { type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(campaign) };
    }
    if (envelope.type === EXTENSION_MESSAGE_TYPES.stopRequest) {
      return {
        type: EXTENSION_MESSAGE_TYPES.stopped,
        sequence: 12,
        payload: { ...campaign, status: "stopped", sequence: 12 },
      };
    }
    return null;
  }, async (posted) => {
    const response = await requestCampaignStop("campaign-paused");
    assert.equal(posted.length, 2);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    assert.equal(posted[1].envelope.type, EXTENSION_MESSAGE_TYPES.stopRequest);
    assert.equal(posted[1].envelope.sequence, 11);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.stopped);
  });
});

test("STOP no libera accidentalmente una campaña que ya está stopped", async () => {
  const campaign = { campaignId: "campaign-stopped", campaignName: "Detenida", status: "stopped", sequence: 15 };
  await withExtensionResolver((envelope) => ({
    type: EXTENSION_MESSAGE_TYPES.status,
    payload: defaultStatusPayload(campaign),
  }), async (posted) => {
    const response = await requestCampaignStop("campaign-stopped");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.stopped);
    assert.equal(response.payload.emitterReleased, false);
  });
});

test("DELETE libera stopped y, si el emisor ya estaba libre, lo reconcilia como released", async () => {
  const stopped = { campaignId: "campaign-stopped", campaignName: "Detenida", status: "stopped", sequence: 20 };
  await withExtensionResolver((envelope) => {
    if (envelope.type === EXTENSION_MESSAGE_TYPES.statusRequest) {
      return { type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(stopped) };
    }
    if (envelope.type === EXTENSION_MESSAGE_TYPES.deleteRequest) {
      return {
        type: EXTENSION_MESSAGE_TYPES.stopped,
        sequence: 20,
        payload: { ...stopped, emitterReleased: true },
      };
    }
    return null;
  }, async (posted) => {
    const response = await requestCampaignDelete("campaign-stopped");
    assert.equal(posted.length, 2);
    assert.equal(posted[1].envelope.type, EXTENSION_MESSAGE_TYPES.deleteRequest);
    assert.equal(posted[1].envelope.sequence, 20);
    assert.equal(response.payload.emitterReleased, true);
  });

  await withExtensionResolver(() => ({
    type: EXTENSION_MESSAGE_TYPES.status,
    payload: defaultStatusPayload(null),
  }), async (posted) => {
    const response = await requestCampaignDelete("campaign-already-free");
    assert.equal(posted.length, 1);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.stopped);
    assert.equal(response.payload.emitterReleased, true);
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

test("PING conserva el snapshot de campaña para resincronizar después de perder eventos live", async () => {
  const campaign = {
    campaignId: "campaign-sync",
    status: "completed",
    sequence: 17,
    total: 100,
    processed: 100,
    sent: 97,
    failed: 3,
  };
  await withExtensionReply(EXTENSION_MESSAGE_TYPES.status, async () => {
    const status = await pingWhatsAppExtension();
    assert.deepEqual(status.campaign, campaign);
  }, {
    ...defaultStatusPayload(campaign),
    sentToday: 97,
    availableToday: 903,
    bridgeInstanceId: "bridge-sync",
    bridgeGeneration: 4,
    bridgeCreatedAt: "2026-08-19T16:00:00.000Z",
  });
});

test("EXTENSION_CONTEXT_INVALIDATED pide reload controlado en vez de reintentos infinitos", () => {
  assert.equal(extensionConnectionState({ operational: false, errorCode: "EXTENSION_CONTEXT_INVALIDATED" }), "needs_page_reload");
  assert.equal(extensionConnectionState({ operational: true }), "connected");
  assert.equal(extensionConnectionState({ operational: false, errorCode: "extension_unavailable" }), "disconnected");
});


test("CANCEL paused consulta source of truth, envía Cancel real y exige la sequence activa", async () => {
  const campaign = { campaignId: "campaign-paused-cancel", campaignName: "Pausada", status: "paused", sequence: 31 };
  await withExtensionResolver((envelope) => {
    if (envelope.type === EXTENSION_MESSAGE_TYPES.statusRequest) return { type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(campaign) };
    if (envelope.type === EXTENSION_MESSAGE_TYPES.cancelRequest) return {
      type: EXTENSION_MESSAGE_TYPES.cancelled,
      sequence: 32,
      payload: { ...campaign, status: "cancelled", sequence: 32, emitterReleased: true },
    };
    return null;
  }, async (posted) => {
    const response = await requestCampaignCancellation(campaign.campaignId);
    assert.equal(posted.length, 2);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    assert.equal(posted[1].envelope.type, EXTENSION_MESSAGE_TYPES.cancelRequest);
    assert.equal(posted[1].envelope.sequence, 31);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.cancelled);
    assert.equal(response.payload.emitterReleased, true);
  });
});

test("CANCEL stale en Web App no manda control si la extensión ya está idle y reconcilia cancelled localmente", async () => {
  await withExtensionResolver(() => ({ type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(null) }), async (posted) => {
    const response = await requestCampaignCancellation("campaign-stale");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.cancelled);
    assert.equal(response.payload.emitterReleased, true);
    assert.equal(response.payload.staleReconciled, true);
  });
});

test("CANCEL archiva una campaña stale sin mandar un comando a otra campaña activa", async () => {
  const blocking = { campaignId: "campaign-A", campaignName: "Anterior", status: "paused", sequence: 5 };
  await withExtensionResolver(() => ({ type: EXTENSION_MESSAGE_TYPES.status, payload: defaultStatusPayload(blocking) }), async (posted) => {
    const response = await requestCampaignCancellation("campaign-B");
    assert.equal(posted.length, 1);
    assert.equal(posted[0].envelope.type, EXTENSION_MESSAGE_TYPES.statusRequest);
    assert.equal(response.type, EXTENSION_MESSAGE_TYPES.cancelled);
    assert.equal(response.payload.emitterReleased, true);
    assert.equal(response.payload.staleReconciled, true);
    assert.equal(response.payload.cancellationReason, "requested_campaign_not_active_in_extension");
  });
});

test("reporte bajo demanda usa el canal dedicado y devuelve texto + JSON", async () => {
  await withExtensionResolver((envelope) => {
    assert.equal(envelope.type, EXTENSION_MESSAGE_TYPES.diagnosticReportRequest);
    assert.equal(envelope.payload.webAppContext.campaignIdDisplayed, "campaign-report");
    return { type: EXTENSION_MESSAGE_TYPES.diagnosticReport, payload: { text: "REPORTE", json: "{\"ok\":true}", report: { reportSchemaVersion: 2 } } };
  }, async (posted) => {
    const report = await requestCampaignDiagnosticReport("campaign-report", { campaignIdDisplayed: "campaign-report" });
    assert.equal(posted.length, 1);
    assert.equal(report.text, "REPORTE");
    assert.equal(report.json, '{"ok":true}');
  });
});