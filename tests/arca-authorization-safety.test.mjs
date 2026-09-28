import test from "node:test";
import assert from "node:assert/strict";

import {
  ARCA_VOUCHER_TYPES,
  buildAuthorizationPlan,
  resolveVoucherType,
} from "../netlify/functions/_lib/arca/authorizationPlan.mjs";
import {
  acquireSequenceLock,
  releaseSequenceLock,
} from "../netlify/functions/_lib/arca/sequenceLock.mjs";

function memoryStore(seed = {}) {
  const documents = new Map(Object.entries(seed).map(([path, data]) => [
    path,
    { path, data: structuredClone(data), updateTime: "2026-09-28T15:00:00.000Z" },
  ]));

  return {
    documents,
    async getDocument(path) {
      return documents.get(path) || null;
    },
    async createDocument(collectionPath, documentId, data) {
      const path = `${collectionPath}/${documentId}`;
      if (documents.has(path)) {
        const error = new Error("exists");
        error.code = "firebase-admin-already-exists";
        error.status = 409;
        throw error;
      }
      const document = {
        path,
        data: structuredClone(data),
        updateTime: "2026-09-28T15:00:01.000Z",
      };
      documents.set(path, document);
      return document;
    },
    async patchDocument(path, data, { currentUpdateTime } = {}) {
      const current = documents.get(path);
      if (!current || (currentUpdateTime && current.updateTime !== currentUpdateTime)) {
        const error = new Error("precondition");
        error.code = "firebase-admin-precondition-failed";
        error.status = 412;
        throw error;
      }
      const document = {
        path,
        data: { ...current.data, ...structuredClone(data) },
        updateTime: "2026-09-28T15:00:02.000Z",
      };
      documents.set(path, document);
      return document;
    },
  };
}

const invoice = {
  status: "authorizing",
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

test("emisor RI genera factura A para RI y monotributo", () => {
  assert.equal(resolveVoucherType({
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 1,
  }).voucherType, ARCA_VOUCHER_TYPES.FACTURA_A);

  assert.equal(resolveVoucherType({
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 6,
  }).voucherType, ARCA_VOUCHER_TYPES.FACTURA_A);
});

test("emisor RI genera factura B para consumidor final y exento", () => {
  assert.equal(resolveVoucherType({
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 5,
  }).voucherType, ARCA_VOUCHER_TYPES.FACTURA_B);

  assert.equal(resolveVoucherType({
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 4,
  }).voucherType, ARCA_VOUCHER_TYPES.FACTURA_B);
});

test("plan A exige CUIT y conserva cierre fiscal", () => {
  const plan = buildAuthorizationPlan({
    invoice,
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 1,
    documentType: 80,
    documentNumber: "20164755100",
    voucherDate: new Date("2026-09-28T12:00:00-03:00"),
  });

  assert.equal(plan.voucherType, 1);
  assert.equal(plan.voucherClass, "A");
  assert.equal(plan.detailBase.docType, 80);
  assert.equal(plan.detailBase.docNumber, "20164755100");
  assert.equal(plan.detailBase.net, 1000);
  assert.equal(plan.detailBase.vat, 210);
  assert.equal(plan.detailBase.total, 1210);
  assert.deepEqual(plan.blockers, []);
});

test("consumidor final anónimo queda bloqueado hasta validar umbral vigente", () => {
  const plan = buildAuthorizationPlan({
    invoice,
    issuerVatCondition: "responsable_inscripto",
    receiverVatConditionId: 5,
    anonymousConsumerFinal: true,
    voucherDate: new Date("2026-09-28T12:00:00-03:00"),
  });
  assert.equal(plan.voucherType, 6);
  assert.equal(plan.detailBase.docType, 99);
  assert.equal(plan.detailBase.docNumber, "0");
  assert.deepEqual(plan.blockers, ["anonymous-consumer-final-amount-threshold"]);
});

test("lock de secuencia impide dos autorizaciones simultáneas", async () => {
  const store = memoryStore();
  const first = await acquireSequenceLock({
    pointOfSale: 3,
    voucherType: 6,
    holder: "attempt-1",
    now: new Date("2026-09-28T15:10:00.000Z"),
    getDocument: store.getDocument,
    createDocument: store.createDocument,
    patchDocument: store.patchDocument,
  });
  const second = await acquireSequenceLock({
    pointOfSale: 3,
    voucherType: 6,
    holder: "attempt-2",
    now: new Date("2026-09-28T15:10:10.000Z"),
    getDocument: store.getDocument,
    createDocument: store.createDocument,
    patchDocument: store.patchDocument,
  });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.reason, "busy");

  const released = await releaseSequenceLock({
    pointOfSale: 3,
    voucherType: 6,
    holder: "attempt-1",
    expectedUpdateTime: first.updateTime,
    now: new Date("2026-09-28T15:10:20.000Z"),
    getDocument: store.getDocument,
    patchDocument: store.patchDocument,
  });
  assert.equal(released.released, true);
});

test("lock vencido puede ser tomado por otro intento", async () => {
  const store = memoryStore({
    "arcaSequenceLocks/pos_3_type_6": {
      pointOfSale: 3,
      voucherType: 6,
      holder: "old-attempt",
      leaseExpiresAt: "2026-09-28T14:00:00.000Z",
    },
  });

  const result = await acquireSequenceLock({
    pointOfSale: 3,
    voucherType: 6,
    holder: "new-attempt",
    now: new Date("2026-09-28T15:00:00.000Z"),
    getDocument: store.getDocument,
    createDocument: store.createDocument,
    patchDocument: store.patchDocument,
  });

  assert.equal(result.acquired, true);
  assert.equal(result.holder, "new-attempt");
});
