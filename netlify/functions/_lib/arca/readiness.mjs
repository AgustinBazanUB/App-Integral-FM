import { arcaSafeStatus, loadArcaPublicConfig } from "./config.mjs";
import { inspectInvoicePdfReadiness } from "./invoicePdf.mjs";

const CORE_RUNTIME_SERVICES = Object.freeze(["wsaa", "wsfe", "firebaseAdmin", "pointOfSale"]);

const PDF_FIELD_LABELS = Object.freeze({
  legalName: "razón social del emisor",
  commercialAddress: "domicilio comercial del emisor",
  grossIncome: "Ingresos Brutos del emisor",
  activityStart: "fecha de inicio de actividades del emisor",
  vatCondition: "condición IVA del emisor",
});

function stageStatus(stage) {
  const value = String(stage?.status || "unknown").trim().toLowerCase();
  return ["ok", "ready", "error", "disabled", "unknown"].includes(value) ? value : "unknown";
}

function stageReady(stage) {
  return ["ok", "ready"].includes(stageStatus(stage));
}

function temporaryFailure(error = {}) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || "").toLowerCase();
  return status >= 500
    || code.includes("network")
    || code.includes("timeout")
    || code.includes("tempor")
    || code === "fetch-failed";
}

function publicStage(stage, fallbackMessage = "") {
  const status = stageStatus(stage);
  const error = stage?.error && typeof stage.error === "object" ? stage.error : null;
  return {
    status,
    message: error?.message
      ? String(error.message).slice(0, 240)
      : String(stage?.message || fallbackMessage || "").slice(0, 240) || null,
    code: error?.code ? String(error.code).slice(0, 120) : null,
    temporary: status === "error" && temporaryFailure(error),
  };
}

function safePointOfSale(env, safeStatus, runtimePoint) {
  let selected = Number(runtimePoint?.selected || 0) || null;
  if (!selected && safeStatus?.pointOfSaleConfigured) {
    try {
      selected = loadArcaPublicConfig(env).pointOfSale;
    } catch {
      const raw = Number(env.ARCA_POINT_OF_SALE || 0);
      selected = Number.isInteger(raw) && raw > 0 ? raw : null;
    }
  }
  return selected;
}

function configurationView(safeStatus = {}) {
  return {
    environment: safeStatus.environment || "homologation",
    issuerConfigured: safeStatus.issuerConfigured === true,
    pointOfSaleConfigured: safeStatus.pointOfSaleConfigured === true,
    certificateConfigured: safeStatus.certificateConfigured === true,
    privateKeyConfigured: safeStatus.privateKeyConfigured === true,
    credentialsReady: safeStatus.credentialsReady === true,
    certificateValidNow: safeStatus.certificateValidNow === true,
    certificateKeyMatch: safeStatus.certificateKeyMatch === true,
    certificateValidFrom: safeStatus.certificateValidFrom || null,
    certificateValidTo: safeStatus.certificateValidTo || null,
    credentialErrorCode: safeStatus.credentialErrorCode || null,
    issuerVatConditionConfigured: safeStatus.issuerVatConditionConfigured === true,
    invoicePdfIssuerReady: safeStatus.invoicePdfIssuerReady === true,
    invoicePdfIssuerMissingFields: Array.isArray(safeStatus.invoicePdfIssuerMissingFields)
      ? [...safeStatus.invoicePdfIssuerMissingFields]
      : [],
    caeHomologationEnabled: safeStatus.caeHomologationEnabled === true,
    taSharedCacheConfigured: safeStatus.taSharedCacheConfigured === true,
    taSharedCacheRequiredInProduction: safeStatus.taSharedCacheRequiredInProduction !== false,
    productionReadonlyEnabled: safeStatus.productionReadonlyEnabled === true,
    productionInvoicePreparationEnabled: safeStatus.productionInvoicePreparationEnabled === true,
    productionTaxpayerLookupEnabled: safeStatus.productionTaxpayerLookupEnabled === true,
    productionCaeEnabled: safeStatus.productionCaeEnabled === true,
    productionAutoAuthorizeEnabled: safeStatus.productionAutoAuthorizeEnabled === true,
    productionAutoAuthorizeSources: Array.isArray(safeStatus.productionAutoAuthorizeSources)
      ? [...safeStatus.productionAutoAuthorizeSources]
      : [],
    productionCaeTargetSaleCode: safeStatus.productionCaeTargetSaleCode || null,
    publicConfigError: safeStatus.publicConfigError || null,
  };
}

export function buildArcaOperationalStatus({
  env = process.env,
  runtime = {},
  safeStatus = arcaSafeStatus(env),
  pdfStatus = inspectInvoicePdfReadiness(env),
  now = new Date(),
} = {}) {
  const configuration = configurationView(safeStatus);
  const environment = String(configuration.environment || "homologation").toLowerCase();
  const production = environment === "production";
  const automaticSources = [...new Set(
    (configuration.productionAutoAuthorizeSources || [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean),
  )];
  const pointOfSale = safePointOfSale(env, configuration, runtime.pointOfSale);

  const pdfReady = pdfStatus?.ready === true;
  const missingPdfFields = Array.isArray(pdfStatus?.missing) ? [...pdfStatus.missing] : [];
  const configured = Boolean(
    configuration.issuerConfigured
    && configuration.pointOfSaleConfigured
    && configuration.credentialsReady
    && configuration.issuerVatConditionConfigured
    && (!production || configuration.taSharedCacheConfigured),
  );

  const emissionEnabled = production
    ? configuration.productionInvoicePreparationEnabled && configuration.productionCaeEnabled
    : configuration.caeHomologationEnabled;
  const taxpayerLookupEnabled = production
    ? configuration.productionTaxpayerLookupEnabled
    : true;
  const automaticBillingEnabled = Boolean(
    production
    && emissionEnabled
    && configuration.productionAutoAuthorizeEnabled
    && automaticSources.length,
  );

  const wsaa = publicStage(runtime.wsaa, "WSAA todavía no fue verificado.");
  const wsfe = publicStage(runtime.wsfe, "WSFE todavía no fue verificado.");
  const firebaseAdmin = publicStage(runtime.firebaseAdmin, "Firebase Admin todavía no fue verificado.");
  const runtimePoint = publicStage(runtime.pointOfSale, "El punto de venta todavía no fue verificado contra ARCA.");
  const taxpayerLookup = taxpayerLookupEnabled
    ? publicStage(runtime.taxpayerLookup, "La consulta de CUIT todavía no fue verificada.")
    : {
        status: "disabled",
        message: "Consulta CUIT deshabilitada por el interruptor de seguridad productivo.",
        code: null,
        temporary: false,
      };

  const blockers = [];
  const addBlocker = (code, message, scope = "operational", temporary = false) => {
    blockers.push({ code, message, scope, temporary: temporary === true });
  };

  if (!configuration.issuerConfigured) addBlocker("arca-issuer-missing", "Falta: CUIT del emisor.");
  if (!configuration.pointOfSaleConfigured || !pointOfSale) {
    addBlocker("arca-point-of-sale-missing", "Falta: punto de venta ARCA válido.");
  }
  if (!configuration.credentialsReady) {
    const credentialMessages = {
      "arca-credentials-missing": "Falta: certificado o clave privada ARCA.",
      "arca-certificate-invalid": "El certificado ARCA configurado no es válido.",
      "arca-private-key-invalid": "La clave privada ARCA configurada no es válida.",
      "arca-certificate-key-mismatch": "La clave privada no corresponde al certificado ARCA.",
      "arca-certificate-not-currently-valid": "El certificado ARCA está fuera de vigencia.",
    };
    addBlocker(
      configuration.credentialErrorCode || "arca-credentials-not-ready",
      credentialMessages[configuration.credentialErrorCode] || "Las credenciales ARCA no están listas.",
    );
  }
  if (!configuration.issuerVatConditionConfigured) {
    addBlocker("arca-issuer-vat-condition-missing", "Falta: condición IVA del emisor.");
  }
  if (production && !configuration.taSharedCacheConfigured) {
    addBlocker("arca-wsaa-cache-key-missing", "Falta: configuración del caché cifrado de WSAA.");
  }
  if (!pdfReady) {
    for (const field of missingPdfFields) {
      addBlocker(
        "arca-pdf-issuer-field-missing",
        "Falta: " + (PDF_FIELD_LABELS[field] || field) + ".",
      );
    }
  }

  const runtimeByName = { wsaa, wsfe, firebaseAdmin, pointOfSale: runtimePoint };
  for (const name of CORE_RUNTIME_SERVICES) {
    const stage = runtimeByName[name];
    if (stage.status === "error") {
      const labels = {
        wsaa: "WSAA",
        wsfe: "WSFE",
        firebaseAdmin: "Firebase Admin",
        pointOfSale: "punto de venta",
      };
      addBlocker(
        stage.code || "arca-runtime-error",
        (labels[name] || name) + ": " + (stage.message || "verificación fallida."),
        "operational",
        stage.temporary,
      );
    } else if (stage.status === "unknown") {
      addBlocker(
        "arca-runtime-not-checked",
        (name === "pointOfSale" ? "Punto de venta" : name.toUpperCase()) + ": estado todavía no verificado.",
      );
    }
  }

  if (runtime.pointOfSale?.status === "ok" && runtime.pointOfSale?.operational === false) {
    addBlocker(
      "arca-point-of-sale-not-operational",
      "El punto de venta configurado existe pero ARCA no lo informa como operativo.",
    );
  }

  if (taxpayerLookupEnabled && taxpayerLookup.status === "error") {
    addBlocker(
      taxpayerLookup.code || "arca-taxpayer-lookup-unavailable",
      "Consulta CUIT: " + (taxpayerLookup.message || "verificación fallida."),
      "taxpayerLookup",
      taxpayerLookup.temporary,
    );
  }

  const coreRuntimeReady = CORE_RUNTIME_SERVICES.every((name) => stageReady(runtimeByName[name]));
  const pointOperational = runtime.pointOfSale?.operational !== false;
  const operational = Boolean(configured && pdfReady && coreRuntimeReady && pointOperational);
  const taxpayerLookupReady = Boolean(taxpayerLookupEnabled && stageReady(taxpayerLookup));
  const productionReady = Boolean(production && operational);

  const temporaryCoreFailure = blockers.some(
    (item) => item.scope === "operational" && item.temporary === true,
  );
  const availability = operational
    ? "available"
    : temporaryCoreFailure
      ? "unavailable"
      : "degraded";

  return {
    environment,
    configured,
    operational,
    productionReady,
    emissionEnabled,
    taxpayerLookupEnabled,
    taxpayerLookupReady,
    pdfReady,
    pointOfSale,
    automaticSources,
    automaticBillingEnabled,
    availability,
    checkedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    services: {
      certificate: {
        status: configuration.credentialsReady ? "ready" : "error",
        message: configuration.credentialsReady
          ? "Certificado y clave privada válidos y vigentes."
          : "Credenciales ARCA pendientes de corrección.",
      },
      pointOfSale: {
        ...runtimePoint,
        selected: pointOfSale,
        found: runtime.pointOfSale?.found === true,
        operational: runtime.pointOfSale?.operational === true,
      },
      wsaa,
      wsfe,
      firebaseAdmin,
      taxpayerLookup: { ...taxpayerLookup, enabled: taxpayerLookupEnabled },
      automaticBilling: {
        status: automaticBillingEnabled ? "enabled" : "disabled",
        enabled: automaticBillingEnabled,
        message: automaticBillingEnabled
          ? "Autorización automática productiva habilitada sólo para las fuentes permitidas."
          : "Facturación automática productiva deshabilitada por uno o más interruptores de seguridad.",
      },
      pdf: {
        status: pdfReady ? "ready" : "error",
        ready: pdfReady,
        missingFields: missingPdfFields,
        message: pdfReady
          ? "Datos del emisor listos para generar PDF fiscal."
          : "Faltan datos del emisor para generar el PDF fiscal completo.",
      },
    },
    gates: {
      productionReadonly: configuration.productionReadonlyEnabled,
      invoicePreparation: production ? configuration.productionInvoicePreparationEnabled : true,
      productionCae: production ? configuration.productionCaeEnabled : false,
      autoAuthorize: production ? configuration.productionAutoAuthorizeEnabled : false,
      homologationCae: !production ? configuration.caeHomologationEnabled : false,
    },
    configuration,
    blockers,
  };
}
