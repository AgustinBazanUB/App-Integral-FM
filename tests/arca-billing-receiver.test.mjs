import test from "node:test";
import assert from "node:assert/strict";
import { lookupBillingReceiver } from "../netlify/functions/_lib/arca/receiverLookup.mjs";
import { buildAuthorizationPlan } from "../netlify/functions/_lib/arca/authorizationPlan.mjs";
import { can } from "../src/gestion/permissions.js";

const cuit = "20123456786";
const env = { ARCA_ENVIRONMENT: "production", ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP: "true" };
const invoice = {
  status: "pending", fiscalReadiness: { ready: true },
  saleSnapshot: { subtotal: 5000, discountTotal: 4900, total: 100, items: [{ productId: "sal", qty: 1, unitPrice: 5000, subtotal: 5000 }] },
  productFiscalSnapshot: [{ productId: "sal", arcaVatRate: 21 }],
};
test("sal con descuento de 4900 conserva total fiscal 100 para A y B", async () => {
  const result = await lookupBillingReceiver(cuit, { env, lookup: async number => {
    assert.equal(number, cuit);
    return { found: true, keyStatus: "ACTIVO", firstName: "Cliente", taxes: [{ id: 30, status: "AC" }] };
  } });
  for (const receiver of [result.receiver, { vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: true }]) {
    const plan = buildAuthorizationPlan({ invoice, issuerVatCondition: "responsable_inscripto", consumerFinalIdThreshold: 10000000, receiverVatConditionId: receiver.vatConditionId, ...receiver });
    assert.equal(plan.fiscal.total, 100);
    assert.equal(plan.fiscal.net, 82.64);
    assert.equal(plan.fiscal.vat, 17.36);
    assert.equal(plan.voucherClass, receiver.vatConditionId === 1 ? "A" : "B");
  }
});
test("CUIT monotributista usa su condición real y factura A para este emisor RI", async () => {
  const result = await lookupBillingReceiver(cuit, { env, lookup: async () => ({ found: true, keyStatus: "ACTIVO", monotributo: true, monotributoData: { taxes: [{ id: 20, status: "AC" }] } }) });
  assert.equal(result.receiver.vatConditionId, 6);
  assert.equal(buildAuthorizationPlan({ invoice, issuerVatCondition: "responsable_inscripto", receiverVatConditionId: 6, ...result.receiver }).voucherClass, "A");
});
test("consulta bloqueada o CUIT inválido no contacta ARCA", async () => {
  let calls = 0;
  const lookup = async () => { calls++; };
  await assert.rejects(lookupBillingReceiver(cuit, { env: { ARCA_ENVIRONMENT: "production" }, lookup }), { code: "arca-production-taxpayer-lookup-disabled" });
  await assert.rejects(lookupBillingReceiver("20123456787", { env, lookup }), { code: "arca-cuit-invalid" });
  assert.equal(calls, 0);
});
test("una condición desconocida no se convierte silenciosamente en consumidor final", async () => {
  await assert.rejects(lookupBillingReceiver(cuit, { env, lookup: async () => ({ found: true, keyStatus: "ACTIVO", taxes: [] }) }), { code: "arca-receiver-condition-unresolved" });
});
test("CUIL activo sin inscripciones permite factura B identificada sin inventar un CUIT RI", async () => {
  const taxpayer = { found: true, keyType: "CUIL", keyStatus: "ACTIVO", taxes: [], monotributo: false };
  const result = await lookupBillingReceiver(cuit, { env, lookup: async () => taxpayer });
  assert.equal(result.receiver.vatConditionId, 5);
  assert.equal(result.receiver.documentType, 86);
  assert.equal(result.receiver.anonymousConsumerFinal, false);
  assert.equal(buildAuthorizationPlan({ invoice, issuerVatCondition: "responsable_inscripto", receiverVatConditionId: 5, ...result.receiver }).voucherClass, "B");
  await assert.rejects(lookupBillingReceiver(cuit, { env, lookup: async () => ({ ...taxpayer, errorRegimenGeneral: { message: "Incomplete" } }) }), { code: "arca-receiver-condition-unresolved" });
  await assert.rejects(lookupBillingReceiver(cuit, { env, lookup: async () => ({ ...taxpayer, keyType: "CUIT" }) }), { code: "arca-receiver-condition-unresolved" });
});
test("una inscripción explícita IVA exento selecciona factura B", async () => {
  const result = await lookupBillingReceiver(cuit, { env, lookup: async () => ({ found: true, keyStatus: "ACTIVO", taxes: [{ description: "IVA EXENTO", status: "ACTIVO" }] }) });
  assert.equal(result.receiver.vatConditionId, 4);
  assert.equal(buildAuthorizationPlan({ invoice, issuerVatCondition: "responsable_inscripto", receiverVatConditionId: 4, ...result.receiver }).voucherClass, "B");
});
test("el permiso de facturas respeta denegaciones y roles", () => {
  assert.equal(can({ active: true, role: "seller" }, "quick-sales", "requestTicket"), true);
  assert.equal(can({ active: true, role: "seller", permissionDeny: { "quick-sales": ["requestTicket"] } }, "quick-sales", "requestTicket"), false);
  assert.equal(can({ active: true, role: "warehouse_manager" }, "quick-sales", "requestTicket"), false);
});
