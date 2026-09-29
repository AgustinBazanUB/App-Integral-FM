import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { getTaxpayer } from "./_lib/arca/registry.mjs";
import { inferReceiverVatCondition } from "./_lib/arca/receiver.mjs";
import { arcaEnvironment, arcaSafeStatus, loadArcaPublicConfig } from "./_lib/arca/config.mjs";
import { wsfeDummy, getPointsOfSale } from "./_lib/arca/wsfe.mjs";
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

      const config = loadArcaPublicConfig(process.env);
      const wsfe = await wsfeDummy({ env: process.env });
      const points = await getPointsOfSale({ env: process.env });
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

      const pointFound = points.points.some((point) => point.number === config.pointOfSale);
      const issuerActive = issuer.found === true && issuer.keyStatus === "ACTIVO";
      const cacheReady = wsfeCache.reusable === true && registryCache.reusable === true;

      return json({
        ok: pointFound && issuerActive && cacheReady,
        preflight: {
          environment,
          wsfe: {
            appServer: wsfe.appServer,
            dbServer: wsfe.dbServer,
            authServer: wsfe.authServer,
          },
          pointOfSale: {
            selected: config.pointOfSale,
            found: pointFound,
            returned: points.points.map((point) => point.number),
            errors: points.errors,
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
          caeProductionEnabled: false,
        },
      }, pointFound && issuerActive && cacheReady ? 200 : 409);
    }

    if (body?.mode === "diagnostics") {
      const diagnostics = await runDiagnostics();
      return json({ ok: true, diagnostics });
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
