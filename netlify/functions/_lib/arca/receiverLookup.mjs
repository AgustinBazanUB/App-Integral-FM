import { assertValidCuit } from "./cuit.mjs";
import { arcaEnvironment } from "./config.mjs";
import { getTaxpayer } from "./registry.mjs";
import { inferReceiverVatCondition } from "./receiver.mjs";

export async function lookupBillingReceiver(cuit, { env = process.env, lookup = getTaxpayer } = {}) {
  const documentNumber = assertValidCuit(cuit, "CUIT del receptor");
  if (arcaEnvironment(env).id === "production"
    && String(env.ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP || "").trim().toLowerCase() !== "true") {
    const error = new Error("La consulta productiva de CUIT está bloqueada por configuración.");
    error.code = "arca-production-taxpayer-lookup-disabled";
    error.status = 409;
    throw error;
  }
  const taxpayer = await lookup(documentNumber, { env });
  const inferred = inferReceiverVatCondition(taxpayer);
  if (!inferred.resolved) {
    const error = new Error("ARCA no pudo determinar la condición IVA de este CUIT. Revisá su constancia antes de facturar.");
    error.code = "arca-receiver-condition-unresolved";
    error.status = 422;
    throw error;
  }
  return {
    name: taxpayer.businessName || [taxpayer.firstName, taxpayer.lastName].filter(Boolean).join(" "),
    condition: inferred.condition,
    receiver: {
      vatConditionId: inferred.condition.id,
      documentType: 80,
      documentNumber,
      anonymousConsumerFinal: false,
      concept: 1,
    },
  };
}
