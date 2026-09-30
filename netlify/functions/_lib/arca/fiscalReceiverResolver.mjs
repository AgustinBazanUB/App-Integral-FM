import { assertValidCuit } from "./cuit.mjs";
import { assertTaxpayerLookupAllowed } from "./config.mjs";
import { ARCA_RECEIVER_VAT_CONDITIONS, consumerFinalReceiver, inferReceiverVatCondition } from "./receiver.mjs";

function requiredConsumerFinalThreshold(env = process.env) {
  const raw = String(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD || "").trim();
  const threshold = Number(raw);
  if (!raw || !Number.isFinite(threshold) || threshold <= 0) {
    const error = new Error("Falta configurar un umbral válido para Consumidor Final.");
    error.code = "arca-config-missing";
    error.status = 409;
    error.field = "ARCA_CONSUMER_FINAL_ID_THRESHOLD";
    throw error;
  }
  return threshold;
}
function normalizedTotal(value) {
  if (!(["number", "string"].includes(typeof value)) || String(value).trim() === "") {
    const error = new Error("Falta el total de la venta.");
    error.code = "fiscal-sale-total-required";
    error.status = 400;
    throw error;
  }
  const total = Number(value);
  if (!Number.isFinite(total) || total < 0) {
    const error = new Error("El total de la venta no es válido.");
    error.code = "fiscal-sale-total-required";
    error.status = 400;
    throw error;
  }
  return total;
}
function displayName(person = {}) {
  const business = String(person.businessName || "").trim();
  if (business) return business;
  return [person.lastName, person.firstName].map((value) => String(value || "").trim()).filter(Boolean).join(", ") || null;
}
function taxpayerReview(person, condition) {
  return {
    cuit: person.cuit,
    displayName: displayName(person),
    keyStatus: person.keyStatus || null,
    personType: person.personType || null,
    fiscalAddress: person.fiscalAddress || null,
    vatCondition: condition ? { id: Number(condition.id), description: condition.description || null } : null,
  };
}

export async function resolveFiscalReceiver({
  mode,
  cuit = "",
  saleTotal = null,
  concept = 1,
  env = process.env,
  lookupTaxpayer = null,
} = {}) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (Number(concept) !== 1) {
    const error = new Error("El concepto fiscal solicitado no está soportado por este flujo.");
    error.code = "fiscal-concept-unsupported";
    error.status = 400;
    throw error;
  }

  if (normalizedMode === "consumer_final") {
    const total = normalizedTotal(saleTotal);
    const threshold = requiredConsumerFinalThreshold(env);
    if (total >= threshold) {
      const error = new Error("La venta exige identificación del receptor.");
      error.code = "consumer-final-identification-required";
      error.status = 422;
      error.threshold = threshold;
      throw error;
    }
    const condition = consumerFinalReceiver().condition || ARCA_RECEIVER_VAT_CONDITIONS.CONSUMIDOR_FINAL;
    return {
      mode: "consumer_final",
      lookupPerformed: false,
      requiresConfirmation: true,
      receiver: {
        vatConditionId: Number(condition.id),
        documentType: 99,
        documentNumber: "0",
        anonymousConsumerFinal: true,
        concept: 1,
      },
      taxpayer: null,
      review: {
        cuit: null,
        displayName: "Consumidor Final",
        keyStatus: null,
        personType: null,
        fiscalAddress: null,
        vatCondition: { id: Number(condition.id), description: condition.description },
      },
    };
  }

  if (normalizedMode !== "cuit") {
    const error = new Error("Modo de receptor fiscal inválido.");
    error.code = "fiscal-receiver-mode-invalid";
    error.status = 400;
    throw error;
  }

  const normalizedCuit = assertValidCuit(cuit, "CUIT");
  assertTaxpayerLookupAllowed(env);
  if (typeof lookupTaxpayer !== "function") {
    const error = new Error("No se configuró el adaptador de Padrón.");
    error.code = "fiscal-taxpayer-lookup-unavailable";
    error.status = 500;
    throw error;
  }
  const person = await lookupTaxpayer(normalizedCuit, { env });

  if (person?.found !== true) {
    const error = new Error("Contribuyente no encontrado.");
    error.code = "fiscal-taxpayer-not-found";
    error.status = 404;
    throw error;
  }
  if (person.keyStatus && String(person.keyStatus).trim().toUpperCase() !== "ACTIVO") {
    const error = new Error("Contribuyente no activo.");
    error.code = "fiscal-taxpayer-inactive";
    error.status = 422;
    throw error;
  }

  const inferred = inferReceiverVatCondition(person);
  if (!inferred.resolved || !inferred.condition) {
    const error = new Error("No se pudo resolver la condición IVA.");
    error.code = "fiscal-vat-condition-unresolved";
    error.status = 422;
    error.reason = inferred.reason;
    throw error;
  }

  const review = taxpayerReview(person, inferred.condition);
  return {
    mode: "cuit",
    lookupPerformed: true,
    requiresConfirmation: true,
    receiver: {
      vatConditionId: Number(inferred.condition.id),
      documentType: 80,
      documentNumber: normalizedCuit,
      anonymousConsumerFinal: false,
      concept: 1,
    },
    taxpayer: review,
    review,
    inferenceReason: inferred.reason,
  };
}
