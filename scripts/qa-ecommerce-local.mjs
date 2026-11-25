// Real application + real local Firebase emulators. No mocked commercial or
// logistics services; no access to production or fiscal authorization.
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
Object.assign(process.env, {
  CONTEXT: "dev",
  FM_LOCAL_EMULATORS: "true",
  FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  VITE_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  VITE_PREVIEW_FIREBASE_PROJECT_ID: "app-integral-fm-pruebas",
  VITE_PREVIEW_FIREBASE_API_KEY: "qa-emulator-key",
  FIREBASE_WEB_API_KEY: "qa-emulator-key",
  VITE_PREVIEW_FIREBASE_AUTH_DOMAIN: "app-integral-fm-pruebas.firebaseapp.com",
  VITE_PREVIEW_FIREBASE_STORAGE_BUCKET:
    "app-integral-fm-pruebas.firebasestorage.app",
  VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID: "545036860675",
  VITE_PREVIEW_FIREBASE_APP_ID: "1:545036860675:web:c76e458afc8f8f706f7d36",
  VITE_FM_LOCAL_EMULATORS: "true",
  VITE_FM_AUTH_EMULATOR_PORT: "9186",
  VITE_FM_FIRESTORE_EMULATOR_PORT: "8186",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8186",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9186",
  VITE_STOREFRONT_PUBLIC: "true",
  ECOMMERCE_SIMULATED_PAYMENT_ENABLED: "true",
  ECOMMERCE_LOCATION_ID: "qa-lavalle",
  ECOMMERCE_PICKUP_ENABLED: "true",
  ECOMMERCE_DEFAULT_TRANSPORT: "repository",
  ARCA_ENVIRONMENT: "homologation",
  ARCA_ISSUER_CUIT: "20123456786",
  ARCA_ISSUER_VAT_CONDITION: "responsable_inscripto",
  ARCA_POINT_OF_SALE: "3",
  ARCA_ALLOW_CAE_HOMOLOGATION: "false",
  ARCA_ALLOW_PRODUCTION_CAE: "false",
  ARCA_AUTO_AUTHORIZE_PRODUCTION: "false",
  SHIPPING_REPOSITORY_ADDRESS: "Repositorio sintético 456, CABA",
});
// Remove any inherited fiscal/Admin secrets; the local transport accepts only
// loopback and the known staging project.
for (const key of [
  "ARCA_CERTIFICATE_PEM",
  "ARCA_PRIVATE_KEY_PEM",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
  "FIREBASE_ADMIN_PRIVATE_KEY",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
])
  delete process.env[key];
const { adminGetDocument, adminCommitDocuments, adminListDocuments } =
  await import("../netlify/functions/_lib/firestoreAdminRest.mjs");
async function seed() {
  const signup = await fetch(
    "http://127.0.0.1:9186/identitytoolkit.googleapis.com/v1/accounts:signUp?key=qa-emulator-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "qa-admin@example.invalid",
        password: "PruebaLocal123!",
        returnSecureToken: true,
      }),
    },
  );
  let user = await signup.json();
  if (!user.localId)
    user = await (
      await fetch(
        "http://127.0.0.1:9186/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-emulator-key",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "qa-admin@example.invalid",
            password: "PruebaLocal123!",
            returnSecureToken: true,
          }),
        },
      )
    ).json();
  if (!user.localId)
    throw new Error("No se pudo crear o acceder al usuario local sintético.");
  const seeds = {
    [`users/${user.localId}`]: {
      name: "Administración QA",
      email: "qa-admin@example.invalid",
      role: "admin",
      active: true,
    },
    "users/qa-preparer": {
      name: "Preparación QA",
      role: "seller",
      active: true,
      allowedLocationIds: ["qa-lavalle", "qa-other"],
    },
    "locations/qa-lavalle": {
      name: "Local Lavalle · QA ficticio",
      address: "Calle de prueba 123, CABA",
      active: true,
      codePrefix: "QA",
    },
    "locations/qa-other": {
      name: "Otro local · QA ficticio",
      address: "Otra calle de prueba 456",
      active: true,
    },
    "warehouses/qa-warehouse": { name: "Depósito QA ficticio", active: true },
    "warehouses/qa-empty": { name: "Depósito sin stock QA", active: true },
    "products/qa-oil": {
      name: "Aceite de oliva · QA",
      active: true,
      defaultPrice: 1000,
      arcaVatRate: 21,
      categoryId: "olive_oil",
      categoryName: "Aceites",
      ecommerceSlug: "aceite-qa",
      ecommerceEditorialId: "aceite-oliva-500ml",
      description: "Producto sintético para pruebas. No despachar.",
    },
    "locationStock/qa-lavalle/items/qa-oil": {
      productId: "qa-oil",
      active: true,
      currentStock: 100,
      priceMode: "default",
    },
    "locationStock/qa-other/items/qa-oil": {
      productId: "qa-oil",
      active: true,
      currentStock: 100,
      priceMode: "default",
    },
    "warehouseStock/qa-warehouse/items/qa-oil": {
      productId: "qa-oil",
      active: true,
      currentStock: 100,
      priceMode: "default",
    },
    "warehouseStock/qa-empty/items/qa-oil": {
      productId: "qa-oil",
      active: true,
      currentStock: 0,
      priceMode: "default",
    },
    "channels/ecommerce": {
      schemaVersion: 1,
      name: "Página web / E-commerce Flor Mía",
      type: "ecommerce",
      active: true,
      defaultOrigin: { type: "location", id: "qa-lavalle" },
      authorizedOrigins: [
        { type: "location", id: "qa-lavalle" },
        { type: "location", id: "qa-other" },
        { type: "warehouse", id: "qa-warehouse" },
        { type: "warehouse", id: "qa-empty" },
      ],
      authorizedUserIds: [],
      pickup: {
        enabled: true,
        locationId: "qa-lavalle",
        name: "Local Lavalle · QA ficticio",
        address: "Calle de prueba 123, CABA",
      },
      delivery: {
        enabled: true,
        rates: [
          {
            id: "qa-caba",
            name: "CABA · tarifa sintética QA",
            province: "CABA",
            postalCodes: ["1000"],
            amount: 500,
            arcaVatRate: 21,
          },
        ],
      },
    },
  };
  for (const [target, data] of Object.entries(seeds))
    if (!(await adminGetDocument(target)))
      await adminCommitDocuments([{ type: "create", path: target, data }]);
}
await seed();
const allowed = new Set([
  "ecommerce-catalog",
  "ecommerce-checkout",
  "ecommerce-simulated-payment",
  "ecommerce-admin",
  "ecommerce-order-status",
  "shipping",
  "arca-invoice",
  "arca-authorize",
  "arca-document",
]);
const server = await createServer({
  server: { host: "127.0.0.1", port: 5186, strictPort: true },
  plugins: [
    {
      name: "local-firebase-functions",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const match = /^\/\.netlify\/functions\/([a-z-]+)$/.exec(
            req.url?.split("?")[0] || "",
          );
          if (!match) return next();
          if (!allowed.has(match[1])) {
            res.writeHead(404);
            return res.end();
          }
          try {
            const parts = [];
            let size = 0;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 65536) throw new Error("Request too large");
              parts.push(chunk);
            }
            const handler = (
              await import(`../netlify/functions/${match[1]}.mjs`)
            ).default;
            const request = new Request(`http://127.0.0.1:5186${req.url}`, {
              method: req.method,
              headers: req.headers,
              ...(!["GET", "HEAD"].includes(req.method)
                ? { body: Buffer.concat(parts) }
                : {}),
            });
            const result = await handler(request, {
              ip: req.socket.remoteAddress,
            });
            res.writeHead(result.status, Object.fromEntries(result.headers));
            res.end(Buffer.from(await result.arrayBuffer()));
          } catch (error) {
            console.error(
              "LOCAL_FUNCTION_FAILURE",
              match[1],
              error.code || error.message,
            );
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ ok: false, message: "Falló la función local." }),
            );
          }
        });
      },
    },
  ],
});
await server.listen();
console.log(
  JSON.stringify({
    url: "http://127.0.0.1:5186",
    firebaseProject: "app-integral-fm-pruebas",
    auth: "127.0.0.1:9186",
    firestore: "127.0.0.1:8186",
    fiscal: "homologation-plan-only",
    productionWrites: 0,
  }),
);
async function evidence() {
  await mkdir(".netlify/ecommerce-evidence", { recursive: true });
  const names = [
    "orders",
    "sales",
    "payments",
    "shipments",
    "stockMovements",
    "invoices",
    "auditLogs",
    "customers",
  ];
  const state = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await adminListDocuments(name)]),
    ),
  );
  state.stock = {
    lavalle: (await adminGetDocument("locationStock/qa-lavalle/items/qa-oil"))
      ?.data,
    other: (await adminGetDocument("locationStock/qa-other/items/qa-oil"))
      ?.data,
    warehouse: (
      await adminGetDocument("warehouseStock/qa-warehouse/items/qa-oil")
    )?.data,
  };
  await writeFile(
    path.resolve(".netlify/ecommerce-evidence/state.json"),
    JSON.stringify(state, null, 2),
  );
}
setInterval(() => evidence().catch(() => {}), 15000).unref();
