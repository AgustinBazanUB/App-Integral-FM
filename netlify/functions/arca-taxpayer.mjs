import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { getTaxpayer } from "./_lib/arca/registry.mjs";
import { inferReceiverVatCondition } from "./_lib/arca/receiver.mjs";
import { arcaEnvironment, arcaSafeStatus, loadArcaPublicConfig } from "./_lib/arca/config.mjs";
import { wsfeDummy, getPointsOfSale } from "./_lib/arca/wsfe.mjs";
import { registryDummy } from "./_lib/arca/registry.mjs";
import { firebaseAdminAccessToken, adminGetDocument } from "./_lib/firestoreAdminRest.mjs";

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
      const firestoreProbe = await adminGetDocument("settings/__arca_diagnostics__", { env: process.env });
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
