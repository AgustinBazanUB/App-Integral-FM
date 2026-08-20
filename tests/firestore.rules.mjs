import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-flor-mia-integral",
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
    },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    await Promise.all([
      setDoc(doc(database, "users", "admin-1"), {
        name: "Administrador",
        role: "admin",
        active: true,
      }),
      setDoc(doc(database, "users", "seller-1"), {
        name: "Vendedor",
        role: "seller",
        active: true,
        allowedLocationIds: ["loc-1"],
      }),
      setDoc(doc(database, "users", "manager-1"), {
        name: "Encargado",
        role: "location_manager",
        active: true,
        allowedLocationIds: ["loc-1"],
      }),
      setDoc(doc(database, "users", "marketing-denied"), {
        name: "Marketing restringido",
        role: "marketing_manager",
        active: true,
        permissionDeny: { marketing: ["whatsappSendToExtension"] },
      }),
      setDoc(doc(database, "locations", "loc-1"), {
        name: "Ubicación autorizada",
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locations", "loc-2"), {
        name: "Ubicación ajena",
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locationStock", "loc-1", "items", "product-1"), {
        productId: "product-1",
        productName: "Producto",
        currentStock: 5,
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "locationStock", "loc-2", "items", "product-1"), {
        productId: "product-1",
        productName: "Producto ajeno",
        currentStock: 8,
        active: true,
        deleted: false,
      }),
      setDoc(doc(database, "auditLogs", "audit-1"), {
        action: "stock.add",
        userId: "admin-1",
        locationId: "loc-1",
        createdAt: new Date(),
      }),
      setDoc(doc(database, "auditLogs", "audit-2"), {
        action: "stock.add",
        userId: "admin-1",
        locationId: "loc-2",
        createdAt: new Date(),
      }),
      setDoc(doc(database, "financialEntries", "entry-1"), {
        name: "Entrada protegida",
        createdBy: "admin-1",
      }),
      setDoc(doc(database, "customerZones", "zone-active"), {
        name: "Zona Norte",
        active: true,
        order: 1,
      }),
      setDoc(doc(database, "customerZones", "zone-inactive"), {
        name: "Zona Histórica",
        active: false,
        order: 2,
      }),
      setDoc(doc(database, "customers", "customer_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), {
        customerKey: "customer_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        phone: "11 1234-5678",
        phoneNormalized: "1112345678",
        name: "Cliente existente",
        zoneId: "zone-active",
        zoneName: "Zona Norte",
        active: true,
        deleted: false,
        source: "seller_sale",
        createdBy: "seller-1",
        lastSaleId: "seed-sale",
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("el vendedor sólo puede leer ubicaciones asignadas", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(database, "locations", "loc-1")));
  await assertFails(getDoc(doc(database, "locations", "loc-2")));
});

test("el vendedor no puede crear ubicaciones", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertFails(
    setDoc(doc(database, "locations", "loc-3"), {
      name: "No permitida",
      active: true,
    }),
  );
});

test("finanzas queda restringido al rol autorizado", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(adminDb, "financialEntries", "entry-1")));
  await assertFails(getDoc(doc(sellerDb, "financialEntries", "entry-1")));
});

test("el vendedor no puede ajustar stock fuera de una venta válida", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const stockRef = doc(database, "locationStock", "loc-1", "items", "product-1");
  await assertFails(updateDoc(stockRef, { currentStock: -1, updatedAt: new Date() }));
  await assertFails(updateDoc(stockRef, { currentStock: 4, updatedAt: new Date() }));
  await assertFails(updateDoc(stockRef, {
    currentStock: 4,
    lastSaleId: "sale-inexistente",
    lastMovementId: "movement-inexistente",
    updatedAt: new Date(),
  }));
  const snapshot = await getDoc(stockRef);
  assert.equal(snapshot.data().currentStock, 5);
});

test("una venta válida actualiza venta, movimiento y stock en la misma transacción", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const saleRef = doc(database, "sales", "seller-sale-1");
  const movementRef = doc(database, "stockMovements", "seller-movement-1");
  const stockRef = doc(database, "locationStock", "loc-1", "items", "product-1");

  await assertSucceeds(runTransaction(database, async (transaction) => {
    const stock = await transaction.get(stockRef);
    const previousStock = stock.data().currentStock;
    const newStock = previousStock - 1;
    transaction.set(saleRef, {
      saleCode: "FM-LOC-20260806-0001",
      sellerId: "seller-1",
      sellerName: "Vendedor",
      locationId: "loc-1",
      locationName: "Ubicación autorizada",
      status: "active",
      total: 1000,
      totalItems: 1,
      items: [{ productId: "product-1", name: "Producto", qty: 1, unitPrice: 1000, subtotal: 1000 }],
      paymentMethod: "cash",
      paymentMethodLabel: "Pago eft",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    transaction.set(movementRef, {
      locationId: "loc-1",
      productId: "product-1",
      type: "sale",
      qty: -1,
      previousStock,
      newStock,
      reason: "Venta de prueba",
      userId: "seller-1",
      userName: "Vendedor",
      saleId: saleRef.id,
      createdAt: new Date(),
    });
    transaction.update(stockRef, {
      currentStock: newStock,
      lastSaleId: saleRef.id,
      lastMovementId: movementRef.id,
      updatedAt: new Date(),
    });
  }));

  assert.equal((await getDoc(stockRef)).data().currentStock, 4);
  assert.equal((await getDoc(saleRef)).data().sellerId, "seller-1");
});

test("la anulación conserva la venta y devuelve el stock de forma atómica", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const saleRef = doc(database, "sales", "seller-sale-1");
  const movementRef = doc(database, "stockMovements", "seller-movement-cancel-1");
  const stockRef = doc(database, "locationStock", "loc-1", "items", "product-1");

  await assertSucceeds(runTransaction(database, async (transaction) => {
    const stock = await transaction.get(stockRef);
    const previousStock = stock.data().currentStock;
    const newStock = previousStock + 1;
    transaction.update(saleRef, {
      status: "cancelled",
      cancelledBy: "seller-1",
      cancelledByName: "Vendedor",
      cancelledAt: new Date(),
      cancelReason: "Error de carga",
      updatedAt: new Date(),
    });
    transaction.set(movementRef, {
      locationId: "loc-1",
      productId: "product-1",
      type: "sale_cancel",
      qty: 1,
      previousStock,
      newStock,
      reason: "Anulación de prueba",
      userId: "seller-1",
      userName: "Vendedor",
      saleId: saleRef.id,
      createdAt: new Date(),
    });
    transaction.update(stockRef, {
      currentStock: newStock,
      lastSaleId: saleRef.id,
      lastMovementId: movementRef.id,
      updatedAt: new Date(),
    });
  }));

  const sale = await getDoc(saleRef);
  assert.equal(sale.exists(), true);
  assert.equal(sale.data().status, "cancelled");
  assert.equal((await getDoc(stockRef)).data().currentStock, 5);
});

test("el vendedor no puede leer stock ni actividad de otra ubicación", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(database, "locationStock", "loc-1", "items", "product-1")));
  await assertFails(getDoc(doc(database, "locationStock", "loc-2", "items", "product-1")));
  await assertSucceeds(getDoc(doc(database, "auditLogs", "audit-1")));
  await assertFails(getDoc(doc(database, "auditLogs", "audit-2")));
});

test("un encargado puede cargar stock pero no asignar vendedores ni descuentos", async () => {
  const database = environment.authenticatedContext("manager-1").firestore();
  await assertSucceeds(setDoc(doc(database, "locationStock", "loc-1", "items", "product-2"), {
    productId: "product-2",
    productName: "Producto nuevo",
    currentStock: 3,
    initialStock: 3,
    active: true,
    deleted: false,
    updatedAt: new Date(),
  }));
  await assertFails(updateDoc(doc(database, "locations", "loc-1"), { assignedSellerIds: ["seller-1"], updatedAt: new Date() }));
  await assertFails(updateDoc(doc(database, "locations", "loc-1"), { enabledDiscountIds: ["discount-1"], updatedAt: new Date() }));
});

test("el vendedor puede resolver un cliente puntual pero no listar la base", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDoc(doc(database, "customers", "customer_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")));
  await assertFails(getDocs(collection(database, "customers")));
});

test("el vendedor sólo puede listar zonas activas", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  await assertSucceeds(getDocs(query(collection(database, "customerZones"), where("active", "==", true))));
  await assertFails(getDocs(collection(database, "customerZones")));
  await assertSucceeds(getDoc(doc(database, "customerZones", "zone-active")));
  await assertFails(getDoc(doc(database, "customerZones", "zone-inactive")));
});

test("cliente nuevo y venta quedan vinculados dentro de la misma operación", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const customerId = "customer_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const customerRef = doc(database, "customers", customerId);
  const saleRef = doc(database, "sales", "customer-sale-1");

  await assertSucceeds(runTransaction(database, async (transaction) => {
    transaction.set(customerRef, {
      customerKey: customerId,
      phone: "11 2222-3333",
      phoneNormalized: "1122223333",
      name: null,
      zoneId: "zone-active",
      zoneName: "Zona Norte",
      customZone: null,
      active: true,
      deleted: false,
      source: "seller_sale",
      createdBy: "seller-1",
      createdByName: "Vendedor",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSaleId: saleRef.id,
      lastPurchaseAt: new Date(),
    });
    transaction.set(saleRef, {
      saleCode: "FM-LOC-20260806-0002",
      sellerId: "seller-1",
      sellerName: "Vendedor",
      locationId: "loc-1",
      locationName: "Ubicación autorizada",
      customerId,
      customerPhoneSnapshot: "11 2222-3333",
      customerNameSnapshot: null,
      customerZoneSnapshot: "Zona Norte",
      status: "active",
      total: 1000,
      totalItems: 1,
      items: [{ productId: "product-1", name: "Producto", qty: 1, unitPrice: 1000, subtotal: 1000 }],
      paymentMethod: "cash",
      paymentMethodLabel: "Pago eft",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }));

  assert.equal((await getDoc(customerRef)).data().phoneNormalized, "1122223333");
  assert.equal((await getDoc(saleRef)).data().customerId, customerId);
});

test("el vendedor no puede crear un cliente sin una venta vinculada", async () => {
  const database = environment.authenticatedContext("seller-1").firestore();
  const customerId = "customer_cccccccccccccccccccccccccccccccccccccccc";
  await assertFails(setDoc(doc(database, "customers", customerId), {
    customerKey: customerId,
    phone: "11 4444-5555",
    phoneNormalized: "1144445555",
    zoneName: "Zona Norte",
    active: true,
    deleted: false,
    source: "seller_sale",
    createdBy: "seller-1",
    lastSaleId: "sale-no-vinculada",
  }));
});

test("campañas WhatsApp quedan restringidas a marketing autorizado y sin binarios", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  const campaignRef = doc(adminDb, "whatsappCampaigns", "wa-1");
  await assertSucceeds(setDoc(campaignRef, {
    name: "Campaña segura",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 0,
    imageNames: [],
    imageOrder: [],
    imageMetadata: [],
    totalRecipients: 1,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    snapshotState: "draft",
    active: true,
    deleted: false,
    createdBy: "admin-1",
    createdByName: "Administrador",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(getDoc(doc(sellerDb, "whatsappCampaigns", "wa-1")));
  await assertFails(setDoc(doc(adminDb, "whatsappCampaigns", "wa-binary"), {
    name: "No válida",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 1,
    imageData: "base64",
    totalRecipients: 0,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    createdBy: "admin-1",
  }));
});

test("destinatarios WhatsApp viven en subcolección protegida", async () => {
  const adminDb = environment.authenticatedContext("admin-1").firestore();
  const sellerDb = environment.authenticatedContext("seller-1").firestore();
  const recipientRef = doc(adminDb, "whatsappCampaigns", "wa-1", "recipients", "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await assertSucceeds(setDoc(recipientRef, {
    recipientId: "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    clientId: null,
    name: "Cliente",
    phone: "1157571979",
    phoneNormalized: "1157571979",
    whatsappPhone: "5491157571979",
    zone: "Centro",
    category: null,
    source: "excel",
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(getDoc(doc(sellerDb, "whatsappCampaigns", "wa-1", "recipients", "recipient_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")));
});


test("reglas respetan denegación específica de envío WhatsApp", async () => {
  const database = environment.authenticatedContext("marketing-denied").firestore();
  const campaignRef = doc(database, "whatsappCampaigns", "wa-denied");
  await assertSucceeds(setDoc(campaignRef, {
    name: "Borrador restringido",
    source: "whatsapp",
    filters: {},
    message: "Hola",
    imageCount: 0,
    imageNames: [],
    imageOrder: [],
    imageMetadata: [],
    totalRecipients: 0,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "draft",
    snapshotState: "draft",
    active: true,
    deleted: false,
    createdBy: "marketing-denied",
    createdByName: "Marketing restringido",
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  await assertFails(updateDoc(campaignRef, {
    status: "running",
    lastExtensionSequence: 1,
    lastExtensionUpdateAt: new Date(),
    updatedAt: new Date(),
  }));
});
