import { toPublicArcaError } from "./publicError.mjs";

// Explicit response schemas: historical Firestore records must not become an API DTO.
const text = value => typeof value === "string" ? value.slice(0, 200) : null;
const number = value => typeof value === "number" && Number.isFinite(value) ? value : null;
const boolean = value => value === true;
const enumeration = values => value => values.includes(value) ? value : null;
const list = schema => value => Array.isArray(value) ? value.slice(0, 100).map(item => project(item, schema)) : [];
function project(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(schema).filter(([key]) => Object.hasOwn(value, key))
    .map(([key, rule]) => [key, typeof rule === "function" ? rule(value[key]) : project(value[key], rule)]));
}
export function publicFiscalMessages(value) {
  return (Array.isArray(value) ? value : []).slice(0, 100).map(item => ({
    code: Number.isSafeInteger(Number(item?.code)) ? Number(item.code) : null,
    message: "ARCA informó una observación fiscal. Revisá el código de respuesta.",
  }));
}
const status = enumeration(["pending", "authorizing", "reconciling", "authorized", "rejected", "error", "unknown"]);
const sourceType = enumeration(["admin_quick_sale", "seller_sale", "ecommerce"]);
const environment = enumeration(["homologation", "production"]);
const reason = enumeration(["invoice-not-pending", "invoice-not-reconciling", "invoice-not-authorizing", "invoice-not-authorized", "pre-cae-recovery-not-safe", "last-authorized-error", "claimed", "concurrent-claim", "sequence-busy", "concurrent-lock", "busy", "concurrent-create", "concurrent-update", "status-authorizing", "status-authorized", "status-reconciling", "status-rejected", "status-error"]);
const blockers = value => Array.isArray(value) ? value.filter(item => item === "consumer-final-identification-required") : [];
const breakdown = { id: number, rate: number, base: number, amount: number };
const fiscal = { total: number, net: number, vat: number, nonTaxed: number, exempt: number, tributes: number, vatBreakdown: list(breakdown) };
const document = { documentType: number, documentNumber: text, requiresIdentification: boolean };
const receiver = { vatConditionId: number, documentType: number, documentNumber: text, anonymousConsumerFinal: boolean, concept: number, cuit: text, businessName: text, firstName: text, lastName: text };
const authorization = {
  voucherClass: enumeration(["A", "B", "C", "M"]), pointOfSale: number, voucherType: number,
  voucherNumber: number, cae: text, caeExpiration: text, authorizedAt: text,
  result: enumeration(["A", "R"]), observations: publicFiscalMessages, errors: publicFiscalMessages, events: publicFiscalMessages, fiscal,
};
const verification = { matched: boolean, checkedAt: text, result: enumeration(["A", "R"]),
  pointOfSale: number, voucherType: number, voucherNumber: number, cae: text, caeExpiration: text,
  errors: publicFiscalMessages, events: publicFiscalMessages };
export function publicReceiver(value) { return project(value, receiver); }
export function publicFiscalReadiness(value) {
  return project(value, { ready: boolean, missingProducts: value => Array.isArray(value) ? value.map(text) : [], missingVatRate: value => Array.isArray(value) ? value.map(text) : [] });
}
export function publicInvoice(value) {
  return project(value, { id: text, status, fiscalEnvironment: environment, sourceType, sourceId: text,
    createdAt: text, updatedAt: text, receiverSnapshot: receiver, authorization, verification,
    fiscalReadiness: publicFiscalReadiness, error: toPublicArcaError,
    saleSnapshot: { saleCode: text, total: number } });
}
export function publicAuthorizationResult(value) {
  return project(value, { status, alreadyAuthorized: boolean, needsReconciliation: boolean,
    blocked: boolean, dryRun: boolean, verified: boolean, matched: boolean, recovered: boolean,
    reason, blockers, invoice: publicInvoice, error: toPublicArcaError, errors: publicFiscalMessages,
    verification, expected: authorization, postAuthorizationVerification: publicAuthorizationResult,
    plan: { voucherType: number, voucherClass: enumeration(["A", "B"]),
      voucherReason: enumeration(["responsable-inscripto-to-registered-or-monotributo", "responsable-inscripto-to-consumer-or-nonregistered"]),
      receiverVatConditionId: number, receiverDocument: document, fiscal, blockers,
      detailBase: { ...fiscal, concept: number, docType: number, docNumber: text,
        voucherDate: text, receiverVatConditionId: number, currencyId: enumeration(["PES"]), currencyQuote: number } } });
}
