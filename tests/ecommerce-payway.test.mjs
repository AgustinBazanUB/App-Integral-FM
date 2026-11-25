import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { memoryStore, now, admin, session } from "./helpers/shippingFixtures.mjs";
import { createEcommerceOrder } from "../netlify/functions/_lib/ecommerce/commerceService.mjs";
import { confirmEcommercePayment } from "../netlify/functions/_lib/ecommerce/paymentService.mjs";
import { manageWebOrder } from "../netlify/functions/_lib/ecommerce/orderManagement.mjs";
import { processPaywayPayment } from "../netlify/functions/_lib/ecommerce/paywayService.mjs";
import { paywayConfig, paywayPublicConfig, paywayAmount, paywayRetailRisk, verifiedPaywayReceipt } from "../netlify/functions/_lib/ecommerce/paywayGateway.mjs";
import { summarizeSales } from "../src/modules/locations/domain/saleFacts.js";
import { ensurePendingInvoice, syncInvoiceToSale } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";
import { prepareEcommerceInvoiceFiscal } from "../netlify/functions/_lib/ecommerce/fiscalService.mjs";
import { previewPaywayBilling, requestPaywayInvoice, validatePaywayInvoiceA } from "../netlify/functions/_lib/ecommerce/paywayFiscalService.mjs";
import { reservedStockQuantity } from "../src/shared/stockReservations.mjs";

const env = { CONTEXT: "deploy-preview", FIREBASE_PROJECT_ID: "app-integral-fm-pruebas", VITE_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: "app-integral-fm-pruebas", client_email: "synthetic@app-integral-fm-pruebas.iam.gserviceaccount.com", private_key: "synthetic-not-a-key" }),
  VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas", ARCA_ENVIRONMENT: "homologation", PAYWAY_ENABLED: "true", PAYWAY_ENVIRONMENT: "sandbox",
  PAYWAY_SANDBOX_SITE_ID: "12345678", PAYWAY_SANDBOX_PUBLIC_KEY: "synthetic_public_key_000000", PAYWAY_SANDBOX_PRIVATE_KEY: "synthetic_private_key_000000" };
const accessToken = "synthetic_access_".repeat(3);
const body = { requestId: "payway_qa_order_0001", accessToken, items: [{ productId: "oil", quantity: 2 }],
  customer: { fullName: "Comprador ficticio", email: "qa@example.invalid", phone: "1198765432" },
  deliveryMethod: "pickup", shipping: { method: "pickup" } };
const receipt = (payload, patch = {}) => ({ ...payload, id: 12345, site_id: env.PAYWAY_SANDBOX_SITE_ID, currency: "ars", status: "approved", ...patch });
const rows = (db, prefix) => [...db.documents].filter(([p])=>p.startsWith(prefix+"/") && p.split("/").length===2).map(([id,data])=>({id,...data}));
async function setup(billing) {
  const db = memoryStore();
  db.documents.get("products/oil").arcaVatRate = 21;
  db.documents.set("channels/ecommerce", { active: true, defaultOrigin: { type: "location", id: "valle" }, authorizedOrigins: [{ type: "location", id: "valle" }],
    authorizedUserIds: [admin.id], pickup: { enabled: true, locationId: "valle", address: "Dirección QA ficticia", name: "Local QA" }, delivery: { enabled: false } });
  const result = await db.runTransaction(tx => createEcommerceOrder({ body: { ...body, billing }, env, now, ...tx }));
  const getDocument = async p => db.documents.has(p) ? { data: structuredClone(db.documents.get(p)) } : null;
  let charges = 0, payload;
  const gateway = { charge: async p => { charges++; payload = p; return receipt(p); }, find: async () => [{ id: 12345, site_transaction_id: payload.site_transaction_id }], info: async () => receipt(payload) };
  const confirm = args => db.runTransaction(tx => confirmEcommercePayment({ ...args, now, ...tx }));
  const request = { mode: "pay", orderId: result.order.id, accessToken, token: "synthetic_token_0000000001", bin: "516844", fingerprint: "synthetic_device_00000001", payerAddress: { street: "Calle QA 123", city: "CABA", provinceCode: "C", postalCode: "1000" } };
  const process = (overrides={}) => processPaywayPayment({ body: request, env, now, runTransaction: db.runTransaction, getDocument, gateway, confirm, clientIp: "192.0.2.1", ...overrides });
  const createDocument = (collection, id, data) => {
    const path = `${collection}/${id}`;
    return db.runTransaction(tx => tx.commitDocuments([{ type: "create", path, data }])).then(() => getDocument(path));
  };
  const patchDocument = (path, data) =>
    db.runTransaction(tx => tx.commitDocuments([{ type: "update", path, data }])).then(() => getDocument(path));
  return { db, order: result.order, gateway, request, process, confirm, getDocument, createDocument, patchDocument,
    charges:()=>charges, payload:()=>payload };
}

test("Payway recibe la provincia del domicilio de entrega y conserva la de facturación", () => {
  const order = {
    customer: body.customer,
    idempotencyKey: body.requestId,
    shippingAmount: 1000,
    total: 3000,
    items: [],
    shipping: { method: "delivery", address: { city: "Santo Tomé", province: "Santa Fe", street: "Mendoza", number: "1571", postalCode: "3016" } },
  };
  const context = {
    payerAddress: { street: "Dirección de prueba", city: "CABA", provinceCode: "C", postalCode: "1000" },
    fingerprint: "synthetic_device_001",
    clientIp: "192.0.2.5",
  };
  const risk = paywayRetailRisk(order, context);
  assert.equal(risk.bill_to.state, "C");
  assert.equal(risk.retail_transaction_data.ship_to.state, "S");
  assert.equal(risk.retail_transaction_data.ship_to.postal_code, "3016");
  order.shipping.address = { ...order.shipping.address, city: "Ciudad Autónoma de Buenos Aires", province: "CABA", postalCode: "1428" };
  assert.equal(paywayRetailRisk(order, context).retail_transaction_data.ship_to.city, "CABA");
});

test("Payway aprobado convierte una reserva en una venta y logística; sandbox excluido de ingresos", async()=>{
  const s=await setup(); const r=await s.process();
  assert.equal(r.order.paymentStatus,"approved"); assert.ok(r.order.saleId); assert.equal(s.charges(),1);
  assert.equal(s.payload().amount,200000); assert.equal(s.payload().payment_method_id,104);
  assert.equal(s.payload().fraud_detection.send_to_cs,true);
  assert.equal(s.payload().fraud_detection.device_unique_id,s.request.fingerprint);
  assert.equal(s.payload().fraud_detection.purchase_totals.amount,200000);
  assert.equal(s.payload().fraud_detection.retail_transaction_data.dispatch_method, "storepickup");
  const stock = s.db.documents.get("locationStock/valle/items/oil");
  assert.equal(stock.currentStock, 10);
  assert.equal(reservedStockQuantity(stock, new Date(+now + 2 * 86400000)), 2);
  assert.equal(rows(s.db,"sales").length,1); assert.equal(rows(s.db,"shipments").length,1); assert.equal(rows(s.db,"stockMovements").length,0);
  assert.equal(rows(s.db,"shipments")[0].stockOriginId, null);
  assert.equal(rows(s.db,"shipments")[0].stockCommitState, "pending");
  assert.equal(rows(s.db,"sales")[0].paymentEnvironment,"sandbox");
  assert.equal(rows(s.db,"shipments")[0].testData,true);
  assert.equal(summarizeSales(rows(s.db,"sales")).total,0);
  assert.equal(rows(s.db,"invoices").length,0);
  assert.ok(!JSON.stringify([...s.db.documents]).includes(s.request.token));
});
test("doble clic concurrente, recarga y reintento conservan un cobro, una venta y su reserva",async()=>{
  const s=await setup(); await Promise.all([s.process(),s.process(),s.process()]); await s.process();
  assert.equal(s.charges(),1); assert.equal(rows(s.db,"sales").length,1); assert.equal(rows(s.db,"stockMovements").length,0);
});
for(const status of ["rejected","cancelled"]) test(`Payway ${status} no genera venta ni stock y no vuelve a cobrar`,async()=>{
  const s=await setup();s.gateway.charge=async p=>receipt(p,{status}); const r=await s.process();await s.process();
  assert.equal(r.order.paymentStatus,status); assert.equal(rows(s.db,"sales").length,0);assert.equal(s.db.documents.get("locationStock/valle/items/oil").currentStock,10);
  assert.equal(reservedStockQuantity(s.db.documents.get("locationStock/valle/items/oil"), now), 0);
});
test("timeout mantiene referencia estable; consulta posterior recupera aprobación sin segundo POST",async()=>{
  const s=await setup();const original=s.gateway.charge;s.gateway.charge=async p=>{await original(p);throw Error("network timeout");};
  const first=await s.process();assert.equal(first.gateway.state,"uncertain"); assert.equal(rows(s.db,"sales").length,0);
  const later=new Date(now.valueOf()+20000);
  const recovered=await s.process({now:later,body:{mode:"reconcile",orderId:s.order.id,accessToken}});
  assert.equal(recovered.order.paymentStatus,"approved");assert.equal(s.charges(),1);
});
test("una anulación de Payway ya conciliada libera la reserva y habilita la edición", async () => {
  const s = await setup();
  const charge = s.gateway.charge;
  s.gateway.charge = async payload => {
    const value = await charge(payload);
    return { ...value, status: "review" };
  };
  const pending = await s.process();
  assert.equal(pending.gateway.state, "pending");
  s.gateway.info = async () => receipt(s.payload(), { status: "annulled" });
  const reconciled = await s.process({
    now: new Date(now.valueOf() + 20000), body: { mode: "reconcile", orderId: s.order.id, accessToken },
  });
  assert.equal(reconciled.order.paymentStatus, "cancelled");
  assert.equal(s.db.documents.get("orders/" + s.order.id).reservationStatus, "released");
  assert.equal(reservedStockQuantity(s.db.documents.get("locationStock/valle/items/oil"), now), 0);
  assert.deepEqual(await s.process({ body: { mode: "edit", orderId: s.order.id, accessToken } }), { editable: true });
  assert.equal(s.charges(), 1);
  for (const collection of ["sales", "shipments", "stockMovements", "invoices"]) assert.equal(rows(s.db, collection).length, 0);
});

test("consulta sin resultado nunca dispara otro cobro",async()=>{
  const s=await setup();s.gateway.charge=async()=>{throw Error("timeout")};s.gateway.find=async()=>[];
  await s.process();const r=await s.process({now:new Date(now.valueOf()+20000)});
  assert.equal(r.gateway.state,"uncertain"); assert.equal(rows(s.db,"sales").length,0);
});
for(const patch of [{amount:1},{currency:"USD"},{site_id:"00000000"},{site_transaction_id:"another"},{payment_method_id:31}])
test(`respuesta alterada ${Object.keys(patch)[0]} conserva incidencia sin venta`,async()=>{
  const s=await setup();s.gateway.charge=async p=>receipt(p,patch);const r=await s.process();
  assert.equal(r.gateway.state,"uncertain");assert.equal(rows(s.db,"sales").length,0);
});
test("aprobación durable sobrevive fallo comercial y se recupera sin cobrar otra vez",async()=>{
  const s=await setup();const r=await s.process({confirm:async()=>{throw Error("stock changed")}});
  assert.equal(r.gateway.state,"recovery_required");assert.equal(s.db.documents.get(`payments/${s.order.paymentId}`).gateway.receipt.status,"approved");
  assert.equal(s.db.documents.get(`orders/${s.order.id}`).paymentIncident.providerApproved,true);
  const recovered=await s.process();assert.equal(recovered.order.paymentStatus,"approved");assert.equal(s.charges(),1);
});
test("Visa sandbox admitida explícitamente, sin alterar la ruta Mastercard",async()=>{
  const s=await setup();const r=await s.process({body:{...s.request,paymentMethodId:1}});
  assert.equal(s.payload().payment_method_id,1);assert.equal(r.order.paymentStatus,"approved");
  const other=await setup();await assert.rejects(()=>other.process({body:{...other.request,paymentMethodId:31}}),{code:"payway-request-invalid"});assert.equal(other.charges(),0);
});
test("administrador activo puede conciliar sin clave del comprador; vendedor no",async()=>{
  const s=await setup();await s.process({confirm:async()=>{throw Error("temporary")}});
  await assert.rejects(()=>s.process({body:{mode:"reconcile",orderId:s.order.id},adminActor:{uid:"seller"}}),{code:"ecommerce-order-access-denied"});
  const r=await s.process({body:{mode:"reconcile",orderId:s.order.id},adminActor:{uid:admin.id}});
  assert.equal(r.order.paymentStatus,"approved");assert.equal(s.charges(),1);
});
test("un caller no puede confirmar Payway sin evidencia persistida del proveedor",async()=>{
  const s=await setup();await assert.rejects(()=>s.confirm({orderId:s.order.id,idempotencyKey:s.order.requestId,provider:"payway",status:"approved",reference:"12345",env}),{code:"payway-evidence-required"});
});
for(const patch of [{accessToken:"b".repeat(48)},{orderId:"ecommerce_order_inexistente_0001"}]) test("acceso privado incorrecto no cobra",async()=>{
  const s=await setup();await assert.rejects(()=>s.process({body:{...s.request,...patch}}),{code:"ecommerce-order-access-denied"});assert.equal(s.charges(),0);
});
test("PAN/CVV, importe o estado del navegador no se aceptan en el endpoint",async()=>{
  const s=await setup();for(const patch of [{card_number:"forbidden"},{security_code:"forbidden"},{amount:1},{status:"approved"}]) await assert.rejects(()=>s.process({body:{...s.request,...patch}}),{code:"payway-request-invalid"});assert.equal(s.charges(),0);
});
test("stock insuficiente y reserva vencida bloquean antes de cobrar",async()=>{
  const s=await setup();s.db.documents.get("locationStock/valle/items/oil").currentStock=1;
  await assert.rejects(()=>s.process(),{code:"ecommerce-reservation-invalid"}); assert.equal(s.charges(),0);
  await assert.rejects(()=>s.process({now:new Date(now.valueOf()+20*60*1000)}),{code:"ecommerce-reservation-expired"});
});
test("cancelación administrativa bloqueada con cobro incierto",async()=>{
  const s=await setup();s.gateway.charge=async()=>{throw Error("timeout")};await s.process();
  await assert.rejects(()=>manageWebOrder({body:{mode:"cancel",orderId:s.order.id,requestId:"cancel_payway_0001",reason:"QA"},session:session(admin),env,now,runTransaction:s.db.runTransaction}));
  assert.equal(s.db.documents.get(`orders/${s.order.id}`).status,"pending_payment");
});
test("volver a editar libera sólo la reserva autenticada y bloquea el cobro del pedido anterior", async () => {
  const s = await setup();
  const edit = { mode: "edit", orderId: s.order.id, accessToken };
  await assert.rejects(() => s.process({ body: { ...edit, accessToken: "x".repeat(48) } }), { code: "ecommerce-order-access-denied" });
  const stockPath = "locationStock/valle/items/oil";
  const before = s.db.documents.get(stockPath);
  const otherId = "ecommerce_order_other_0001";
  before.ecommerceReservations[otherId] = { quantity: 3, expiresAt: new Date(now.valueOf() + 600000) };
  for (let call = 0; call < 2; call += 1) {
    assert.deepEqual(await s.process({ body: edit }), { editable: true });
  }
  const stock = s.db.documents.get(stockPath);
  assert.equal(stock.currentStock, 10);
  assert.equal(stock.ecommerceReservations[s.order.id], undefined);
  assert.equal(stock.ecommerceReservations[otherId].quantity, 3);
  assert.equal(s.db.documents.get("orders/" + s.order.id).cancelledForEditing, true);
  assert.equal(s.db.documents.get("payments/" + s.order.paymentId).status, "cancelled");
  await assert.rejects(s.process, { code: "ecommerce-reservation-expired" });
  assert.equal(s.charges(), 0);
  for (const collection of ["sales", "shipments", "stockMovements", "invoices"]) assert.equal(rows(s.db, collection).length, 0);
});

test("un checkout retrasado no crea una reserva si el comprador ya volvió a editar", async () => {
  const s = await setup();
  const laterBody = { ...body, requestId: "checkout_retrasado_0001" };
  const orderId = "ecommerce_order_" + laterBody.requestId;
  const edit = { mode: "edit", orderId, accessToken };
  assert.deepEqual(await s.process({ body: edit }), { editable: true });
  const create = () => s.db.runTransaction(tx => createEcommerceOrder({ body: laterBody, env, now, ...tx }));
  await assert.rejects(create, { code: "ecommerce-checkout-edited" });
  assert.equal(rows(s.db, "orders").length, 1);
  assert.equal(s.db.documents.get("locationStock/valle/items/oil").ecommerceReservations[orderId], undefined);
});

test("la edición espera la confirmación de Payway y respeta un pago aprobado", async () => {
  const s = await setup();
  const edit = { mode: "edit", orderId: s.order.id, accessToken };
  const charge = s.gateway.charge;
  s.gateway.charge = async payload => {
    await assert.rejects(() => s.process({ body: edit }), { code: "ecommerce-checkout-payment-unresolved" });
    return charge(payload);
  };
  const confirmed = await s.process();
  assert.equal(confirmed.order.paymentStatus, "approved");
  await assert.rejects(() => s.process({ body: edit }), { code: "ecommerce-checkout-already-paid" });
  assert.equal(s.charges(), 1);
  assert.equal(rows(s.db, "sales").length, 1);
});

test("un intento rechazado por Payway admite edición y un nuevo pedido", async () => {
  for (const status of ["rejected", "cancelled"]) {
    const s = await setup();
    s.gateway.charge = async payload => receipt(payload, { status });
    await s.process();
    const edit = { mode: "edit", orderId: s.order.id, accessToken };
    assert.deepEqual(await s.process({ body: edit }), { editable: true });
    assert.equal(rows(s.db, "sales").length, 0);
  }
});

test("aislamiento falla cerrado para producción, mezcla de Firebase y ARCA productiva",()=>{
  for(const patch of [{PAYWAY_ENVIRONMENT:"production"},{CONTEXT:"production"},{FIREBASE_PROJECT_ID:"app-integral-fm"},{ARCA_ENVIRONMENT:"production"},{VITE_FIREBASE_PROJECT_ID:"app-integral-fm"}]) assert.throws(()=>paywayConfig({...env,...patch}));
  const publicConfig=paywayPublicConfig(env);assert.equal(publicConfig.enabled,true);assert.ok(!JSON.stringify(publicConfig).includes(env.PAYWAY_SANDBOX_PRIVATE_KEY));
});
test("importe se convierte una sola vez a centavos y rechaza precisión inválida",()=>{
  assert.equal(paywayAmount(1500),150000);assert.equal(paywayAmount(12.34),1234);for(const n of [0,-1,NaN,Infinity,1.001])assert.throws(()=>paywayAmount(n));
});
test("datos antifraude incompletos bloquean antes del claim y del cobro",async()=>{
  const s=await setup();for(const patch of [{payerAddress:{}},{fingerprint:""}]) await assert.rejects(()=>s.process({body:{...s.request,...patch}}),{code:"payway-risk-data-required"});
  assert.equal(s.charges(),0);assert.equal(s.db.documents.get(`payments/${s.order.paymentId}`).gateway,undefined);
});
test("venta sandbox bloqueada para preparación fiscal productiva",async()=>{
  const s=await setup();const r=await s.process();
  await assert.rejects(()=>ensurePendingInvoice({sourceType:"ecommerce",sourceId:r.order.saleId,env:{...env,ARCA_ENVIRONMENT:"production",ARCA_POINT_OF_SALE:"3",ARCA_ISSUER_CUIT:"20123456786"},getDocument:s.getDocument}),{code:"ecommerce-simulation-production-fiscal-denied"});
});

const billingA = {
  mode: "fiscal",
  requestedClass: "A",
  cuit: "20123456786",
  name: "Razón social ficticia",
  address: "Calle de pruebas 100",
};
const fiscalEnv = {
  ...env,
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
  ARCA_ISSUER_CUIT: "20123456786",
  ARCA_POINT_OF_SALE: "3",
};

test("Factura A valida la condición fiscal del CUIT antes de reservar o cobrar", async () => {
  const props = {
    env: fiscalEnv,
    checkReadiness: () => {},
    resolveReceiver: async ({ cuit }) => {
      assert.equal(cuit, billingA.cuit);
      return { vatConditionId: 1 };
    },
  };
  await validatePaywayInvoiceA(billingA, props);
  await assert.rejects(() => validatePaywayInvoiceA(billingA, {
    ...props, resolveReceiver: async () => ({ vatConditionId: 5 }),
  }), { code: "ecommerce-invoice-a-unavailable" });
  await assert.rejects(() => validatePaywayInvoiceA(billingA, {
    ...props, env: { ...fiscalEnv, CONTEXT: "production" },
  }), { code: "payway-isolation-required" });
});

test("el autocompletado fiscal expone sólo nombre y domicilio de un CUIT apto en homologación", async () => {
  const profile = {
    found: true, keyStatus: "ACTIVO", cuit: billingA.cuit, businessName: "Empresa ficticia",
    taxes: [{ id: 30, status: "AC" }], endpoint: "interno",
    fiscalAddress: { address: "Calle QA 321", locality: "La Plata", province: "Buenos Aires", postalCode: "1900" },
  };
  const options = {
    env: fiscalEnv, checkReadiness: () => {},
    lookup: async cuit => {
      assert.equal(cuit, billingA.cuit);
      return profile;
    },
  };
  assert.deepEqual(await previewPaywayBilling(billingA.cuit, options), {
    name: "Empresa ficticia",
    address: { street: "Calle QA 321", city: "La Plata", province: "Buenos Aires", postalCode: "1900" },
  });
  await assert.rejects(() => previewPaywayBilling("12345678", options), { code: "ecommerce-receiver-cuit-invalid" });
  await assert.rejects(() => previewPaywayBilling(billingA.cuit, {
    ...options, env: { ...fiscalEnv, ARCA_ENVIRONMENT: "production" },
  }), { code: "payway-isolation-required" });
});

for (const [billing, voucherClass] of [[{ mode: "consumer_final" }, "B"], [billingA, "A"]]) {
  test(`Payway Sandbox prepara Factura ${voucherClass} de la venta, verifica y reutiliza el comprobante`, async () => {
    const s = await setup(billing);
    const paid = await s.process();
    const orderPath = `orders/${paid.order.id}`;
    let authorizationCount = 0;
    let verificationCount = 0;
    const options = {
      orderId: paid.order.id,
      env: fiscalEnv,
      checkReadiness: () => {},
      getDocument: s.getDocument,
      prepare: async (args) => {
        const result = await prepareEcommerceInvoiceFiscal({
          ...args,
          now,
          getDocument: s.getDocument,
          patchDocument: s.patchDocument,
          ensureInvoiceFn: (invoiceArgs) => ensurePendingInvoice({
            ...invoiceArgs, createDocument: s.createDocument,
          }),
          getTaxpayerFn: async () => ({}),
          inferReceiverFn: () => ({ resolved: true, condition: { id: 1 } }),
        });
        assert.equal(result.fiscal.voucherClass, voucherClass);
        return result;
      },
      authorize: async ({ invoiceId, allowCaeRequest }) => {
        authorizationCount++;
        assert.equal(allowCaeRequest, true);
        const path = `invoices/${invoiceId}`;
        const invoice = s.db.documents.get(path);
        assert.equal(invoice.fiscalEnvironment, "homologation");
        assert.equal(invoice.receiverSnapshot.documentNumber, billing.cuit || "0");
        await s.patchDocument(path, { status: "authorized" });
        return { status: "authorized" };
      },
      verify: async ({ invoiceId }) => {
        verificationCount++;
        await s.patchDocument(`invoices/${invoiceId}`, { verification: { matched: true } });
        return { matched: true };
      },
      sync: (args) => syncInvoiceToSale({
        ...args, getDocument: s.getDocument, patchDocument: s.patchDocument, now,
      }),
    };
    const issue = () => requestPaywayInvoice({ ...options, order: s.db.documents.get(orderPath) });
    assert.deepEqual(await issue(), { invoiceStatus: "authorized", documentAvailable: true });
    assert.deepEqual(await issue(), { invoiceStatus: "authorized", documentAvailable: true });
    assert.equal(authorizationCount, 1);
    assert.equal(verificationCount, 1);
    assert.equal(s.charges(), 1);
    assert.equal(rows(s.db, "sales").length, 1);
    assert.equal(rows(s.db, "shipments").length, 1);
    assert.equal(rows(s.db, "stockMovements").length, 0);
    assert.equal(rows(s.db, "invoices").length, 1);
    assert.equal(s.db.documents.get(orderPath).invoiceStatus, "authorized");
  });
}
