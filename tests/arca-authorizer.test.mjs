import test from "node:test";
import assert from "node:assert/strict";

import { authorizeInvoice, recoverPreCaeInvoice, verifyAuthorizedInvoice } from "../netlify/functions/_lib/arca/authorizer.mjs";

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


test("502 al consultar último autorizado vuelve a pending sin reservar número ni pedir CAE", async () => {
  let caeRequests = 0;
  let returnedPending = 0;
  const result = await authorizeInvoice({
    invoiceId: "invoice-preflight-502",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 5,
      documentType: 99,
      documentNumber: "0",
      anonymousConsumerFinal: true,
      requestedBy: "admin-1",
    },
    allowCaeRequest: true,
    env: {
      ARCA_ENVIRONMENT: "homologation",
      ARCA_ISSUER_CUIT: "20123456786",
      ARCA_POINT_OF_SALE: "3",
      ARCA_CERTIFICATE_PEM: "cert",
      ARCA_PRIVATE_KEY_PEM: "key",
      ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000",
    },
    getDocument: async () => ({
      data: pendingInvoice,
      updateTime: "u0",
    }),
    claimInvoiceFn: async () => ({
      claimed: true,
      attemptId: "attempt-preflight",
      updateTime: "u1",
      invoice: { ...pendingInvoice, status: "authorizing" },
    }),
    acquireLockFn: async () => ({
      acquired: true,
      updateTime: "lock-1",
    }),
    releaseLockFn: async () => ({ released: true }),
    getLastAuthorizedFn: async () => {
      const error = new Error("No se pudo conectar con el servidor de ARCA.");
      error.code = "arca-network-error";
      error.status = 502;
      throw error;
    },
    returnPendingFn: async (input) => {
      returnedPending += 1;
      assert.equal(input.expectedUpdateTime, "u1");
      return {
        data: {
          ...pendingInvoice,
          status: "pending",
          error: {
            code: input.errorCode,
            message: input.errorMessage,
            retryable: true,
          },
        },
      };
    },
    requestCaeFn: async () => {
      caeRequests += 1;
      throw new Error("no debe ejecutarse");
    },
  });

  assert.equal(result.status, "pending");
  assert.equal(result.retryable, true);
  assert.equal(result.phase, "last-authorized");
  assert.equal(returnedPending, 1);
  assert.equal(caeRequests, 0);
});

test("recupera authorizing pre-CAE sólo si no hay número planificado", async () => {
  let resetCalls = 0;
  const recovered = await recoverPreCaeInvoice({
    invoiceId: "invoice-stuck",
    getDocument: async () => ({
      data: {
        ...pendingInvoice,
        status: "authorizing",
        authorization: {
          attemptId: "attempt-stuck",
          voucherNumber: null,
          cae: null,
          plannedAt: null,
        },
      },
      updateTime: "u-stuck",
    }),
    returnPendingFn: async (input) => {
      resetCalls += 1;
      assert.equal(input.expectedUpdateTime, "u-stuck");
      return { data: { ...pendingInvoice, status: "pending" } };
    },
  });

  assert.equal(recovered.recovered, true);
  assert.equal(recovered.status, "pending");
  assert.equal(resetCalls, 1);

  const blocked = await recoverPreCaeInvoice({
    invoiceId: "invoice-planned",
    getDocument: async () => ({
      data: {
        ...pendingInvoice,
        status: "authorizing",
        authorization: {
          attemptId: "attempt-planned",
          voucherNumber: 12,
          cae: null,
          plannedAt: "2026-09-28T20:00:00.000Z",
        },
      },
      updateTime: "u-planned",
    }),
    returnPendingFn: async () => {
      throw new Error("no debe resetear un plan con número");
    },
  });

  assert.equal(blocked.recovered, false);
  assert.equal(blocked.reason, "pre-cae-recovery-not-safe");
});


test("FECompConsultar confirma un comprobante autorizado y coincidente", async () => {
  let persisted = null;
  const authorizedInvoice = {
    ...pendingInvoice,
    status: "authorized",
    authorization: {
      pointOfSale: 3,
      voucherType: 6,
      voucherNumber: 2,
      cae: "12345678901234",
      caeExpiration: "20261008",
      result: "A",
    },
  };

  const result = await verifyAuthorizedInvoice({
    invoiceId: "invoice-authorized-2",
    getDocument: async () => ({
      data: authorizedInvoice,
      updateTime: "u-authorized",
    }),
    consultVoucherFn: async ({ pointOfSale, voucherType, voucherNumber }) => {
      assert.equal(pointOfSale, 3);
      assert.equal(voucherType, 6);
      assert.equal(voucherNumber, 2);
      return {
        result: "A",
        cae: "12345678901234",
        caeExpiration: "20261008",
        voucherNumber: 2,
        errors: [],
        events: [],
      };
    },
    markVerifiedFn: async (input) => {
      persisted = input;
      return {
        data: {
          ...authorizedInvoice,
          verification: {
            checkedAt: "2026-09-28T22:00:00.000Z",
            matched: input.matched,
          },
        },
      };
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.matched, true);
  assert.equal(persisted.expectedUpdateTime, "u-authorized");
  assert.equal(persisted.voucherNumber, 2);
});

test("FECompConsultar detecta CAE distinto sin desautorizar el registro local", async () => {
  let persistedMatch = null;
  const authorizedInvoice = {
    ...pendingInvoice,
    status: "authorized",
    authorization: {
      pointOfSale: 3,
      voucherType: 6,
      voucherNumber: 2,
      cae: "12345678901234",
      caeExpiration: "20261008",
      result: "A",
    },
  };

  const result = await verifyAuthorizedInvoice({
    invoiceId: "invoice-authorized-mismatch",
    getDocument: async () => ({
      data: authorizedInvoice,
      updateTime: "u-authorized",
    }),
    consultVoucherFn: async () => ({
      result: "A",
      cae: "99999999999999",
      caeExpiration: "20261008",
      voucherNumber: 2,
      errors: [],
      events: [],
    }),
    markVerifiedFn: async (input) => {
      persistedMatch = input.matched;
      return {
        data: {
          ...authorizedInvoice,
          verification: {
            matched: input.matched,
          },
        },
      };
    },
  });

  assert.equal(result.verified, true);
  assert.equal(result.matched, false);
  assert.equal(result.status, "authorized");
  assert.equal(persistedMatch, false);
});


test("producción nunca solicita CAE aunque el gate read-only esté habilitado", async () => {
  let caeRequests = 0;

  await assert.rejects(
    authorizeInvoice({
      invoiceId: "invoice-production-block",
      issuerVatCondition: "responsable_inscripto",
      receiver: {
        vatConditionId: 5,
        documentType: 99,
        documentNumber: "0",
        anonymousConsumerFinal: true,
        requestedBy: "admin-1",
      },
      allowCaeRequest: true,
      env: {
        ARCA_ENVIRONMENT: "production",
        ARCA_ALLOW_PRODUCTION_READONLY: "true",
        ARCA_ISSUER_CUIT: "20123456786",
        ARCA_POINT_OF_SALE: "8",
        ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000",
      },
      getDocument: async () => ({
        data: { ...pendingInvoice, fiscalEnvironment: "production" },
        updateTime: "u0",
      }),
      requestCaeFn: async () => {
        caeRequests += 1;
        throw new Error("no debe ejecutarse");
      },
    }),
    (error) => error?.code === "arca-production-authorization-blocked",
  );

  assert.equal(caeRequests, 0);
});


test("factura de homologación no puede operarse desde runtime productivo", async () => {
  await assert.rejects(
    authorizeInvoice({
      invoiceId: "invoice-env-mismatch",
      issuerVatCondition: "responsable_inscripto",
      receiver: {
        vatConditionId: 5,
        documentType: 99,
        documentNumber: "0",
        anonymousConsumerFinal: true,
      },
      allowCaeRequest: false,
      env: {
        ARCA_ENVIRONMENT: "production",
        ARCA_POINT_OF_SALE: "8",
      },
      getDocument: async () => ({
        data: { ...pendingInvoice, fiscalEnvironment: "homologation" },
        updateTime: "u0",
      }),
    }),
    (error) => error?.code === "arca-invoice-environment-mismatch",
  );
});


test("dry-run productivo arma el plan sin llamar a ARCA", async () => {
  let caeRequests = 0;
  let sequenceReads = 0;

  const result = await authorizeInvoice({
    invoiceId: "invoice-production-dry-run",
    issuerVatCondition: "responsable_inscripto",
    receiver: {
      vatConditionId: 5,
      documentType: 99,
      documentNumber: "0",
      anonymousConsumerFinal: true,
      requestedBy: "admin-1",
    },
    allowCaeRequest: false,
    env: {
      ARCA_ENVIRONMENT: "production",
      ARCA_ISSUER_CUIT: "20123456786",
      ARCA_POINT_OF_SALE: "8",
      ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000",
    },
    getDocument: async () => ({
      data: { ...pendingInvoice, fiscalEnvironment: "production" },
      updateTime: "u0",
    }),
    getLastAuthorizedFn: async () => {
      sequenceReads += 1;
      throw new Error("no debe consultar ARCA en dry-run");
    },
    requestCaeFn: async () => {
      caeRequests += 1;
      throw new Error("no debe pedir CAE en dry-run");
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.status, "pending");
  assert.equal(result.plan.voucherClass, "B");
  assert.equal(result.plan.detailBase.docType, 99);
  assert.equal(result.plan.detailBase.docNumber, "0");
  assert.equal(result.plan.fiscal.total, 1210);
  assert.equal(sequenceReads, 0);
  assert.equal(caeRequests, 0);
});
