import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelSaleAndInvoice,
  inspectSaleCancellation,
} from "../netlify/functions/_lib/arca/saleCancellation.mjs";
import { buildAuthorizationPlan } from "../netlify/functions/_lib/arca/authorizationPlan.mjs";
import { buildCaeDetail } from "../netlify/functions/_lib/arca/wsfe.mjs";
import { syncInvoiceToSale } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";

const env = {
  ARCA_ENVIRONMENT: "production",
  ARCA_ISSUER_CUIT: "20123456786",
  ARCA_POINT_OF_SALE: "8",
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
};
const session = {
  uid: "seller",
  profile: {
    id: "seller",
    role: "seller",
    active: true,
    allowedLocationIds: ["loc"],
  },
};
export function cancellationHarness({ billed = true, voucherType = 6 } = {}) {
  const data = new Map(),
    version = new Map();
  let queue = Promise.resolve(),
    requests = 0;
  const originalId = "invoice_production_seller_sale_sale1";
  const detail = {
    concept: 1,
    docType: voucherType === 1 ? 80 : 99,
    docNumber: voucherType === 1 ? "20123456786" : "0",
    voucherDate: "20261009",
    total: 1210,
    net: 1000,
    vat: 210,
    nonTaxed: 0,
    exempt: 0,
    tributes: 0,
    vatBreakdown: [{ id: 5, base: 1000, amount: 210 }],
    receiverVatConditionId: voucherType === 1 ? 1 : 5,
    currencyId: "PES",
    currencyQuote: 1,
  };
  const auth = {
    voucherType,
    voucherClass: voucherType === 1 ? "A" : "B",
    pointOfSale: 8,
    voucherNumber: 12,
    cae: "12345678901234",
    caeExpiration: "20261019",
    receiverVatConditionId: detail.receiverVatConditionId,
    receiverDocument: {
      documentType: detail.docType,
      documentNumber: detail.docNumber,
    },
    requestSnapshot: detail,
    fiscal: {
      total: 1210,
      net: 1000,
      vat: 210,
      nonTaxed: 0,
      exempt: 0,
      tributes: 0,
      vatBreakdown: detail.vatBreakdown,
    },
  };
  const sale = {
    status: "active",
    sourceType: "seller_sale",
    saleCode: "QA-1",
    sellerId: "seller",
    locationId: "loc",
    locationName: "Local QA",
    total: 1210,
    items: [
      {
        productId: "p",
        name: "Producto QA",
        qty: 1,
        unitPrice: 1210,
        subtotal: 1210,
      },
    ],
    ...(billed ? { fiscalInvoiceId: originalId, ticketRequested: true } : {}),
  };
  data.set("sales/sale1", sale);
  data.set("locations/loc", { active: true });
  data.set("locationStock/loc/items/p", { currentStock: 9 });
  if (billed)
    data.set(`invoices/${originalId}`, {
      status: "authorized",
      sourceType: "seller_sale",
      sourceId: "sale1",
      issuerCuit: env.ARCA_ISSUER_CUIT,
      fiscalEnvironment: "production",
      pointOfSaleSnapshot: 8,
      authorization: auth,
      verification: { checkedAt: "2026-10-09T14:00:00Z", matched: true },
      saleSnapshot: { ...sale, subtotal: 1210, discountTotal: 0 },
      receiverSnapshot: {
        vatConditionId: detail.receiverVatConditionId,
        documentType: detail.docType,
        documentNumber: detail.docNumber,
        anonymousConsumerFinal: voucherType === 6,
        concept: 1,
      },
    });
  const getDocument = async (path) =>
    data.has(path)
      ? {
          data: structuredClone(data.get(path)),
          updateTime: String(version.get(path) || 0),
        }
      : null;
  const put = (path, value) => {
    data.set(path, value);
    version.set(path, (version.get(path) || 0) + 1);
  };
  const runTransaction = (work) => {
    const run = queue.then(() =>
      work({
        getDocument,
        commitDocuments: async (operations) => {
          for (const operation of operations) {
            if (operation.type === "create" && data.has(operation.path))
              throw new Error("Duplicate document");
            if (
              operation.currentUpdateTime &&
              operation.currentUpdateTime !==
                String(version.get(operation.path) || 0)
            )
              throw new Error("Version conflict");
          }
          for (const operation of operations)
            put(
              operation.path,
              operation.type === "create"
                ? structuredClone(operation.data)
                : {
                    ...data.get(operation.path),
                    ...structuredClone(operation.data),
                  },
            );
        },
      }),
    );
    queue = run.catch(() => {});
    return run;
  };
  const options = {
    saleId: "sale1",
    reason: "",
    session,
    env,
    now: new Date("2026-10-13T14:00:00Z"),
    getDocument,
    runTransaction,
    authorize: async ({ invoiceId }) => {
      const current = data.get(`invoices/${invoiceId}`);
      if (current.status !== "pending") return { status: current.status };
      requests++;
      const plan = buildAuthorizationPlan({
        invoice: current,
        voucherDate: new Date("2026-10-13T14:00:00Z"),
      });
      put(`invoices/${invoiceId}`, {
        ...current,
        status: "authorized",
        authorization: {
          ...auth,
          voucherType: plan.voucherType,
          voucherNumber: 20,
          requestSnapshot: plan.detailBase,
        },
      });
      return { status: "authorized" };
    },
    verify: async ({ invoiceId }) => {
      const current = data.get(`invoices/${invoiceId}`);
      put(`invoices/${invoiceId}`, {
        ...current,
        verification: { matched: true, checkedAt: "2026-10-13T14:00:00Z" },
      });
      return { matched: true, verified: true };
    },
    reconcile: async () => ({ status: "reconciling" }),
  };
  return {
    data,
    options,
    put,
    getDocument,
    runTransaction,
    originalId,
    requests: () => requests,
    cancel: (overrides) => cancelSaleAndInvoice({ ...options, ...overrides }),
  };
}

test("Vista previa de anulación calcula NC sin escrituras ni emisión", async () => {
  const h = cancellationHarness();
  const before = structuredClone([...h.data]);
  const result = await inspectSaleCancellation(h.options);
  assert.equal(result.readOnly, true);
  assert.equal(result.creditNote.voucherType, 8);
  assert.equal(result.creditNote.total, 1210);
  assert.deepEqual([...h.data], before);
  assert.equal(h.requests(), 0);
});

test("Anulación sin factura admite motivo vacío y restituye stock una sola vez", async () => {
  const h = cancellationHarness({ billed: false });
  await h.cancel();
  const again = await h.cancel();
  assert.equal(again.alreadyCancelled, true);
  assert.equal(h.data.get("locationStock/loc/items/p").currentStock, 10);
  assert.equal(h.data.get("sales/sale1").status, "cancelled");
  assert.equal(h.requests(), 0);
  assert.equal(
    [...h.data.keys()].filter((path) => path.startsWith("auditLogs/")).length,
    1,
  );
});
for (const [type, creditType] of [
  [1, 3],
  [6, 8],
])
  test(`Factura ${type}: NC ${creditType} conserva importes y asociación; reintento no duplica`, async () => {
    const h = cancellationHarness({ voucherType: type });
    const result = await h.cancel();
    await h.cancel();
    const credit = h.data.get(`invoices/${result.creditNoteId}`),
      original = h.data.get(`invoices/${h.originalId}`);
    assert.equal(credit.authorization.voucherType, creditType);
    assert.equal(h.requests(), 1);
    assert.deepEqual(
      credit.authorization.fiscal,
      original.authorization.fiscal,
    );
    assert.equal(original.status, "authorized");
    assert.equal(original.creditNoteId, result.creditNoteId);
    assert.equal(h.data.get("sales/sale1").fiscalInvoiceId, h.originalId);
    assert.equal(h.data.get("locationStock/loc/items/p").currentStock, 10);
    const xml = buildCaeDetail({
      ...credit.authorization.requestSnapshot,
      voucherFrom: 20,
    });
    assert.match(
      xml,
      /<ar:CbtesAsoc>.*<ar:Tipo>\d<\/ar:Tipo>.*<ar:Nro>12<\/ar:Nro>/,
    );
    assert.ok(xml.indexOf("<ar:CbtesAsoc>") < xml.indexOf("<ar:Iva>"));
  });
test("Resultado incierto de NC conserva venta y stock; consulta posterior no reenvía CAE", async () => {
  const h = cancellationHarness();
  let emitted = 0,
    consults = 0;
  const authorize = async ({ invoiceId }) => {
    const current = h.data.get(`invoices/${invoiceId}`);
    if (current.status === "pending") {
      emitted++;
      h.put(`invoices/${invoiceId}`, {
        ...current,
        status: "reconciling",
        authorization: { voucherNumber: 20 },
      });
    }
    return { status: "reconciling" };
  };
  const reconcile = async () => {
    consults++;
    return { status: "reconciling" };
  };
  await assert.rejects(h.cancel({ authorize, reconcile }), {
    code: "arca-credit-not-authorized",
  });
  await assert.rejects(h.cancel({ authorize, reconcile }), {
    code: "arca-credit-not-authorized",
  });
  assert.equal(emitted, 1);
  assert.equal(consults, 1);
  assert.equal(h.data.get("sales/sale1").status, "active");
  assert.equal(h.data.get("locationStock/loc/items/p").currentStock, 9);
});
test("Verificación fallida no anula venta; completar después usa la misma NC", async () => {
  const h = cancellationHarness();
  await assert.rejects(h.cancel({ verify: async () => ({ matched: false }) }), {
    code: "arca-credit-not-verified",
  });
  assert.equal(h.data.get("sales/sale1").status, "active");
  assert.equal(h.data.get("locationStock/loc/items/p").currentStock, 9);
  await h.cancel();
  assert.equal(h.requests(), 1);
  assert.equal(h.data.get("locationStock/loc/items/p").currentStock, 10);
});
test("Venta ajena, vínculo incorrecto y stock faltante se rechazan antes de emitir", async () => {
  const h = cancellationHarness();
  await assert.rejects(h.cancel({ session: { ...session, uid: "other" } }), {
    status: 403,
  });
  h.data.get(`invoices/${h.originalId}`).sourceId = "another";
  await assert.rejects(h.cancel(), /vínculo fiscal/);
  h.data.get(`invoices/${h.originalId}`).sourceId = "sale1";
  h.data.delete("locationStock/loc/items/p");
  await assert.rejects(h.cancel(), /Falta el stock/);
  assert.equal(h.requests(), 0);
  assert.equal(h.data.get("sales/sale1").fiscalCancellation, undefined);
});
test("Solicitud sin CAE se cancela; solicitud incierta bloquea la anulación", async () => {
  const h = cancellationHarness();
  const original = h.data.get(`invoices/${h.originalId}`);
  h.put(`invoices/${h.originalId}`, { ...original, status: "reconciling" });
  await assert.rejects(h.cancel(), {
    code: "arca-cancellation-needs-reconciliation",
  });
  h.put(`invoices/${h.originalId}`, {
    ...original,
    status: "pending",
    authorization: {},
  });
  await h.cancel();
  assert.equal(h.data.get(`invoices/${h.originalId}`).status, "cancelled");
  assert.equal(h.requests(), 0);
});
test('Una nota de crédito previa diferente impide duplicar la reversión',async()=>{
  const h=cancellationHarness();h.data.get(`invoices/${h.originalId}`).creditNoteId='another-credit';
  await assert.rejects(h.cancel(),{code:'arca-credit-already-associated'});assert.equal(h.requests(),0);
});

test("Leer una NC no reemplaza el vínculo de la factura original", async () => {
  const h = cancellationHarness();
  const result = await h.cancel();
  let patches = 0;
  await syncInvoiceToSale({
    invoiceId: result.creditNoteId,
    env,
    getDocument: h.getDocument,
    patchDocument: async () => {
      patches++;
    },
  });
  assert.equal(patches, 0);
  assert.equal(h.data.get("sales/sale1").fiscalInvoiceId, h.originalId);
});
