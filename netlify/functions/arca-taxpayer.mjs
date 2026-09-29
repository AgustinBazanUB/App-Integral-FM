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

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  return {
    code: error?.code || "arca-taxpayer-error",
    status: Number(error?.status || 0) || null,
    causeCode: error?.causeCode || null,
    message: String(error?.message || "No se pudo completar la operación.").slice(0, 240),
  };
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
      errors: points.errors,
    };
    diagnostics.pointOfSale.status = diagnostics.pointOfSale.data.found ? "ok" : "error";
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

export default async function handler(request) {
  if (request.method !== "POST") return json({ ok: false, code: "method-not-allowed" }, 405);

  try {
    await requireFirebaseAdmin(request);
    const body = await request.json().catch(() => ({}));

    if (body?.mode === "status") {
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
            errors: points.errors,
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
      const wsfe = await wsfeDummy({ env: process.env });
      const points = await getPointsOfSale({ env: process.env });
      const selectedPoint = points.points.find((point) => point.number === config.pointOfSale) || null;
      const voucherTypes = await getVoucherTypes({ env: process.env });
      const vatTypes = await getVatTypes({ env: process.env });
      const documentTypes = await getDocumentTypes({ env: process.env });
      const receiverA = await getReceiverVatConditions({ voucherClass: "A", env: process.env });
      const receiverB = await getReceiverVatConditions({ voucherClass: "B", env: process.env });
      const lastA = await getLastAuthorized({
        voucherType: 1,
        pointOfSale: config.pointOfSale,
        env: process.env,
      });
      const lastB = await getLastAuthorized({
        voucherType: 6,
        pointOfSale: config.pointOfSale,
        env: process.env,
      });
      const issuer = await getTaxpayer(config.issuerCuit, { env: process.env });
      const [wsfeCache, registryCache] = await Promise.all([
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

      const pointFound = Boolean(selectedPoint);
      const pointOperational = Boolean(
        selectedPoint
        && String(selectedPoint.blocked || "").toUpperCase() !== "S"
        && !selectedPoint.dropDate
      );
      const issuerActive = issuer.found === true && issuer.keyStatus === "ACTIVO";
      const cacheReady = wsfeCache.reusable === true && registryCache.reusable === true;
      const voucherIds = new Set(voucherTypes.types.map((item) => item.id));
      const vatIds = new Set(vatTypes.types.map((item) => item.id));
      const documentIds = new Set(documentTypes.types.map((item) => item.id));
      const receiverAIds = new Set(receiverA.conditions.map((item) => item.id));
      const receiverBIds = new Set(receiverB.conditions.map((item) => item.id));
      const fiscalTablesReady = (
        voucherIds.has(1)
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
      const sequencesReady = lastA.errors.length === 0 && lastB.errors.length === 0;
      const wsfeHealthy = [wsfe.appServer, wsfe.dbServer, wsfe.authServer]
        .every((value) => String(value || "").toUpperCase() === "OK");
      const ready = (
        wsfeHealthy
        && pointFound
        && pointOperational
        && issuerActive
        && cacheReady
        && fiscalTablesReady
        && sequencesReady
      );

      return json({
        ok: ready,
        preflight: {
          environment,
          wsfe: {
            appServer: wsfe.appServer,
            dbServer: wsfe.dbServer,
            authServer: wsfe.authServer,
            healthy: wsfeHealthy,
          },
          pointOfSale: {
            selected: config.pointOfSale,
            found: pointFound,
            operational: pointOperational,
            emissionType: selectedPoint?.emissionType || null,
            blocked: selectedPoint?.blocked || null,
            dropDate: selectedPoint?.dropDate || null,
            returned: points.points.map((point) => point.number),
            errors: points.errors,
          },
          fiscalTables: {
            ready: fiscalTablesReady,
            voucherTypes: {
              facturaA: voucherIds.has(1),
              facturaB: voucherIds.has(6),
            },
            vat21: vatIds.has(5),
            documentTypes: {
              cuit80: documentIds.has(80),
              dni96: documentIds.has(96),
              consumidorFinal99: documentIds.has(99),
            },
            receiverConditions: {
              responsableInscriptoA: receiverAIds.has(1),
              monotributoA: receiverAIds.has(6),
              exentoB: receiverBIds.has(4),
              consumidorFinalB: receiverBIds.has(5),
            },
          },
          sequences: {
            ready: sequencesReady,
            facturaA: {
              voucherType: 1,
              lastAuthorized: lastA.number,
              errors: lastA.errors,
            },
            facturaB: {
              voucherType: 6,
              lastAuthorized: lastB.number,
              errors: lastB.errors,
            },
          },
          issuer: {
            found: issuer.found,
            keyStatus: issuer.keyStatus,
            personType: issuer.personType,
            endpoint: issuer.endpoint?.includes("afip.gov.ar") ? "official-legacy" : "arca-current",
          },
          cache: {
            wsfe: wsfeCache,
            registry: registryCache,
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
          ready,
          caeProductionEnabled: false,
        },
      }, ready ? 200 : 409);
    }

    if (body?.mode === "diagnostics") {
      const diagnostics = await runDiagnostics();
      return json({ ok: true, diagnostics });
    }

    const runtimeEnvironment = arcaEnvironment(process.env).id;
    if (
      runtimeEnvironment === "production"
      && String(process.env.ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP || "").trim().toLowerCase() !== "true"
    ) {
      return json({
        ok: false,
        code: "arca-production-taxpayer-lookup-disabled",
        message: "La consulta productiva de CUIT está bloqueada por configuración.",
      }, 409);
    }

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
          constancia: taxpayer.errorConstancia?.message || null,
          regimenGeneral: taxpayer.errorRegimenGeneral?.message || null,
          monotributo: taxpayer.errorMonotributo?.message || null,
        },
      },
      receiverVatCondition: inferred.resolved ? inferred.condition : null,
      receiverVatConditionReason: inferred.reason,
    });
  } catch (error) {
    const status = Number(error?.status || 0) || 500;
    return json({ ok: false, ...safeError(error) }, status);
  }
}
