import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/gestion/services/arcaService.js"],
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "authenticated-service-fixture", setup(builder) {
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: "firebase-fixture", namespace: "fixture" }));
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: "firestore-fixture", namespace: "fixture" }));
    builder.onLoad({ filter: /firebase-fixture/, namespace: "fixture" }, () => ({ contents: 'export const auth={currentUser:{getIdToken:async()=>"fixture-token"}};export const db={};' }));
    builder.onLoad({ filter: /firestore-fixture/, namespace: "fixture" }, () => ({ contents: 'export const collection=()=>{},getDocs=()=>{},limit=()=>{},orderBy=()=>{},query=()=>{};' }));
  } }],
});
const { requestPendingArcaInvoice } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("la respuesta conserva el CAE automático anidado que devuelve arca-invoice", async () => {
  const automatic = { attempted: true, status: "authorized", verification: { matched: true }, authorization: { voucherNumber: 321 } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, request) => {
      assert.equal(JSON.parse(request.body).sourceId, "sale-fixture");
      return Response.json({ ok: true, invoice: { id: "invoice-fixture", status: "authorized", autoAuthorization: automatic } });
    };
    const result = await requestPendingArcaInvoice({ sourceType: "seller_sale", sourceId: "sale-fixture" });
    assert.deepEqual(result.autoAuthorization, automatic);
    assert.equal(result.status, "authorized");
  } finally { globalThis.fetch = originalFetch; }
});

test("una preparación sin CAE conserva el estado pendiente", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ok: true, invoice: { id: "pending-fixture", status: "pending" } });
    const result = await requestPendingArcaInvoice({ sourceType: "seller_sale", sourceId: "sale-fixture" });
    assert.equal(result.status, "pending");
    assert.equal(result.autoAuthorization, null);
  } finally { globalThis.fetch = originalFetch; }
});
