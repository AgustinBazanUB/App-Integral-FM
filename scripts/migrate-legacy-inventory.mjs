import process from "node:process";
import crypto from "node:crypto";
import { cert, deleteApp as deleteAdminApp, initializeApp as initializeAdminApp } from "firebase-admin/app";
import { FieldValue, getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { initializeApp as initializeClientApp, deleteApp as deleteClientApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, getDocs, getFirestore as getClientFirestore } from "firebase/firestore";

const LEGACY_PROJECT_ID = "fm-stock-y-venta";
const TARGET_PROJECT_ID = "app-integral-fm";
const MIGRATION_ID = "legacy-fm-stock-y-venta-20260923";
const ACTOR_ID = "github-legacy-inventory-migration";
const ACTOR_NAME = "Migración sistema anterior";

const legacyWebConfig = {
  apiKey: "AIzaSyD-GEqaTJZKXyKa7fUBbXa0Cigit7qZyio",
  authDomain: "fm-stock-y-venta.firebaseapp.com",
  projectId: LEGACY_PROJECT_ID,
  storageBucket: "fm-stock-y-venta.firebasestorage.app",
  messagingSenderId: "334694189931",
  appId: "1:334694189931:web:6f75a7f73e2eacd3675a2e",
};

const strip = (value) => String(value ?? "").trim();
const norm = (value) => strip(value)
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase("es")
  .replace(/[^a-z0-9]+/g, "");
const int = (value, fallback = 0) => Number.isInteger(Number(value)) ? Number(value) : fallback;
const nonNegative = (value, fallback = 0) => Math.max(0, int(value, fallback));
const rewriteAsset = (value) => strip(value).replace(/^\/assets\/products\//, "/images/legacy-products/");
const now = () => FieldValue.serverTimestamp();

function parseServiceAccount(raw, label) {
  if (!strip(raw)) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) throw new Error("campos incompletos");
    return parsed;
  } catch (error) {
    throw new Error(label + " no contiene un JSON de service account válido: " + error.message);
  }
}

async function buildLegacyReader() {
  const serviceAccount = parseServiceAccount(process.env.LEGACY_SA_JSON, "LEGACY_SA_JSON");
  if (serviceAccount) {
    const app = initializeAdminApp({ credential: cert(serviceAccount), projectId: LEGACY_PROJECT_ID }, "legacy-admin-" + crypto.randomUUID());
    const db = getAdminFirestore(app);
    return {
      mode: "service-account",
      async list(parts) {
        let ref = db.collection(parts[0]);
        for (let i = 1; i < parts.length; i += 2) ref = ref.doc(parts[i]).collection(parts[i + 1]);
        const snapshot = await ref.get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      },
      close: () => deleteAdminApp(app),
    };
  }

  const email = strip(process.env.LEGACY_ADMIN_EMAIL);
  const password = String(process.env.LEGACY_ADMIN_PASSWORD || "");
  if (email && password) {
    const app = initializeClientApp(legacyWebConfig, "legacy-client-" + crypto.randomUUID());
    const auth = getAuth(app);
    await signInWithEmailAndPassword(auth, email, password);
    const db = getClientFirestore(app);
    return {
      mode: "email-password",
      async list(parts) {
        const snapshot = await getDocs(collection(db, ...parts));
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      },
      close: () => deleteClientApp(app),
    };
  }
  return null;
}

function buildTargetDb() {
  const serviceAccount = parseServiceAccount(process.env.TARGET_SA_JSON, "TARGET_SA_JSON");
  if (!serviceAccount) throw new Error("Falta TARGET_SA_JSON para escribir en app-integral-fm.");
  const app = initializeAdminApp({ credential: cert(serviceAccount), projectId: TARGET_PROJECT_ID }, "target-admin-" + crypto.randomUUID());
  return { app, db: getAdminFirestore(app) };
}

async function listTarget(db, collectionName) {
  const snapshot = await db.collection(collectionName).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function chooseExisting(source, targets, fields, legacyField) {
  const legacy = targets.find((target) => strip(target[legacyField]) === source.id);
  if (legacy) return legacy;
  const sameId = targets.find((target) => target.id === source.id);
  if (sameId) {
    const a = fields.map((field) => norm(source[field])).filter(Boolean);
    const b = fields.map((field) => norm(sameId[field])).filter(Boolean);
    if (!a.length || a.some((value) => b.includes(value))) return sameId;
  }
  for (const field of fields) {
    const value = norm(source[field]);
    if (!value) continue;
    const same = targets.find((target) => norm(target[field]) === value);
    if (same) return same;
  }
  return null;
}

function classifyInventoryPoint(location) {
  const raw = ((location.name || "") + " " + (location.type || "") + " " + (location.kind || ""))
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
  const warehouseToken = /(^|[^a-z0-9])(deposito|deposit|depo|warehouse|almacen|storage)([^a-z0-9]|$)/.test(raw);
  return warehouseToken ? "warehouse" : "location";
}

function canonicalWarehouseName(value) {
  const raw = strip(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return raw
    .replace(/^depo\b/, "deposito")
    .replace(/^deposit\b/, "deposito")
    .replace(/^warehouse\b/, "deposito")
    .replace(/^almacen\b/, "deposito")
    .replace(/^storage\b/, "deposito")
    .replace(/[^a-z0-9]+/g, "");
}

function locationType(source) {
  const raw = norm(source.type || source.locationType || "");
  if (raw.includes("feria") || raw.includes("fair")) return "fair";
  if (raw.includes("evento") || raw.includes("event")) return "event";
  return "local";
}

function safePrefix(source) {
  const raw = strip(source.codePrefix || source.prefix || source.name)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
  return (raw || "LEG").slice(0, 8);
}

async function run() {
  const allowMissingSource = process.argv.includes("--allow-missing-source");
  const legacy = await buildLegacyReader();
  if (!legacy) {
    const message = "MIGRATION_SKIPPED_NO_SOURCE_AUTH: falta credencial de lectura para fm-stock-y-venta. Configurar FIREBASE_SERVICE_ACCOUNT_FM_STOCK_Y_VENTA o FM_STOCK_ADMIN_EMAIL + FM_STOCK_ADMIN_PASSWORD en GitHub Secrets.";
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(process.env.GITHUB_STEP_SUMMARY, "### Migración de inventario\n\n⚠️ " + message + "\n");
    }
    if (!allowMissingSource) process.exitCode = 2;
    return;
  }

  const { app: targetApp, db: targetDb } = buildTargetDb();
  try {
    console.log("Legacy auth:", legacy.mode);
    const [sourceProducts, sourceCategories, sourceLocations, targetProductsInitial, targetCategoriesInitial, targetLocationsInitial, targetWarehousesInitial] =
      await Promise.all([
        legacy.list(["products"]),
        legacy.list(["productCategories"]).catch(() => []),
        legacy.list(["locations"]),
        listTarget(targetDb, "products"),
        listTarget(targetDb, "productCategories"),
        listTarget(targetDb, "locations"),
        listTarget(targetDb, "warehouses"),
      ]);

    const sourceStockByLocation = new Map();
    for (const location of sourceLocations) {
      sourceStockByLocation.set(location.id, await legacy.list(["locationStock", location.id, "items"]));
    }

    console.log("LEGACY_INVENTORY_POINTS", JSON.stringify(sourceLocations.map((location) => ({
      id: location.id,
      name: location.name || "",
      type: location.type || "",
      kind: location.kind || "",
      classifiedAs: classifyInventoryPoint(location),
      stockItems: (sourceStockByLocation.get(location.id) || []).filter((item) => item.deleted !== true).length,
    }))));

    const stats = {
      sourceProducts: sourceProducts.length,
      productsCreated: 0,
      productsUpdated: 0,
      categoriesCreated: 0,
      locationsCreated: 0,
      warehousesCreated: 0,
      locationStockItems: 0,
      warehouseStockItems: 0,
      stockUnits: 0,
    };

    const targetCategories = [...targetCategoriesInitial];
    const categoryMap = new Map();
    for (const source of sourceCategories.filter((item) => item.deleted !== true)) {
      let target = chooseExisting(source, targetCategories, ["name"], "legacySourceCategoryId");
      if (!target) {
        const targetId = targetCategories.some((item) => item.id === source.id) ? "legacy_" + source.id : source.id;
        const payload = {
          name: strip(source.name) || "Sin categoría",
          description: strip(source.description),
          sortOrder: int(source.sortOrder, 0),
          active: source.active !== false,
          deleted: false,
          legacySourceCategoryId: source.id,
          updatedAt: now(),
          updatedBy: ACTOR_ID,
          updatedByName: ACTOR_NAME,
          createdAt: now(),
          createdBy: ACTOR_ID,
          createdByName: ACTOR_NAME,
        };
        await targetDb.collection("productCategories").doc(targetId).set(payload, { merge: true });
        target = { id: targetId, ...payload };
        targetCategories.push(target);
        stats.categoriesCreated += 1;
      }
      categoryMap.set(source.id, target.id);
    }

    const targetProducts = [...targetProductsInitial];
    const productMap = new Map();
    for (const source of sourceProducts.filter((item) => item.deleted !== true)) {
      const code = strip(source.productCode || source.abbreviation).toUpperCase();
      const normalizedSource = { ...source, productCode: code, abbreviation: code };
      const normalizedTargets = targetProducts.map((item) => ({ ...item, productCode: item.productCode || item.abbreviation }));
      let target = chooseExisting(normalizedSource, normalizedTargets, ["productCode", "abbreviation", "name"], "legacySourceProductId");
      const targetId = target ? target.id : (targetProducts.some((item) => item.id === source.id) ? "legacy_" + source.id : source.id);
      const targetCategoryId = categoryMap.get(source.categoryId) || target?.categoryId || "";
      const targetCategory = targetCategories.find((item) => item.id === targetCategoryId);
      const payload = {
        name: strip(source.name || source.productName) || "Producto sin nombre",
        nameKey: norm(source.name || source.productName),
        productCode: code,
        productCodeKey: norm(code),
        abbreviation: code,
        abbreviationKey: norm(code),
        description: strip(source.description),
        defaultPrice: nonNegative(source.defaultPrice ?? source.price, target?.defaultPrice ?? 0),
        yellowAlertQty: nonNegative(source.yellowAlertQty, target?.yellowAlertQty ?? 0),
        redAlertQty: nonNegative(source.redAlertQty, target?.redAlertQty ?? 0),
        categoryId: targetCategoryId,
        categoryName: targetCategory?.name || strip(source.categoryName) || "Sin categoría",
        imageUrl: rewriteAsset(source.imageUrl) || target?.imageUrl || "",
        thumbUrl: rewriteAsset(source.thumbUrl || source.imageUrl) || target?.thumbUrl || "",
        imageAlt: strip(source.imageAlt) || strip(source.name) || target?.imageAlt || "",
        imageStatus: source.imageStatus || target?.imageStatus || "available",
        originalImageFileName: strip(source.originalImageFileName) || strip(source.imageUrl).split("/").pop() || "",
        buttonKey: strip(source.buttonKey),
        buttonCode: strip(source.buttonCode),
        buttonLocation: int(source.buttonLocation, 0),
        buttonLabel: strip(source.buttonLabel || source.buttonKey),
        active: source.active !== false,
        deleted: false,
        legacySourceProductId: source.id,
        legacyMigratedAt: now(),
        updatedAt: now(),
        updatedBy: ACTOR_ID,
        updatedByName: ACTOR_NAME,
        ...(target ? {} : { createdAt: now(), createdBy: ACTOR_ID, createdByName: ACTOR_NAME }),
      };
      await targetDb.collection("products").doc(targetId).set(payload, { merge: true });
      productMap.set(source.id, targetId);
      if (target) {
        stats.productsUpdated += 1;
        const original = targetProducts.find((item) => item.id === target.id);
        if (original) Object.assign(original, payload);
      } else {
        stats.productsCreated += 1;
        target = { id: targetId, ...payload };
        targetProducts.push(target);
      }
    }

    const targetLocations = [...targetLocationsInitial];
    const targetWarehouses = [...targetWarehousesInitial];
    const pointMap = new Map();

    for (const source of sourceLocations.filter((item) => item.deleted !== true)) {
      const kind = classifyInventoryPoint(source);
      if (kind === "warehouse") {
        let target = chooseExisting(source, targetWarehouses, ["name"], "legacySourceLocationId");
        if (!target) {
          const canonicalSourceName = canonicalWarehouseName(source.name);
          target = targetWarehouses.find((item) => canonicalWarehouseName(item.name) === canonicalSourceName) || null;
        }
        const targetId = target ? target.id : (targetWarehouses.some((item) => item.id === source.id) ? "legacy_" + source.id : source.id);
        const payload = {
          name: strip(source.name) || "Depósito",
          description: strip(source.description) || "Importado desde FM Stock y Ventas.",
          address: strip(source.address),
          active: source.active !== false,
          deleted: false,
          legacySourceLocationId: source.id,
          legacyMigratedAt: now(),
          updatedAt: now(),
          updatedBy: ACTOR_ID,
          updatedByName: ACTOR_NAME,
          ...(target ? {} : { createdAt: now(), createdBy: ACTOR_ID, createdByName: ACTOR_NAME }),
        };
        await targetDb.collection("warehouses").doc(targetId).set(payload, { merge: true });
        if (!target) {
          target = { id: targetId, ...payload };
          targetWarehouses.push(target);
          stats.warehousesCreated += 1;
        }

        // Si una corrida anterior importó este depósito por error como ubicación,
        // se archiva esa ubicación migrada y se neutraliza su stock para evitar duplicación.
        const misclassifiedLocation = targetLocations.find((item) => item.legacySourceLocationId === source.id);
        if (misclassifiedLocation) {
          await targetDb.collection("locations").doc(misclassifiedLocation.id).set({
            active: false,
            deleted: true,
            deletedAt: now(),
            deletedBy: ACTOR_ID,
            deletedByName: ACTOR_NAME,
            reclassifiedAsWarehouseId: targetId,
            reclassifiedAt: now(),
            updatedAt: now(),
            updatedBy: ACTOR_ID,
            updatedByName: ACTOR_NAME,
          }, { merge: true });
          const wrongStockSnapshot = await targetDb.collection("locationStock").doc(misclassifiedLocation.id).collection("items").get();
          for (const wrongStockDoc of wrongStockSnapshot.docs) {
            await wrongStockDoc.ref.set({
              active: false,
              deleted: true,
              currentStock: 0,
              reclassifiedAsWarehouseId: targetId,
              reclassifiedAt: now(),
              updatedAt: now(),
              updatedBy: ACTOR_ID,
            }, { merge: true });
          }
        }

        pointMap.set(source.id, { kind, id: targetId, name: payload.name });
      } else {
        let target = chooseExisting(source, targetLocations, ["name", "codePrefix"], "legacySourceLocationId");
        const targetId = target ? target.id : (targetLocations.some((item) => item.id === source.id) ? "legacy_" + source.id : source.id);
        if (!target) {
          const payload = {
            name: strip(source.name) || "Ubicación",
            type: locationType(source),
            codePrefix: safePrefix(source),
            dniMode: source.dniMode || "none",
            active: source.active !== false,
            deleted: false,
            assignedSellerIds: [],
            enabledDiscountIds: [],
            legacySourceLocationId: source.id,
            legacyMigratedAt: now(),
            createdAt: now(),
            createdBy: ACTOR_ID,
            createdByName: ACTOR_NAME,
            updatedAt: now(),
            updatedBy: ACTOR_ID,
            updatedByName: ACTOR_NAME,
          };
          await targetDb.collection("locations").doc(targetId).set(payload, { merge: true });
          target = { id: targetId, ...payload };
          targetLocations.push(target);
          stats.locationsCreated += 1;
        } else {
          await targetDb.collection("locations").doc(targetId).set({
            legacySourceLocationId: source.id,
            legacyMigratedAt: now(),
            updatedAt: now(),
          }, { merge: true });
        }
        pointMap.set(source.id, { kind, id: targetId, name: target.name || source.name });
      }
    }

    for (const sourceLocation of sourceLocations) {
      const point = pointMap.get(sourceLocation.id);
      if (!point) continue;
      for (const item of (sourceStockByLocation.get(sourceLocation.id) || []).filter((stock) => stock.deleted !== true)) {
        const targetProductId = productMap.get(item.productId || item.id);
        if (!targetProductId) {
          console.warn("Stock omitido: producto sin mapeo", item.id, item.productName);
          continue;
        }
        const product = targetProducts.find((entry) => entry.id === targetProductId) || {};
        const currentStock = int(item.currentStock, 0);
        const initialStock = int(item.initialStock, currentStock);
        const base = {
          productId: targetProductId,
          productName: product.name || strip(item.productName),
          productCode: product.productCode || product.abbreviation || strip(item.productCode || item.abbreviation),
          abbreviation: product.productCode || product.abbreviation || strip(item.productCode || item.abbreviation),
          categoryId: product.categoryId || strip(item.categoryId),
          categoryName: product.categoryName || strip(item.categoryName) || "Sin categoría",
          imageUrl: product.imageUrl || rewriteAsset(item.imageUrl),
          thumbUrl: product.thumbUrl || rewriteAsset(item.thumbUrl || item.imageUrl),
          initialStock,
          currentStock,
          active: item.active !== false,
          deleted: false,
          productDeleted: false,
          legacySourceLocationId: sourceLocation.id,
          legacySourceProductId: item.productId || item.id,
          legacyMigratedAt: now(),
          updatedAt: now(),
          updatedBy: ACTOR_ID,
        };

        if (point.kind === "warehouse") {
          await targetDb.collection("warehouseStock").doc(point.id).collection("items").doc(targetProductId).set(base, { merge: true });
          stats.warehouseStockItems += 1;
        } else {
          const defaultPrice = nonNegative(product.defaultPrice, 0);
          const sourcePrice = nonNegative(item.price ?? item.priceOverride ?? defaultPrice, defaultPrice);
          const useDefault = sourcePrice === defaultPrice;
          await targetDb.collection("locationStock").doc(point.id).collection("items").doc(targetProductId).set({
            ...base,
            priceMode: useDefault ? "default" : "custom",
            priceOverride: useDefault ? null : sourcePrice,
            price: sourcePrice,
            masterDefaultPrice: defaultPrice,
            yellowAlertQty: nonNegative(item.yellowAlertQty, product.yellowAlertQty ?? 0),
            redAlertQty: nonNegative(item.redAlertQty, product.redAlertQty ?? 0),
          }, { merge: true });
          stats.locationStockItems += 1;
        }
        stats.stockUnits += currentStock;

        const movementId = ["legacy", point.kind, sourceLocation.id, item.productId || item.id]
          .join("_").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 140);
        await targetDb.collection("stockMovements").doc(movementId).set({
          operationId: MIGRATION_ID,
          inventoryType: point.kind,
          inventoryId: point.id,
          ...(point.kind === "warehouse" ? { warehouseId: point.id, warehouseName: point.name } : { locationId: point.id, locationName: point.name }),
          productId: targetProductId,
          productName: product.name || strip(item.productName),
          type: "legacy_migration_snapshot",
          qty: currentStock,
          requestedQty: currentStock,
          previousStock: null,
          newStock: currentStock,
          reason: "Copia exacta del stock del sistema FM Stock y Ventas",
          userId: ACTOR_ID,
          userName: ACTOR_NAME,
          saleId: "",
          transferId: "",
          createdAt: now(),
          legacySourceLocationId: sourceLocation.id,
          legacySourceProductId: item.productId || item.id,
        }, { merge: true });
      }
    }

    await targetDb.collection("inventoryMigrations").doc(MIGRATION_ID).set({
      migrationId: MIGRATION_ID,
      sourceProjectId: LEGACY_PROJECT_ID,
      targetProjectId: TARGET_PROJECT_ID,
      sourceAuthMode: legacy.mode,
      status: "completed",
      stats,
      updatedAt: now(),
      completedAt: now(),
    }, { merge: true });

    await targetDb.collection("auditLogs").doc(MIGRATION_ID).set({
      action: "inventory.legacyMigration",
      title: "Stock importado del sistema anterior",
      description: stats.locationStockItems + " items en ubicaciones y " + stats.warehouseStockItems + " items en depósitos",
      moduleId: "products",
      entityType: "inventoryMigration",
      entityId: MIGRATION_ID,
      userId: ACTOR_ID,
      userName: ACTOR_NAME,
      status: "completed",
      createdAt: now(),
      stats,
    }, { merge: true });

    console.log("MIGRATION_COMPLETED", JSON.stringify(stats));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        "### Migración de inventario\n\n✅ Completada desde fm-stock-y-venta hacia app-integral-fm.\n\n" +
        "- Productos fuente: " + stats.sourceProducts + "\n" +
        "- Productos creados: " + stats.productsCreated + "\n" +
        "- Productos actualizados: " + stats.productsUpdated + "\n" +
        "- Ubicaciones creadas: " + stats.locationsCreated + "\n" +
        "- Depósitos creados/reclasificados: " + stats.warehousesCreated + "\n" +
        "- Items de stock en ubicaciones: " + stats.locationStockItems + "\n" +
        "- Items de stock en depósitos: " + stats.warehouseStockItems + "\n" +
        "- Unidades copiadas: " + stats.stockUnits + "\n");
    }
  } finally {
    await legacy.close();
    await deleteAdminApp(targetApp);
  }
}

run().catch((error) => {
  console.error("MIGRATION_FAILED", error?.stack || error?.message || error);
  process.exitCode = 1;
});
