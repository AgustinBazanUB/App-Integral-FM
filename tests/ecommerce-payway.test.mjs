import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { memoryStore, now, admin, session } from "./helpers/shippingFixtures.mjs";
import { createEcommerceOrder } from "../netlify/functions/_lib/ecommerce/commerceService.mjs";
import { confirmEcommercePayment } from "../netlify/functions/_lib/ecommerce/paymentService.mjs";
import { manageWebOrder } from "../netlify/functions/_lib/ecommerce/orderManagement.mjs";
import { processPaywayPayment } from "../netlify/functions/_lib/ecommerce/paywayService.mjs";
import { paywayConfig, paywayPublicConfig, paywayAmount, verifiedPaywayReceipt } from "../netlify/functions/_lib/ecommerce/paywayGateway.mjs";
import { summarizeSales } from "../src/modules/locations/domain/saleFacts.js";
import { ensurePendingInvoice } from "../netlify/functions/_lib/arca/invoicePersistence.mjs";
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
async function setup() {
  const db = memoryStore();
  db.documents.get("products/oil").arcaVatRate = 21;
  db.documents.set("channels/ecommerce", { active: true, defaultOrigin: { type: "location", id: "valle" }, authorizedOrigins: [{ type: "location", id: "valle" }],
    authorizedUserIds: [admin.id], pickup: { enabled: true, locationId: "valle", address: "Dirección QA ficticia", name: "Local QA" }, delivery: { enabled: false } });
  const result = await db.runTransaction(tx => createEcommerceOrder({ body, env, now, ...tx }));
  const getDocument = async p => db.documents.has(p) ? { data: structuredClone(db.documents.get(p)) } : null;
  let charges = 0, payload;
  const gateway = { charge: async p => { charges++; payload = p; return receipt(p); }, find: async () => [{ id: 12345, site_transaction_id: payload.site_transaction_id }], info: async () => receipt(payload) };
  const confirm = args => db.runTransaction(tx => confirmEcommercePayment({ ...args, now, ...tx }));
  const request = { mode: "pay", orderId: result.order.id, accessToken, token: "synthetic_token_0000000001", bin: "516844" };
  const process = (overrides={}) => processPaywayPayment({ body: request, env, now, runTransaction: db.runTransaction, getDocument, gateway, confirm, ...overrides });
  return { db, order: result.order, gateway, request, process, confirm, getDocument, charges:()=>charges, payload:()=>payload };
}

test("Payway aprobado convierte una reserva en una venta y logística; sandbox excluido de ingresos", async()=>{
  const s=await setup(); const r=await s.process();
  assert.equal(r.order.paymentStatus,"approved"); assert.ok(r.order.saleId); assert.equal(s.charges(),1);
  assert.equal(s.payload().amount,200000); assert.equal(s.payload().payment_method_id,104);
  assert.equal(s.db.documents.get("locationStock/valle/items/oil").currentStock,8);
  assert.equal(rows(s.db,"sales").length,1); assert.equal(rows(s.db,"shipments").length,1); assert.equal(rows(s.db,"stockMovements").length,1);
  assert.equal(rows(s.db,"sales")[0].paymentEnvironment,"sandbox");
  assert.equal(rows(s.db,"shipments")[0].testData,true);
  assert.equal(summarizeSales(rows(s.db,"sales")).total,0);
  assert.equal(rows(s.db,"invoices").length,0);
  assert.ok(!JSON.stringify([...s.db.documents]).includes(s.request.token));
});
test("doble clic concurrente, recarga y reintento conservan un cobro/venta/salida",async()=>{
  const s=await setup(); await Promise.all([s.process(),s.process(),s.process()]); await s.process();
  assert.equal(s.charges(),1); assert.equal(rows(s.db,"sales").length,1); assert.equal(rows(s.db,"stockMovements").length,1);
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
test("aislamiento falla cerrado para producción, mezcla de Firebase y ARCA productiva",()=>{
  for(const patch of [{PAYWAY_ENVIRONMENT:"production"},{CONTEXT:"production"},{FIREBASE_PROJECT_ID:"app-integral-fm"},{ARCA_ENVIRONMENT:"production"},{VITE_FIREBASE_PROJECT_ID:"app-integral-fm"}]) assert.throws(()=>paywayConfig({...env,...patch}));
  const publicConfig=paywayPublicConfig(env);assert.equal(publicConfig.enabled,true);assert.ok(!JSON.stringify(publicConfig).includes(env.PAYWAY_SANDBOX_PRIVATE_KEY));
});
test("importe se convierte una sola vez a centavos y rechaza precisión inválida",()=>{
  assert.equal(paywayAmount(1500),150000);assert.equal(paywayAmount(12.34),1234);for(const n of [0,-1,NaN,Infinity,1.001])assert.throws(()=>paywayAmount(n));
});
test("venta sandbox bloqueada para preparación fiscal productiva",async()=>{
  const s=await setup();const r=await s.process();
  await assert.rejects(()=>ensurePendingInvoice({sourceType:"ecommerce",sourceId:r.order.saleId,env:{...env,ARCA_ENVIRONMENT:"production",ARCA_POINT_OF_SALE:"3",ARCA_ISSUER_CUIT:"20123456786"},getDocument:s.getDocument}),{code:"ecommerce-simulation-production-fiscal-denied"});
});
