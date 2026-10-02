import test from "node:test";
import assert from "node:assert/strict";
import { authorizeInvoice, reconcileInvoice, recoverPreCaeInvoice, voucherMatchesAuthorization, verifyAuthorizedInvoice } from "../netlify/functions/_lib/arca/authorizer.mjs";
import * as persistence from "../netlify/functions/_lib/arca/invoicePersistence.mjs";
import { acquireSequenceLock, releaseSequenceLock } from "../netlify/functions/_lib/arca/sequenceLock.mjs";
import { parseConsultedVoucher } from "../netlify/functions/_lib/arca/wsfe.mjs";
import { fiscalRecovery, fiscalPresentation, classifyFiscalFailure, safeFiscalError } from "../src/shared/fiscalRecovery.mjs";
import { reviewFiscalInvoice } from "../netlify/functions/_lib/arca/recoveryService.mjs";

// Versioned CAS adapter executes the real persistence/state machine. No fiscal
// transport is used: CAE values in these isolated tests are explicitly mocks.
export function fiscalMemory(seed = {}) {
  let version = 0;
  const documents = new Map();
  const copy = (value) => value == null ? null : structuredClone(value);
  const conflict = () => Object.assign(new Error("CAS conflict"), { code: "firebase-admin-precondition-failed" });
  const write = (path, data) => documents.set(path, { data: copy(data), updateTime: `u${++version}` });
  Object.entries(seed).forEach(([path, data]) => write(path, data));
  const getDocument = async (path) => copy(documents.get(path));
  const patchDocument = async (path, data, { currentUpdateTime } = {}) => {
    const current = documents.get(path);
    if (!current || (currentUpdateTime && current.updateTime !== currentUpdateTime)) throw conflict();
    write(path, { ...current.data, ...data }); return getDocument(path);
  };
  const createDocument = async (collection, id, data) => {
    const path = `${collection}/${id}`;
    if (documents.has(path)) throw Object.assign(new Error("exists"), { code: "firebase-admin-already-exists" });
    write(path, data); return getDocument(path);
  };
  const runTransaction = async (work) => {
    const readSet = new Map();
    return work({ getDocument: async (path) => { const snapshot = await getDocument(path); readSet.set(path, snapshot?.updateTime); return snapshot; },
      commitDocuments: async (operations) => {
        for (const [path, stamp] of readSet) if (documents.get(path)?.updateTime !== stamp) throw conflict();
        for (const op of operations) {
          if (op.type === "create" && documents.has(op.path)) throw conflict();
          if (op.currentUpdateTime && documents.get(op.path)?.updateTime !== op.currentUpdateTime) throw conflict();
        }
        operations.forEach((op) => write(op.path, { ...(documents.get(op.path)?.data || {}), ...op.data }));
      },
    });
  };
  return { documents, getDocument, patchDocument, createDocument, runTransaction };
}

const env = { ARCA_ENVIRONMENT: "homologation", ARCA_ALLOW_CAE_HOMOLOGATION: "true", ARCA_ISSUER_CUIT: "20123456786", ARCA_POINT_OF_SALE: "3", ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto", ARCA_CONSUMER_FINAL_ID_THRESHOLD: "10000000" };
const receiver = { vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: true, concept: 1 };
function harness(sourceType = "admin_quick_sale") {
  const sale = { status: "active", sourceType, sellerId: "seller", ticketRequested: true, invoiceStatus: "pending", items: [{ productId: "p1", name: "Producto", qty: 1, unitPrice: 1210, subtotal: 1210, arcaVatRate: 21 }], total: 1210, subtotal: 1210, totalItems: 1, paymentMethod: "cash", paymentStatus: "simulated_approved", paymentProvider: "simulation" };
  const store = fiscalMemory({ "sales/s1": sale, "products/p1": { active: true, arcaVatRate: 21 } });
  const wrapped = (fn) => (input) => fn({ ...input, ...store });
  const deps = { env, issuerVatCondition: env.ARCA_ISSUER_VAT_CONDITION, receiver,
    getDocument: store.getDocument, claimInvoiceFn: wrapped(persistence.claimPendingInvoice), acquireLockFn: wrapped(acquireSequenceLock), releaseLockFn: wrapped(releaseSequenceLock),
    persistPlanFn: wrapped(persistence.persistAuthorizationPlan), markAuthorizedFn: wrapped(persistence.markInvoiceAuthorized), markRejectedFn: wrapped(persistence.markInvoiceRejected),
    markReconcilingFn: wrapped(persistence.markInvoiceReconciling), markErrorFn: wrapped(persistence.markInvoiceError), returnPendingFn: wrapped(persistence.returnInvoiceToPending),
    getLastAuthorizedFn: async () => ({ number: 7, errors: [] }), requestCaeFn: async () => ({ result: "A", cae: "12345678901234", caeExpiration: "20261231", errors: [] }),
    consultVoucherFn: async () => ({ result: null, errors: [{ code: 602 }] }),
  };
  const prepare = async () => persistence.ensurePendingInvoice({ sourceType, sourceId: "s1", receiver, env, ...store });
  const authorize = async (extra = {}) => { const prepared = await prepare(); return authorizeInvoice({ ...deps, invoiceId: prepared.invoiceId, allowCaeRequest: true, ...extra }); };
  return { store, deps, prepare, authorize };
}
function matchingConsult(authorization) {
  const d = authorization.requestSnapshot;
  return { ...d, result: "A", cae: "12345678901234", caeExpiration: "20261231", pointOfSale: authorization.pointOfSale, voucherType: authorization.voucherType, voucherNumber: authorization.voucherNumber, voucherTo: authorization.voucherNumber, errors: [], events: [] };
}
test("rejected no reconcilia un número que otra invoice puede reutilizar", async () => {
  const h = harness();
  await h.authorize({ requestCaeFn: async () => ({ result: "R", errors: [{ code: 100 }], observations: [] }) });
  const prepared = await h.prepare();
  let consulted = 0;
  const result = await reconcileInvoice({ ...h.deps, invoiceId: prepared.invoiceId,
    consultVoucherFn: async () => { consulted++; return matchingConsult(prepared.invoice.authorization); } });
  assert.equal(result.status, "rejected"); assert.equal(result.blocked, true); assert.equal(consulted, 0);
  assert.equal((await h.prepare()).invoice.authorization.cae, null);
});
const temporary = () => Object.assign(new Error("RAW SECRET must never reach UI"), { code: "arca-timeout", status: 504 });

for (const source of ["admin_quick_sale", "seller_sale", "ecommerce"]) {
  test(`${source}: misma invoice, mismo motor, autorizado terminal y mirror`, async () => {
    const h = harness(source); let requests = 0;
    const result = await h.authorize({ requestCaeFn: async () => { requests++; return { result: "A", cae: "12345678901234", caeExpiration: "20261231", errors: [] }; } });
    assert.equal(result.status, "authorized");
    const prepared = await h.prepare();
    const replay = await h.authorize({ requestCaeFn: async () => { throw new Error("duplicated CAE"); } });
    assert.equal(replay.alreadyAuthorized, true); assert.equal(requests, 1);
    await persistence.syncInvoiceToSale({ invoiceId: prepared.invoiceId, env, ...h.store });
    const sale = (await h.store.getDocument("sales/s1")).data;
    assert.equal(sale.fiscalInvoiceId, prepared.invoiceId); assert.equal(sale.fiscalInvoice.status, "authorized");
    const afterSync = await h.prepare();
    assert.equal(afterSync.created, false); assert.equal(afterSync.invoice.status, "authorized");
    assert.equal([...h.store.documents.keys()].filter((key) => key.startsWith("sales/")).length, 1);
    assert.equal([...h.store.documents.keys()].filter((key) => key.startsWith("invoices/")).length, 1);
  });
}
test("timeout antes de envío: TEMPORARY, backoff y límite de tres intentos", async () => {
  const h = harness(); let requests = 0;
  let now = new Date();
  for (let count = 1; count <= 3; count++) {
    const result = await h.authorize({ now, getLastAuthorizedFn: async () => { throw temporary(); }, requestCaeFn: async () => { requests++; } });
    assert.equal(result.status, "pending");
    const invoice = (await h.prepare()).invoice;
    assert.equal(invoice.recovery.classification, "TEMPORARY"); assert.equal(invoice.recovery.attemptCount, count);
    assert.equal(invoice.recovery.retryable, count < 3);
    const blocked = await h.authorize({ now }); assert.equal(blocked.blocked, true);
    now = new Date(now.getTime() + 360000);
  }
  assert.equal(requests, 0); assert.equal((await h.prepare()).invoice.authorization.voucherNumber, null);
});
test("timeout después de envío: durable reservation aun al vencer lease", async () => {
  const h = harness(); let sent = 0;
  const result = await h.authorize({ requestCaeFn: async () => { sent++; throw temporary(); } });
  assert.equal(result.status, "reconciling");
  const lock = await acquireSequenceLock({ pointOfSale: 3, voucherType: 6, holder: "worker2", env, now: new Date(Date.now() + 600000), ...h.store });
  assert.equal(lock.acquired, false); assert.equal(lock.reason, "unresolved-voucher");
  const replay = await h.authorize({ requestCaeFn: async () => { sent++; } });
  assert.equal(replay.needsReconciliation, true); assert.equal(sent, 1);
});
test("FECompConsultar coincide: reconcilia, libera reserva, no reenvía", async () => {
  const h = harness(); await h.authorize({ requestCaeFn: async () => { throw temporary(); } });
  const p = await h.prepare();
  const result = await reconcileInvoice({ ...h.deps, invoiceId: p.invoiceId, consultVoucherFn: async () => matchingConsult(p.invoice.authorization) });
  assert.equal(result.status, "authorized");
  const lock = (await h.store.getDocument("arcaSequenceLocks/homologation_pos_3_type_6")).data;
  assert.equal(lock.reservation, null); assert.equal(lock.holder, null);
});
for (const field of ["total", "net", "vat", "docNumber", "docType", "voucherDate", "pointOfSale", "voucherType", "voucherNumber", "voucherTo", "currencyId", "currencyQuote"]) {
  test(`FECompConsultar difiere en ${field}: no asocia CAE`, async () => {
    const h = harness(); await h.authorize({ requestCaeFn: async () => { throw temporary(); } }); const p = await h.prepare();
    const c = matchingConsult(p.invoice.authorization); c[field] = typeof c[field] === "number" ? c[field] + 1 : "different";
    assert.equal(voucherMatchesAuthorization(c, p.invoice.authorization), false);
    const result = await reconcileInvoice({ ...h.deps, invoiceId: p.invoiceId, consultVoucherFn: async () => c });
    assert.equal(result.status, "reconciling"); assert.equal((await h.prepare()).invoice.authorization.cae, null);
  });
}
test("respuesta vacía y error SOAP después de envío siempre consultan", async () => {
  for (const response of [null, {}, { result: "A", cae: null }]) {
    const h = harness(); let consults = 0;
    const result = await h.authorize({ requestCaeFn: async () => response, consultVoucherFn: async () => { consults++; return {}; } });
    assert.equal(result.status, "reconciling"); assert.equal(consults, 1);
  }
  const h = harness(); let consults = 0;
  const result = await h.authorize({ requestCaeFn: async () => { throw Object.assign(new Error("raw SOAP"), { code: "soap:Server", status: 500 }); }, consultVoucherFn: async () => { consults++; return {}; } });
  assert.equal(result.status, "reconciling"); assert.equal(consults, 1);
});
test("rechazo explícito terminal: libera lock, no vuelve a enviar", async () => {
  const h = harness(); const r = await h.authorize({ requestCaeFn: async () => ({ result: "R", errors: [{ code: 100, message: "raw secret" }] }) });
  assert.equal(r.status, "rejected"); assert.equal(r.invoice.recovery.classification, "REJECTED");
  assert.equal(r.invoice.error.details[0].message.includes("raw secret"), false);
  const replay = await h.authorize(); assert.equal(replay.blocked, true);
  assert.equal((await h.store.getDocument("arcaSequenceLocks/homologation_pos_3_type_6")).data.reservation, null);
});
test("validación: sin claim, reserva ni envío", async () => {
  const h = harness(); await h.store.patchDocument("products/p1", { arcaVatRate: null });
  const result = await h.authorize(); assert.equal(result.classification, "VALIDATION"); assert.equal(result.blocked, true);
  assert.equal(h.store.documents.has("arcaSequenceLocks/homologation_pos_3_type_6"), false);
});
test("doble click / dos workers misma invoice: un único envío", async () => {
  const h = harness(); await h.prepare(); let sent = 0;
  const request = async () => { sent++; return { result: "A", cae: "12345678901234", caeExpiration: "20261231" }; };
  const results = await Promise.all([h.authorize({ requestCaeFn: request }), h.authorize({ requestCaeFn: request })]);
  assert.equal(sent, 1); assert.equal(results.some((r) => r.status === "authorized"), true);
});
test("worker con lease vencido no persiste plan ni solicita CAE", async () => {
  const h = harness(); const p = await h.prepare(); const claim = await h.deps.claimInvoiceFn({ invoiceId: p.invoiceId });
  const lock = await h.deps.acquireLockFn({ pointOfSale: 3, voucherType: 6, holder: claim.attemptId, leaseMs: 1, now: new Date(Date.now() - 10000) });
  await assert.rejects(h.deps.persistPlanFn({ invoiceId: p.invoiceId, expectedUpdateTime: claim.updateTime, attemptId: claim.attemptId, sequenceLock: lock, voucherNumber: 8 }), { code: "firebase-admin-precondition-failed" });
});
test("caída al persistir respuesta aceptada: consulta, no devuelve pending", async () => {
  const h = harness(); let saves = 0;
  const original = h.deps.markAuthorizedFn;
  const result = await h.authorize({ markAuthorizedFn: async (input) => { if (++saves === 1) throw new Error("persist failed"); return original(input); }, consultVoucherFn: async () => matchingConsult((await h.prepare()).invoice.authorization) });
  assert.equal(result.status, "authorized"); assert.equal(saves, 2);
});
test("revisión común nunca emite; intento activo no se resetea", async () => {
  const h = harness(); const p = await h.prepare(); await h.deps.claimInvoiceFn({ invoiceId: p.invoiceId });
  const result = await reviewFiscalInvoice({ invoiceId: p.invoiceId, env, getDocument: h.store.getDocument,
    recoverFn: (input) => recoverPreCaeInvoice({ ...input, ...h.deps }), syncFn: async () => {} });
  assert.equal(result.reason, "attempt-still-active"); assert.equal(result.caeRequested, false);
});
test("mirror de venta no sobrescribe otro vínculo fiscal", async () => {
  const h = harness(); const p = await h.prepare(); await h.store.patchDocument("sales/s1", { fiscalInvoiceId: "other", fiscalEnvironment: "homologation" });
  await assert.rejects(persistence.syncInvoiceToSale({ invoiceId: p.invoiceId, env, ...h.store }), { code: "arca-invoice-association-conflict" });
});
test("clasificación y UI honestas, sin raw errors", () => {
  assert.equal(classifyFiscalFailure(temporary()), "TEMPORARY"); assert.equal(classifyFiscalFailure(temporary(), { submitted: true }), "UNCERTAIN");
  assert.equal(classifyFiscalFailure({ code: "arca-point-of-sale-invalid" }), "VALIDATION");
  assert.equal(safeFiscalError({ message: "raw secret", code: "SOAP-private-value" }).message.includes("raw secret"), false);
  for (const c of ["VALIDATION", "REJECTED", "TEMPORARY", "UNCERTAIN", "AUTHORIZED"]) {
    const recovery = fiscalRecovery({ classification: c, code: "arca-timeout", attemptCount: 1 });
    assert.equal(recovery.retryable, c === "TEMPORARY");
    assert.equal(fiscalPresentation({ status: c === "AUTHORIZED" ? "authorized" : "pending", recovery }).classification, c);
  }
});
test("parser consulta no inventa número de comprobante ausente", () => {
  const parsed = parseConsultedVoucher("<ResultGet><Resultado>A</Resultado><CodAutorizacion>12345678901234</CodAutorizacion></ResultGet>");
  assert.equal(parsed.voucherNumber, null); assert.equal(parsed.pointOfSale, null);
});

// Regression: a process may persist AUTHORIZED and crash before releasing its lock.
test("terminal persistido con release interrumpido: siguiente worker repara reserva", async () => {
  const h = harness();
  const result = await h.authorize({ releaseLockFn: async () => ({ released: false }) });
  assert.equal(result.status, "authorized");
  const before = await h.store.getDocument("arcaSequenceLocks/homologation_pos_3_type_6");
  assert.ok(before.data.reservation.invoiceId);
  const acquired = await acquireSequenceLock({ pointOfSale: 3, voucherType: 6, holder: "next-worker", env, ...h.store });
  assert.equal(acquired.acquired, true);
  assert.equal((await h.store.getDocument(acquired.path)).data.reservation, null);
});
test("homologación flag off no invoca transporte ni reserva", async () => {
  const h = harness(); let sent = 0;
  await assert.rejects(h.authorize({ env: { ...env, ARCA_ALLOW_CAE_HOMOLOGATION: "false" }, requestCaeFn: async () => { sent++; } }), { code: "arca-cae-disabled" });
  assert.equal(sent, 0);
  assert.equal(h.store.documents.has("arcaSequenceLocks/homologation_pos_3_type_6"), false);
});
test("scope emisor/POS distinto del snapshot: no reserva ni envía", async () => {
  for (const override of [{ ARCA_POINT_OF_SALE: "4" }, { ARCA_ISSUER_CUIT: "20164755100" }]) {
    const h = harness(); const prepared = await h.prepare(); let sent = 0;
    await assert.rejects(authorizeInvoice({ ...h.deps, env: { ...env, ...override }, invoiceId: prepared.invoiceId, allowCaeRequest: true, requestCaeFn: async () => { sent++; } }), { code: "arca-invoice-scope-mismatch" });
    assert.equal(sent, 0);
    assert.equal(h.store.documents.has("arcaSequenceLocks/homologation_pos_3_type_6"), false);
  }
});
test("respuesta A con número diferente permanece incierta y consulta", async () => {
  const h = harness(); let consults = 0;
  const r = await h.authorize({ requestCaeFn: async () => ({ result: "A", cae: "12345678901234", caeExpiration: "20261231", voucherFrom: 99, voucherTo: 99, errors: [] }), consultVoucherFn: async () => { consults++; return {}; } });
  assert.equal(r.status, "reconciling"); assert.equal(consults, 1);
});


test("verificación posterior compara identidad completa, importes y vencimiento", async () => {
  const h = harness(); await h.authorize(); const p = await h.prepare();
  for (const mismatch of ["total", "caeExpiration"]) {
    const c = matchingConsult(p.invoice.authorization);
    if (mismatch === "total") c.total++;
    else c.caeExpiration = null;
    const result = await verifyAuthorizedInvoice({ invoiceId: p.invoiceId, env, getDocument: h.store.getDocument,
      consultVoucherFn: async () => c, markVerifiedFn: async (input) => { assert.equal(input.matched, false); return { data: { ...p.invoice, verification: { matched: input.matched } } }; } });
    assert.equal(result.matched, false);
  }
});


test("umbral CF ausente no usa un importe fiscal inventado", async () => {
  const h = harness(); let sent = 0;
  await assert.rejects(h.authorize({ env: { ...env, ARCA_CONSUMER_FINAL_ID_THRESHOLD: undefined }, requestCaeFn: async () => { sent++; } }), { code: "arca-consumer-final-threshold-invalid" });
  assert.equal(sent, 0); assert.equal(h.store.documents.has("arcaSequenceLocks/homologation_pos_3_type_6"), false);
});


test("consulta con importes cero ausentes no inventa la coincidencia", async () => {
  const h = harness(); await h.authorize({ requestCaeFn: async () => { throw temporary(); } });
  const p = await h.prepare();
  for (const field of ["nonTaxed", "exempt", "tributes"]) {
    const c = matchingConsult(p.invoice.authorization); c[field] = null;
    assert.equal(voucherMatchesAuthorization(c, p.invoice.authorization), false);
  }
});


test("worker demorado no modifica el intento que lo reemplazó después de recuperación segura", async () => {
  const h = harness(); let releaseOld; let releaseNew; let oldConsults = 0;
  const old = h.authorize({ now: new Date(Date.now() - 300000), getLastAuthorizedFn: () => new Promise(resolve => { releaseOld = resolve; }), consultVoucherFn: async () => { oldConsults++; return {}; } });
  await new Promise(resolve => setImmediate(resolve)); assert.ok(releaseOld);
  const p = await h.prepare();
  const recovered = await recoverPreCaeInvoice({ invoiceId: p.invoiceId, env, getDocument: h.store.getDocument, returnPendingFn: input => persistence.returnInvoiceToPending({ ...input, ...h.store }), now: new Date() });
  assert.equal(recovered.recovered, true);
  const replacement = h.authorize({ now: new Date(Date.now() + 360000), requestCaeFn: () => new Promise(resolve => { releaseNew = resolve; }) });
  await new Promise(resolve => setImmediate(resolve)); assert.ok(releaseNew);
  const newAttempt = (await h.prepare()).invoice.authorization.attemptId;
  releaseOld({ number: 7, errors: [] });
  const oldResult = await old; assert.equal(oldResult.reason, "attempt-superseded"); assert.equal(oldConsults, 0);
  const active = (await h.prepare()).invoice; assert.equal(active.status, "authorizing"); assert.equal(active.authorization.attemptId, newAttempt);
  releaseNew({ result: "A", cae: "12345678901234", caeExpiration: "20261231", errors: [] });
  assert.equal((await replacement).status, "authorized");
});

test("revisión común admite receptor explícito para plan sin solicitar CAE", async () => {
  const h = harness('seller_sale'); const p = await h.prepare(); let checked = false;
  const result = await reviewFiscalInvoice({ invoiceId: p.invoiceId, receiver, env, getDocument: h.store.getDocument,
    dryRunFn: async input => { assert.deepEqual(input.receiver, receiver); assert.equal(input.allowCaeRequest, false); checked = true; return { status: 'pending', dryRun: true }; }, syncFn: async () => {} });
  assert.equal(checked, true); assert.equal(result.caeRequested, false);
});
test("receptor faltante se valida y queda fijado atómicamente antes de enviar", async () => {
  const h = harness('seller_sale'); const p = await h.prepare(); await h.store.patchDocument(`invoices/${p.invoiceId}`, { receiverSnapshot: null });
  const cuitReceiver = { vatConditionId: 1, documentType: 80, documentNumber: '20164755100', anonymousConsumerFinal: false, concept: 1 };
  const result = await h.authorize({ receiver: cuitReceiver, requestCaeFn: async () => {
    const planned = (await h.store.getDocument(`invoices/${p.invoiceId}`)).data;
    assert.deepEqual(planned.receiverSnapshot, cuitReceiver); assert.equal(planned.authorization.voucherType, 1);
    return { result: 'A', cae: '12345678901234', caeExpiration: '20261231', errors: [] };
  } });
  assert.equal(result.status, 'authorized');
  await h.authorize({ receiver: { ...cuitReceiver, documentNumber: '20123456786' } });
  assert.deepEqual((await h.prepare()).invoice.receiverSnapshot, cuitReceiver);
});
test("CUIT con dígito verificador inválido es VALIDATION antes de claim/envío", async () => {
  const h = harness(); const p = await h.prepare(); await h.store.patchDocument(`invoices/${p.invoiceId}`, { receiverSnapshot: null }); let sent = 0;
  const r = await h.authorize({ receiver: { vatConditionId: 1, documentType: 80, documentNumber: '20164755101', anonymousConsumerFinal: false, concept: 1 }, requestCaeFn: async () => { sent++; } });
  assert.equal(r.classification, 'VALIDATION'); assert.equal(r.blocked, true); assert.equal(sent, 0);
  assert.equal(h.store.documents.has('arcaSequenceLocks/homologation_pos_3_type_1'), false);
});

test("TEMPORARY previo al envío: retry después del backoff autoriza una sola vez la misma Invoice", async () => {
  const h = harness(); const before = await h.prepare(); let sent = 0;
  const first = await h.authorize({ getLastAuthorizedFn: async () => { throw temporary(); } }); assert.equal(first.status, 'pending');
  const next = (await h.prepare()).invoice.recovery.nextRetryAt;
  const success = await h.authorize({ now: new Date(Date.parse(next) + 1000), requestCaeFn: async () => { sent++; return { result: 'A', cae: '12345678901234', caeExpiration: '20261231', errors: [] }; } });
  assert.equal(success.status, 'authorized'); assert.equal(success.invoice.recovery.attemptCount, 2);
  const replay = await h.authorize({ requestCaeFn: async () => { sent++; } }); assert.equal(replay.alreadyAuthorized, true); assert.equal(sent, 1);
  assert.equal((await h.prepare()).invoiceId, before.invoiceId); assert.equal([...h.store.documents.keys()].filter(k => k.startsWith('sales/')).length, 1);
});
