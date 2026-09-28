import test from "node:test";
import assert from "node:assert/strict";

import { authorizeInvoice } from "../netlify/functions/_lib/arca/authorizer.mjs";

const pendingInvoice = {
  status: "pending",
  fiscalReadiness: { ready: true },
  saleSnapshot: {
    total: 1210,
    subtotal: 1210,
    discountTotal: 0,
    items: [{
      productId: "product-1",
      name: "Producto",
      qty: 1,
      unitPrice: 1210,
      subtotal: 1210,
    }],
  },
  productFiscalSnapshot: [{
    productId: "product-1",
    arcaVatRate: 21,
  }],
};

test("dry run prepara factura A sin llamar a ARCA", async () => {
  let requested = false;
  const result = await authorizeInvoice({
    invoiceId: "invoice-1",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 1,
      documentType: 80,
      documentNumber: "20164755100",
    },
    allowCaeRequest: false,
    getDocument: async () => ({
      data: pendingInvoice,
      updateTime: "2026-09-28T15:00:00.000Z",
    }),
    requestCaeFn: async () => {
      requested = true;
      throw new Error("no debería ejecutarse");
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.plan.voucherClass, "A");
  assert.equal(result.plan.detailBase.total, 1210);
  assert.equal(requested, false);
});

test("autorización exitosa serializa secuencia y persiste CAE", async () => {
  const calls = [];
  const result = await authorizeInvoice({
    invoiceId: "invoice-2",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 1,
      documentType: 80,
      documentNumber: "20164755100",
      requestedBy: "admin-1",
    },
    allowCaeRequest: true,
    env: {
      ARCA_ENVIRONMENT: "homologation",
      ARCA_ISSUER_CUIT: "20123456786",
      ARCA_POINT_OF_SALE: "3",
      ARCA_CERTIFICATE_PEM: "cert",
      ARCA_PRIVATE_KEY_PEM: "key",
    },
    getDocument: async () => ({
      data: pendingInvoice,
      updateTime: "u0",
    }),
    claimInvoiceFn: async () => ({
      claimed: true,
      attemptId: "attempt-1",
      updateTime: "u1",
      invoice: { ...pendingInvoice, status: "authorizing" },
    }),
    acquireLockFn: async () => ({
      acquired: true,
      updateTime: "lock-1",
    }),
    releaseLockFn: async () => {
      calls.push("release");
      return { released: true };
    },
    getLastAuthorizedFn: async () => ({
      number: 7,
      errors: [],
      events: [],
    }),
    persistPlanFn: async (input) => {
      calls.push(["plan", input.voucherNumber]);
      return {
        updateTime: "u2",
        data: {
          ...pendingInvoice,
          status: "authorizing",
          authorization: {
            pointOfSale: 3,
            voucherType: 1,
            voucherNumber: input.voucherNumber,
          },
        },
      };
    },
    requestCaeFn: async ({ details }) => {
      calls.push(["cae", details[0].voucherFrom]);
      return {
        result: "A",
        cae: "12345678901234",
        caeExpiration: "20261008",
        observations: [],
        errors: [],
      };
    },
    markAuthorizedFn: async (input) => {
      calls.push(["authorized", input.cae]);
      return {
        data: {
          status: "authorized",
          authorization: {
            ...input.baseAuthorization,
            cae: input.cae,
          },
        },
      };
    },
  });

  assert.equal(result.status, "authorized");
  assert.deepEqual(calls[0], ["plan", 8]);
  assert.deepEqual(calls[1], ["cae", 8]);
  assert.deepEqual(calls[2], ["authorized", "12345678901234"]);
  assert.equal(calls.at(-1), "release");
});

test("timeout no reenvía CAE y entra en reconciliación", async () => {
  let caeRequests = 0;
  let consults = 0;

  const result = await authorizeInvoice({
    invoiceId: "invoice-3",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 5,
      documentType: 96,
      documentNumber: "30123456",
    },
    allowCaeRequest: true,
    env: {
      ARCA_ENVIRONMENT: "homologation",
      ARCA_ISSUER_CUIT: "20123456786",
      ARCA_POINT_OF_SALE: "3",
      ARCA_CERTIFICATE_PEM: "cert",
      ARCA_PRIVATE_KEY_PEM: "key",
    },
    getDocument: async () => ({
      data: pendingInvoice,
      updateTime: "u0",
    }),
    claimInvoiceFn: async () => ({
      claimed: true,
      attemptId: "attempt-timeout",
      updateTime: "u1",
      invoice: { ...pendingInvoice, status: "authorizing" },
    }),
    acquireLockFn: async () => ({ acquired: true, updateTime: "lock-1" }),
    releaseLockFn: async () => ({ released: true }),
    getLastAuthorizedFn: async () => ({ number: 12, errors: [], events: [] }),
    persistPlanFn: async (input) => ({
      updateTime: "u2",
      data: {
        ...pendingInvoice,
        status: "authorizing",
        authorization: {
          pointOfSale: 3,
          voucherType: 6,
          voucherNumber: input.voucherNumber,
        },
      },
    }),
    requestCaeFn: async () => {
      caeRequests += 1;
      const error = new Error("timeout");
      error.code = "arca-timeout";
      throw error;
    },
    consultVoucherFn: async () => {
      consults += 1;
      return { cae: null, errors: [{ code: 1, message: "no encontrado" }] };
    },
    markReconcilingFn: async () => ({
      data: { status: "reconciling" },
    }),
  });

  assert.equal(caeRequests, 1);
  assert.equal(consults, 1);
  assert.equal(result.status, "reconciling");
  assert.equal(result.uncertain, true);
  assert.equal(result.reconciled, false);
});

test("timeout reconciliado con CAE se marca autorizado sin reenvío", async () => {
  let caeRequests = 0;
  let consults = 0;

  const result = await authorizeInvoice({
    invoiceId: "invoice-4",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 5,
      documentType: 96,
      documentNumber: "30123456",
    },
    allowCaeRequest: true,
    env: {
      ARCA_ENVIRONMENT: "homologation",
      ARCA_ISSUER_CUIT: "20123456786",
      ARCA_POINT_OF_SALE: "3",
      ARCA_CERTIFICATE_PEM: "cert",
      ARCA_PRIVATE_KEY_PEM: "key",
    },
    getDocument: async () => ({
      data: pendingInvoice,
      updateTime: "u0",
    }),
    claimInvoiceFn: async () => ({
      claimed: true,
      attemptId: "attempt-timeout",
      updateTime: "u1",
      invoice: { ...pendingInvoice, status: "authorizing" },
    }),
    acquireLockFn: async () => ({ acquired: true, updateTime: "lock-1" }),
    releaseLockFn: async () => ({ released: true }),
    getLastAuthorizedFn: async () => ({ number: 20, errors: [], events: [] }),
    persistPlanFn: async (input) => ({
      updateTime: "u2",
      data: {
        ...pendingInvoice,
        status: "authorizing",
        authorization: {
          pointOfSale: 3,
          voucherType: 6,
          voucherNumber: input.voucherNumber,
        },
      },
    }),
    requestCaeFn: async () => {
      caeRequests += 1;
      const error = new Error("network");
      error.code = "arca-network-error";
      throw error;
    },
    consultVoucherFn: async () => {
      consults += 1;
      return {
        result: "A",
        cae: "99887766554433",
        caeExpiration: "20261008",
      };
    },
    markAuthorizedFn: async (input) => ({
      data: {
        status: "authorized",
        authorization: { ...input.baseAuthorization, cae: input.cae },
      },
    }),
  });

  assert.equal(caeRequests, 1);
  assert.equal(consults, 1);
  assert.equal(result.status, "authorized");
  assert.equal(result.reconciled, true);
});
