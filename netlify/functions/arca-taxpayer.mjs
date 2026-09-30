import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { getTaxpayer } from "./_lib/arca/registry.mjs";
import { inferReceiverVatCondition } from "./_lib/arca/receiver.mjs";
import { arcaEnvironment, arcaSafeStatus, assertArcaCredentialPairReady, loadArcaPublicConfig } from "./_lib/arca/config.mjs";
import {
  getDocumentTypes,
  getLastAuthorized,
  getPointsOfSale,
  getReceiverVatConditions,
  getVatTypes,
  getVoucherTypes,
  wsfeDummy,
} from "./_lib/arca/wsfe.mjs";
import { registryDummy } from "./_lib/arca/registry.mjs";
import { firebaseAdminAccessToken, adminGetDocument } from "./_lib/firestoreAdminRest.mjs";
import { inspectSharedWsaaCache } from "./_lib/arca/wsaaSharedCache.mjs";
import { requestAccessTicket } from "./_lib/arca/wsaa.mjs";
import { buildArcaOperationalStatus, publicArcaError } from "./_lib/arca/readiness.mjs";
import { assertTaxpayerLookupAllowed } from "./_lib/arca/config.mjs";
import { toPublicArcaError } from "./_lib/arca/publicError.mjs";

import { publicFiscalMessages } from "./_lib/arca/publicInvoice.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  return toPublicArcaError(error);
}

async function preflightStage(name, operation) {
  try {
    const data = await operation();
    return { name, status: "ok", data, error: null };
  } catch (error) {
    return { name, status: "error", data: null, error: publicArcaError(error) };
  }
}

async function runDiagnostics() {
  const environment = arcaEnvironment(process.env).id;
  if (environment !== "homologation") {
    const error = new Error("El diagnóstico está habilitado sólo en homologación.");
    error.code = "homologation-only";
    error.status = 409;
    throw error;
  }

  const config = loadArcaPublicConfig(process.env);
  const diagnostics = {
    environment,
    configuration: arcaSafeStatus(process.env),
    wsfe: { status: "pending", data: null, error: null },
    pointOfSale: { status: "pending", data: null, error: null },
    registry: { status: "pending", data: null, error: null },
    firebaseAdmin: {
      oauth: { status: "pending", error: null },
      firestoreRead: { status: "pending", error: null },
    },
  };

  try {
    diagnostics.wsfe.data = await wsfeDummy({ env: process.env });
    diagnostics.wsfe.status = "ok";
  } catch (error) {
    diagnostics.wsfe.status = "error";
    diagnostics.wsfe.error = safeError(error);
  }

  try {
    const points = await getPointsOfSale({ env: process.env });
    diagnostics.pointOfSale.data = {
      selected: config.pointOfSale,
      found: points.points.some((point) => point.number === config.pointOfSale),
      returned: points.points.map((point) => point.number),
      errors: publicFiscalMessages(points.errors),
    };
    diagnostics.pointOfSale.status = diagnostics.pointOfSale.data.found && !points.errors?.length ? "ok" : "error";
    if (!diagnostics.pointOfSale.data.found) {
      diagnostics.pointOfSale.error = {
        code: "arca-point-of-sale-not-found",
        status: null,
        causeCode: null,
        message: `ARCA no devolvió el punto de venta configurado (${config.pointOfSale}).`,
      };
    }
  } catch (error) {
    diagnostics.pointOfSale.status = "error";
    diagnostics.pointOfSale.error = safeError(error);
  }

  try {
    const registry = await registryDummy({ env: process.env });
    diagnostics.registry.data = {
      appServer: registry.appServer,
      dbServer: registry.dbServer,
      authServer: registry.authServer,
      endpoint: registry.endpoint?.includes("afip.gov.ar") ? "official-legacy" : "arca-current",
    };
    diagnostics.registry.status = "ok";
  } catch (error) {
    diagnostics.registry.status = "error";
    diagnostics.registry.error = safeError(error);
  }

  try {
    await firebaseAdminAccessToken({ env: process.env, forceRefresh: true });
    diagnostics.firebaseAdmin.oauth.status = "ok";
  } catch (error) {
    diagnostics.firebaseAdmin.oauth.status = "error";
    diagnostics.firebaseAdmin.oauth.error = safeError(error);
  }

  if (diagnostics.firebaseAdmin.oauth.status === "ok") {
    try {
      const firestoreProbe = await adminGetDocument("settings/arca_diagnostics_probe", { env: process.env });
      diagnostics.firebaseAdmin.firestoreRead.status = "ok";
      diagnostics.firebaseAdmin.firestoreRead.result = firestoreProbe ? "document-found" : "not-found";
    } catch (error) {
      diagnostics.firebaseAdmin.firestoreRead.status = "error";
      diagnostics.firebaseAdmin.firestoreRead.error = safeError(error);
    }
  } else {
    diagnostics.firebaseAdmin.firestoreRead.status = "skipped";
  }

  diagnostics.ok = [
    diagnostics.wsfe.status,
    diagnostics.pointOfSale.status,
    diagnostics.registry.status,
    diagnostics.firebaseAdmin.oauth.status,
    diagnostics.firebaseAdmin.firestoreRead.status,
  ].every((status) => status === "ok");

  return diagnostics;
}

async function runOperationalStatus() {
  const safeStatus = arcaSafeStatus(process.env);
  const environment = arcaEnvironment(process.env).id;
  let config = null;
  let configError = null;
  try {
    config = loadArcaPublicConfig(process.env);
  } catch (error) {
    configError = safeError(error);
  }

  const taxpayerEnabled = environment !== "production"
    || String(process.env.ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP || "").trim().toLowerCase() === "true";

  const wsaaPromise = config
    ? preflightStage("wsaa", async () => {
        await requestAccessTicket("wsfe", { env: process.env });
        return null; // Never retain the ticket in the diagnostic response.
      })
    : Promise.resolve({ name: "wsaa", status: "error", data: null, error: configError });
  const pointsPromise = wsaaPromise.then((stage) => stage.status === "ok"
    ? preflightStage("points", async () => {
        const result = await getPointsOfSale({ env: process.env });
        if (result.errors?.length) {
          const error = new Error("ARCA rechazó la consulta de puntos de venta.");
          error.code = "arca-point-of-sale-response-errors";
          throw error;
        }
        return result;
      })
    : { name: "points", status: "error", data: null, error: stage.error });

  const [wsfeStage, wsaaStage, pointsStage, firebaseStage, taxpayerStage] = await Promise.all([
    preflightStage("wsfe", () => wsfeDummy({ env: process.env })),
    wsaaPromise,
    pointsPromise,
    preflightStage("firebaseAdmin", async () => {
      await firebaseAdminAccessToken({ env: process.env });
      const probe = await adminGetDocument("settings/arca_readiness_probe", { env: process.env });
      return { read: true, probe: probe ? "document-found" : "not-found" };
    }),
    taxpayerEnabled && config?.issuerCuit
      ? preflightStage("taxpayerLookup", () => getTaxpayer(config.issuerCuit, { env: process.env }))
      : Promise.resolve({
          name: "taxpayerLookup",
          status: taxpayerEnabled ? "error" : "disabled",
          data: null,
          error: taxpayerEnabled ? configError : null,
        }),
  ]);

  const wsfeHealthy = wsfeStage.status === "ok"
    && [wsfeStage.data?.appServer, wsfeStage.data?.dbServer, wsfeStage.data?.authServer]
      .every((value) => String(value || "").toUpperCase() === "OK");
  const wsfeRuntime = wsfeHealthy
    ? { status: "ok", message: "WSFE respondió correctamente." }
    : {
        status: "error",
        error: wsfeStage.error || {
          code: "arca-wsfe-healthcheck-failed",
          status: null,
          message: "WSFE respondió pero alguno de sus servicios no está OK.",
        },
      };

  const points = pointsStage.data?.points || [];
  const selectedPoint = config
    ? points.find((point) => point.number === config.pointOfSale) || null
    : null;
  const normalizedDropDate = String(selectedPoint?.dropDate || "").trim().toUpperCase();
  const hasDropDate = Boolean(
    normalizedDropDate
    && !["NULL", "N/A", "00000000", "0000-00-00"].includes(normalizedDropDate)
  );
  const pointOperational = Boolean(
    selectedPoint
    && String(selectedPoint.blocked || "").toUpperCase() !== "S"
    && !hasDropDate
  );

  let pointRuntime;
  if (pointsStage.status !== "ok") {
    pointRuntime = { status: "error", error: pointsStage.error, selected: config?.pointOfSale || null };
  } else if (!selectedPoint) {
    pointRuntime = {
      status: "error",
      selected: config?.pointOfSale || null,
      found: false,
      operational: false,
      error: {
        code: "arca-point-of-sale-not-found",
        status: null,
        message: "ARCA no devolvió el punto de venta configurado.",
      },
    };
  } else if (!pointOperational) {
    pointRuntime = {
      status: "error",
      selected: config.pointOfSale,
      found: true,
      operational: false,
      error: {
        code: "arca-point-of-sale-not-operational",
        status: null,
        message: "ARCA devolvió el punto de venta, pero no figura operativo.",
      },
    };
  } else {
    pointRuntime = {
      status: "ok",
      selected: config.pointOfSale,
      found: true,
      operational: true,
      message: "Punto de venta validado contra ARCA.",
    };
  }

  const wsaaRuntime = wsaaStage.status === "ok"
    ? { status: "ok", message: "WSAA autenticó correctamente la consulta de WSFE." }
    : { status: "error", error: wsaaStage.error || configError };

  let taxpayerRuntime;
  if (!taxpayerEnabled) {
    taxpayerRuntime = { status: "disabled" };
  } else if (taxpayerStage.status !== "ok") {
    taxpayerRuntime = { status: "error", error: taxpayerStage.error || configError };
  } else if (taxpayerStage.data?.found !== true || taxpayerStage.data?.keyStatus !== "ACTIVO") {
    taxpayerRuntime = {
      status: "error",
      error: {
        code: "arca-taxpayer-self-check-failed",
        status: null,
        message: "El Padrón respondió, pero el CUIT del emisor no quedó validado como ACTIVO.",
      },
    };
  } else {
    taxpayerRuntime = {
      status: "ok",
      message: "Consulta CUIT validada con el CUIT del propio emisor.",
    };
  }

  return buildArcaOperationalStatus({
    env: process.env,
    safeStatus,
    runtime: {
      wsaa: wsaaRuntime,
      wsfe: wsfeRuntime,
      pointOfSale: pointRuntime,
      firebaseAdmin: firebaseStage.status === "ok"
        ? { status: "ok", message: "Firebase Admin obtuvo OAuth y pudo leer Firestore." }
        : { status: "error", error: firebaseStage.error },
      taxpayerLookup: taxpayerRuntime,
    },
  });
}

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "method-not-allowed" }, 405);

  try {
    await requireFirebaseAdmin(request);
    const body = await request.json().catch(() => ({}));

    if (body?.mode === "operational-status") {
      return json({
        ok: true,
        status: await runOperationalStatus(),
      });
    }

    if (body?.mode === "status" || body?.mode === "configuration-status") {
      return json({
        ok: true,
        status: arcaSafeStatus(process.env),
      });
    }

    if (body?.mode === "wsaa-cache-status") {
      const environment = arcaEnvironment(process.env).id;
      const [wsfe, registry] = await Promise.all([
        inspectSharedWsaaCache({
          environmentId: environment,
          service: "wsfe",
          env: process.env,
        }),
        inspectSharedWsaaCache({
          environmentId: environment,
          service: "ws_sr_constancia_inscripcion",
          env: process.env,
        }),
      ]);
      return json({
        ok: true,
        cache: {
          environment,
          wsfe,
          registry,
        },
      });
    }

    if (body?.mode === "wsaa-shared-smoke") {
      const environment = arcaEnvironment(process.env).id;
      if (environment !== "homologation") {
        return json({
          ok: false,
          code: "homologation-only",
          message: "La prueba de TA compartido está habilitada sólo en homologación.",
        }, 409);
      }

      const before = await inspectSharedWsaaCache({
        environmentId: environment,
        service: "wsfe",
        env: process.env,
      });
      if (!before.configured) {
        return json({
          ok: false,
          code: "arca-wsaa-cache-key-missing",
          message: "Configurá ARCA_TA_ENCRYPTION_KEY antes de ejecutar la prueba compartida.",
        }, 409);
      }

      const points = await getPointsOfSale({ env: process.env });
      const after = await inspectSharedWsaaCache({
        environmentId: environment,
        service: "wsfe",
        env: process.env,
      });

      return json({
        ok: true,
        smoke: {
          environment,
          service: "wsfe",
          operation: "FEParamGetPtosVenta",
          result: {
            pointOfSales: points.points.map((point) => point.number),
            errors: publicFiscalMessages(points.errors),
          },
          cache: after,
          reusedExistingTicket: Boolean(
            before.reusable
            && after.reusable
            && before.updatedAt
            && before.updatedAt === after.updatedAt
            && before.ticketExpiresAt === after.ticketExpiresAt
          ),
          createdOrRenewedTicket: Boolean(
            after.reusable
            && (!before.reusable
              || before.updatedAt !== after.updatedAt
              || before.ticketExpiresAt !== after.ticketExpiresAt)
          ),
        },
      });
    }

    if (body?.mode === "wsaa-registry-shared-smoke") {
      const environment = arcaEnvironment(process.env).id;
      if (environment !== "homologation") {
        return json({
          ok: false,
          code: "homologation-only",
          message: "La prueba compartida del Padrón está habilitada sólo en homologación.",
        }, 409);
      }

      const service = "ws_sr_constancia_inscripcion";
      const before = await inspectSharedWsaaCache({
        environmentId: environment,
        service,
        env: process.env,
      });
      if (!before.configured) {
        return json({
          ok: false,
          code: "arca-wsaa-cache-key-missing",
          message: "Configurá ARCA_TA_ENCRYPTION_KEY antes de ejecutar la prueba compartida.",
        }, 409);
      }

      // CUIT de ejemplo publicado por ARCA para homologación; no usa datos de clientes.
      const taxpayer = await getTaxpayer("20164755100", { env: process.env });
      const after = await inspectSharedWsaaCache({
        environmentId: environment,
        service,
        env: process.env,
      });

      return json({
        ok: true,
        smoke: {
          environment,
          service,
          operation: "getPersona_v2",
          result: {
            found: taxpayer.found,
            keyStatus: taxpayer.keyStatus,
            personType: taxpayer.personType,
            endpoint: taxpayer.endpoint?.includes("afip.gov.ar") ? "official-legacy" : "arca-current",
          },
          cache: after,
          reusedExistingTicket: Boolean(
            before.reusable
            && after.reusable
            && before.updatedAt
            && before.updatedAt === after.updatedAt
            && before.ticketExpiresAt === after.ticketExpiresAt
          ),
          createdOrRenewedTicket: Boolean(
            after.reusable
            && (!before.reusable
              || before.updatedAt !== after.updatedAt
              || before.ticketExpiresAt !== after.ticketExpiresAt)
          ),
        },
      });
    }

    if (body?.mode === "production-readonly-preflight") {
      const environment = arcaEnvironment(process.env).id;
      if (environment !== "production") {
        return json({
          ok: false,
          code: "production-only",
          message: "El preflight productivo sólo puede ejecutarse con ARCA_ENVIRONMENT=production.",
        }, 409);
      }

      const safeStatus = arcaSafeStatus(process.env);
      assertArcaCredentialPairReady(process.env);
      if (!safeStatus.taSharedCacheConfigured) {
        return json({
          ok: false,
          code: "arca-wsaa-cache-key-missing",
          message: "Producción read-only exige una clave propia ARCA_TA_ENCRYPTION_KEY antes de contactar ARCA.",
        }, 409);
      }

      const config = loadArcaPublicConfig(process.env);

      const stages = {};
      stages.wsfe = await preflightStage("wsfe", () => wsfeDummy({ env: process.env }));
      stages.points = await preflightStage("points", () => getPointsOfSale({ env: process.env }));
      stages.voucherTypes = await preflightStage("voucherTypes", () => getVoucherTypes({ env: process.env }));
      stages.vatTypes = await preflightStage("vatTypes", () => getVatTypes({ env: process.env }));
      stages.documentTypes = await preflightStage("documentTypes", () => getDocumentTypes({ env: process.env }));
      stages.receiverA = await preflightStage("receiverA", () => getReceiverVatConditions({ voucherClass: "A", env: process.env }));
      stages.receiverB = await preflightStage("receiverB", () => getReceiverVatConditions({ voucherClass: "B", env: process.env }));
      stages.lastA = await preflightStage("lastA", () => getLastAuthorized({
        voucherType: 1,
        pointOfSale: config.pointOfSale,
        env: process.env,
      }));
      stages.lastB = await preflightStage("lastB", () => getLastAuthorized({
        voucherType: 6,
        pointOfSale: config.pointOfSale,
        env: process.env,
      }));
      stages.issuer = await preflightStage("issuer", () => getTaxpayer(config.issuerCuit, { env: process.env }));
      stages.wsfeCache = await preflightStage("wsfeCache", () => inspectSharedWsaaCache({
        environmentId: environment,
        service: "wsfe",
        env: process.env,
      }));
      stages.registryCache = await preflightStage("registryCache", () => inspectSharedWsaaCache({
        environmentId: environment,
        service: "ws_sr_constancia_inscripcion",
        env: process.env,
      }));

      const wsfe = stages.wsfe.data || {};
      const points = stages.points.data || { points: [], errors: [] };
      const selectedPoint = points.points?.find((point) => point.number === config.pointOfSale) || null;
      const voucherTypes = stages.voucherTypes.data || { types: [] };
      const vatTypes = stages.vatTypes.data || { types: [] };
      const documentTypes = stages.documentTypes.data || { types: [] };
      const receiverA = stages.receiverA.data || { conditions: [] };
      const receiverB = stages.receiverB.data || { conditions: [] };
      const lastA = stages.lastA.data || { number: null, errors: [] };
      const lastB = stages.lastB.data || { number: null, errors: [] };
      const issuer = stages.issuer.data || {};
      const wsfeCache = stages.wsfeCache.data || {};
      const registryCache = stages.registryCache.data || {};

      const pointFound = Boolean(selectedPoint);
      const normalizedDropDate = String(selectedPoint?.dropDate || "").trim().toUpperCase();
      const hasDropDate = Boolean(
        normalizedDropDate
        && !["NULL", "N/A", "00000000", "0000-00-00"].includes(normalizedDropDate)
      );
      const pointOperational = Boolean(
        selectedPoint
        && String(selectedPoint.blocked || "").toUpperCase() !== "S"
        && !hasDropDate
      );
      const issuerActive = stages.issuer.status === "ok"
        && issuer.found === true
        && issuer.keyStatus === "ACTIVO";
      const cacheReady = stages.wsfeCache.status === "ok"
        && stages.registryCache.status === "ok"
        && wsfeCache.reusable === true
        && registryCache.reusable === true;

      const voucherIds = new Set((voucherTypes.types || []).map((item) => item.id));
      const vatIds = new Set((vatTypes.types || []).map((item) => item.id));
      const documentIds = new Set((documentTypes.types || []).map((item) => item.id));
      const receiverAIds = new Set((receiverA.conditions || []).map((item) => item.id));
      const receiverBIds = new Set((receiverB.conditions || []).map((item) => item.id));

      const fiscalTablesReady = (
        stages.voucherTypes.status === "ok"
        && stages.vatTypes.status === "ok"
        && stages.documentTypes.status === "ok"
        && stages.receiverA.status === "ok"
        && stages.receiverB.status === "ok"
        && voucherIds.has(1)
        && voucherIds.has(6)
        && vatIds.has(5)
        && documentIds.has(80)
        && documentIds.has(96)
        && documentIds.has(99)
        && receiverAIds.has(1)
        && receiverAIds.has(6)
        && receiverBIds.has(4)
        && receiverBIds.has(5)
      );

      const sequencesReady = (
        stages.lastA.status === "ok"
        && stages.lastB.status === "ok"
        && (lastA.errors || []).length === 0
        && (lastB.errors || []).length === 0
      );

      const wsfeHealthy = (
        stages.wsfe.status === "ok"
        && [wsfe.appServer, wsfe.dbServer, wsfe.authServer]
          .every((value) => String(value || "").toUpperCase() === "OK")
      );

      const ready = (
        wsfeHealthy
        && stages.points.status === "ok"
        && pointFound
        && pointOperational
        && issuerActive
        && cacheReady
        && fiscalTablesReady
        && sequencesReady
      );

      const failedStages = Object.values(stages)
        .filter((stage) => stage.status === "error")
        .map((stage) => ({
          stage: stage.name,
          code: stage.error?.code || null,
          status: stage.error?.status || null,
          causeCode: stage.error?.causeCode || null,
          message: stage.error?.message || "Error sin detalle.",
        }));

      return json({
        ok: true,
        preflight: {
          environment,
          wsfe: {
            appServer: wsfe.appServer || null,
            dbServer: wsfe.dbServer || null,
            authServer: wsfe.authServer || null,
            healthy: wsfeHealthy,
            stageStatus: stages.wsfe.status,
          },
          pointOfSale: {
            selected: config.pointOfSale,
            found: pointFound,
            operational: pointOperational,
            emissionType: selectedPoint?.emissionType || null,
            blocked: selectedPoint?.blocked || null,
            dropDate: selectedPoint?.dropDate || null,
            returned: (points.points || []).map((point) => point.number),
            errors: publicFiscalMessages(points.errors),
            stageStatus: stages.points.status,
          },
          fiscalTables: {
            ready: fiscalTablesReady,
            voucherTypes: {
              facturaA: voucherIds.has(1),
              facturaB: voucherIds.has(6),
              stageStatus: stages.voucherTypes.status,
            },
            vat21: vatIds.has(5),
            vatStageStatus: stages.vatTypes.status,
            documentTypes: {
              cuit80: documentIds.has(80),
              dni96: documentIds.has(96),
              consumidorFinal99: documentIds.has(99),
              stageStatus: stages.documentTypes.status,
            },
            receiverConditions: {
              responsableInscriptoA: receiverAIds.has(1),
              monotributoA: receiverAIds.has(6),
              exentoB: receiverBIds.has(4),
              consumidorFinalB: receiverBIds.has(5),
              stageAStatus: stages.receiverA.status,
              stageBStatus: stages.receiverB.status,
            },
          },
          sequences: {
            ready: sequencesReady,
            facturaA: {
              voucherType: 1,
              lastAuthorized: lastA.number ?? null,
              errors: publicFiscalMessages(lastA.errors),
              stageStatus: stages.lastA.status,
            },
            facturaB: {
              voucherType: 6,
              lastAuthorized: lastB.number ?? null,
              errors: publicFiscalMessages(lastB.errors),
              stageStatus: stages.lastB.status,
            },
          },
          issuer: {
            found: issuer.found === true,
            keyStatus: issuer.keyStatus || null,
            personType: issuer.personType || null,
            endpoint: issuer.endpoint?.includes("afip.gov.ar") ? "official-legacy" : issuer.endpoint ? "arca-current" : null,
            stageStatus: stages.issuer.status,
          },
          cache: {
            wsfe: wsfeCache,
            registry: registryCache,
            wsfeStageStatus: stages.wsfeCache.status,
            registryStageStatus: stages.registryCache.status,
          },
          credentials: {
            ready: safeStatus.credentialsReady,
            validTo: safeStatus.certificateValidTo,
            fingerprint256: safeStatus.certificateFingerprint256,
          },
          productionCapabilities: {
            readonly: safeStatus.productionReadonlyEnabled,
            invoicePreparation: safeStatus.productionInvoicePreparationEnabled,
            taxpayerLookup: safeStatus.productionTaxpayerLookupEnabled,
            cae: false,
          },
          failedStages,
          ready,
          caeProductionEnabled: false,
        },
      });
    }

    if (body?.mode === "diagnostics") {
      const diagnostics = await runDiagnostics();
      return json({ ok: true, diagnostics });
    }

    assertTaxpayerLookupAllowed(process.env);

    const cuit = String(body?.cuit || "").trim();
    if (!cuit) return json({ ok: false, code: "missing-cuit", message: "Ingresá una CUIT." }, 400);

    const taxpayer = await getTaxpayer(cuit, { env: process.env });
    const inferred = inferReceiverVatCondition(taxpayer);
    const environment = arcaEnvironment(process.env).id;

    return json({
      ok: true,
      environment,
      taxpayer: {
        cuit: taxpayer.cuit,
        found: taxpayer.found,
        firstName: taxpayer.firstName,
        lastName: taxpayer.lastName,
        businessName: taxpayer.businessName,
        personType: taxpayer.personType,
        keyType: taxpayer.keyType,
        keyStatus: taxpayer.keyStatus,
        fiscalAddress: taxpayer.fiscalAddress,
        taxes: taxpayer.taxes,
        monotributo: taxpayer.monotributo,
        monotributoCategory: taxpayer.monotributoData?.category || null,
        errors: {
          constancia: taxpayer.errorConstancia ? "ARCA informó una observación sobre la constancia." : null,
          regimenGeneral: taxpayer.errorRegimenGeneral ? "ARCA informó una observación sobre el régimen general." : null,
          monotributo: taxpayer.errorMonotributo ? "ARCA informó una observación sobre Monotributo." : null,
        },
      },
      receiverVatCondition: inferred.resolved ? inferred.condition : null,
      receiverVatConditionReason: inferred.reason,
    });
  } catch (error) {
    const safe = safeError(error);
    return json({ ok: false, ...safe }, safe.status);
  }
}
