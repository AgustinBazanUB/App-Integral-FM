import { createHash } from "node:crypto";

export const SOURCE_PROJECT = "fm-stock-y-venta";
export const DESTINATION_PROJECT = "app-integral-fm";
export const COLLECTIONS = ["products", "productCategories", "locations", "sales", "stockMovements", "counters", "discounts"];
const WRITABLE = new Set([...COLLECTIONS, "locationStock", "warehouseStock", "auditLogs"]);
const MIGRATION_TYPES = new Set(["legacy_migration_snapshot", "legacy_sync_snapshot"]);

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}
export const fingerprint = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const same = (left, right) => fingerprint(left ?? null) === fingerprint(right ?? null);
export const documentPath = document => document.name.split("/documents/")[1];
export const documentId = document => documentPath(document).split("/").at(-1);

export function decode(value) {
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  if ("integerValue" in value) return Number(value.integerValue);
  return value.stringValue ?? value.doubleValue ?? value.booleanValue ?? value.timestampValue ?? value.referenceValue ?? null;
}
export const decodeFields = fields => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
export function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Valor numérico inválido en la migración");
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}
export const encodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encode(value)]));

export function rebaseReferences(value) {
  if (Array.isArray(value)) return value.map(rebaseReferences);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, key === "referenceValue" && typeof nested === "string"
    ? nested.replace(`projects/${SOURCE_PROJECT}/databases/(default)/documents/`, `projects/${DESTINATION_PROJECT}/databases/(default)/documents/`)
    : rebaseReferences(nested)]));
}

export function legacyImagePath(url) {
  if (!url) return "";
  const match = String(url).match(/^\/(?:assets\/products|images\/legacy-products)\/([\w.-]+\.(?:jpg|jpeg|png|webp))$/i);
  if (!match || match[1].includes("..")) throw new Error("Ruta de imagen del origen no soportada");
  return `/images/legacy-products/${match[1]}`;
}

export function sourceDigest(snapshot) {
  return fingerprint(Object.fromEntries([...COLLECTIONS, "locationStock"].map(collection => [collection,
    (snapshot.collections[collection] || []).filter(doc => doc.fields).map(doc => [documentPath(doc), doc.fields]).sort(([a], [b]) => a.localeCompare(b)),
  ])));
}

export function mappings(source, destination) {
  const products = new Map((destination.collections.products || []).map(doc => [documentId(doc), documentId(doc)]));
  const aliases = new Map();
  for (const doc of destination.collections.products || []) {
    const original = decodeFields(doc.fields).legacySourceProductId;
    if (!original) continue;
    if (aliases.has(original) && aliases.get(original) !== documentId(doc)) throw new Error("Más de un producto destino declara el mismo ID original");
    aliases.set(original, documentId(doc));
  }
  for (const [id, alias] of aliases) products.set(id, alias);
  for (const doc of source.collections.products || []) if (!products.has(documentId(doc))) products.set(documentId(doc), documentId(doc));
  const warehouses = new Map();
  for (const doc of destination.collections.locations || []) {
    const warehouse = decodeFields(doc.fields).reclassifiedAsWarehouseId;
    if (warehouse) warehouses.set(documentId(doc), warehouse);
  }
  return { products, warehouses };
}

function mappedFields(fields, products) {
  const result = structuredClone(rebaseReferences(fields));
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    if (value.productId?.stringValue) {
      const original = value.productId.stringValue;
      const mapped = products.get(original) || original;
      if (mapped !== original) {
        value.productId = encode(mapped);
        value.legacyOriginalProductId = encode(original);
      }
    }
    for (const child of Object.values(value)) walk(child);
  }
  walk(result);
  return result;
}

export function targetStockPath(sourcePath, maps) {
  const [, location, , product] = sourcePath.split("/");
  const warehouse = maps.warehouses.get(location);
  return `${warehouse ? "warehouseStock" : "locationStock"}/${warehouse || location}/items/${maps.products.get(product) || product}`;
}

function movementStockPath(movement) {
  const type = movement.inventoryType || (movement.warehouseId ? "warehouse" : "location");
  const origin = movement.inventoryId || movement.warehouseId || movement.locationId;
  return origin && movement.productId ? `${type === "warehouse" ? "warehouseStock" : "locationStock"}/${origin}/items/${movement.productId}` : null;
}

export function reconcileStock({ sourceStock, destinationStock, seed, ownMovements }) {
  if (!Number.isInteger(sourceStock.currentStock)) throw new Error("El stock original no es entero");
  if (!destinationStock) {
    if (ownMovements.length) throw new Error("Hay movimientos propios sin saldo de stock destino");
    return { stock: sourceStock.currentStock, delta: 0 };
  }
  if (!seed) {
    if (ownMovements.length) throw new Error("No hay un snapshot que permita conservar movimientos propios");
    return { stock: sourceStock.currentStock, delta: 0 };
  }
  const later = ownMovements.filter(movement => new Date(movement.createdAt).valueOf() > new Date(seed.createdAt).valueOf());
  if (later.some(movement => !Number.isInteger(movement.qty))) throw new Error("Movimiento propio sin cantidad entera");
  const newDelta = later.reduce((sum, movement) => sum + movement.qty, 0);
  if (seed.newStock + newDelta !== destinationStock.currentStock) throw new Error("El saldo destino no concuerda con su snapshot y movimientos propios");
  const delta = Number(seed.legacyDestinationDelta || 0) + newDelta;
  return { stock: sourceStock.currentStock + delta, delta };
}

export function validateOperation(operation) {
  const pieces = operation.path.split("/");
  if (!WRITABLE.has(pieces[0]) || pieces.some(piece => !piece || piece === "." || piece === "..") || pieces.length % 2 !== 0) throw new Error("Colección o ruta fuera del alcance autorizado");
  if (["locationStock", "warehouseStock"].includes(pieces[0]) && (pieces.length !== 4 || pieces[2] !== "items")) throw new Error("Ruta de stock inválida");
  if (!operation.precondition || (!operation.precondition.updateTime && operation.precondition.exists !== false)) throw new Error("Escritura sin protección contra concurrencia");
  if (operation.updateMask && !same([...operation.updateMask].sort(), Object.keys(operation.fields).sort())) throw new Error("Máscara de actualización inconsistente");
  if (pieces[0] === "sales" && Object.keys(operation.fields).some(key => /^(fiscal|invoice|arca|cae)/i.test(key))) throw new Error("La migración no escribe datos fiscales");
  return operation;
}

export function buildPlan(source, destination, { operationId, now = new Date().toISOString() }) {
  if (source.project !== SOURCE_PROJECT || destination.project !== DESTINATION_PROJECT) throw new Error("Origen/destino inesperados");
  if (!/^[a-zA-Z0-9_-]+$/.test(operationId)) throw new Error("ID de operación inválido");
  const maps = mappings(source, destination);
  const target = new Map(Object.values(destination.collections).flat().filter(doc => doc.fields).map(doc => [documentPath(doc), doc]));
  const groups = [], conflicts = [], warnings = [];
  const stats = { created: {}, updated: {}, retainedOwnSales: 0, archivedOwnSales: 0, negativeStocks: 0, stockWithOwnDelta: 0, adaptedSaleReferences: 0 };
  const timestamp = { timestampValue: now };
  const metadata = { legacySourceProject: encode(SOURCE_PROJECT), legacyImportedAt: timestamp, legacyMigrationOperationId: encode(operationId) };
  function operation(path, fields) {
    const current = target.get(path);
    return validateOperation({ path, fields, precondition: current ? { updateTime: current.updateTime } : { exists: false } });
  }
  function add(path, fields, extra = []) {
    const existing = target.get(path);
    if (existing && same(existing.fields, fields)) return;
    const collection = path.split("/")[0];
    const bucket = existing ? stats.updated : stats.created;
    bucket[collection] = (bucket[collection] || 0) + 1;
    groups.push({ id: path, operations: [operation(path, fields), ...extra] });
  }
  function mergePatch(path, patch) {
    const existing = target.get(path);
    const differences = Object.fromEntries(Object.entries(patch).filter(([key, value]) => !same(existing?.fields?.[key], value)));
    if (!Object.keys(differences).length) return;
    add(path, { ...existing?.fields, ...differences });
  }
  const sourceSales = new Set(source.collections.sales.map(documentId));
  const ownSales = destination.collections.sales.filter(doc => !sourceSales.has(documentId(doc)));
  stats.archivedOwnSales = ownSales.filter(doc => decodeFields(doc.fields).deleted === true).length;
  stats.retainedOwnSales = ownSales.length - stats.archivedOwnSales;

  for (const collection of ["productCategories", "locations", "discounts"]) for (const doc of source.collections[collection]) {
    const path = documentPath(doc), current = target.get(path);
    if (!current) add(path, { ...rebaseReferences(doc.fields), ...metadata });
    else if (collection === "discounts" && !Object.entries(doc.fields).every(([key, value]) => same(value, current.fields[key]))) {
      if (new Date(decodeFields(doc.fields).updatedAt) > new Date(decodeFields(current.fields).updatedAt)) mergePatch(path, rebaseReferences(doc.fields));
      else warnings.push({ path, reason: "Se conserva configuración destino" });
    }
  }
  for (const doc of source.collections.products) {
    const original = documentId(doc), id = maps.products.get(original), path = `products/${id}`;
    const product = decodeFields(doc.fields), current = target.get(path), currentProduct = decodeFields(current?.fields);
    const patch = {};
    for (const key of ["imageUrl", "thumbUrl"]) {
      if (product[key] && (!currentProduct[key] || /^\/(assets\/products|images\/legacy-products)\//.test(currentProduct[key]))) patch[key] = encode(legacyImagePath(product[key]));
    }
    if (product.description && !currentProduct.description) patch.description = doc.fields.description;
    if (!current) add(path, { ...rebaseReferences(doc.fields), ...patch, ...metadata, legacySourceProductId: encode(original) });
    else mergePatch(path, patch);
  }

  for (const doc of source.collections.sales) {
    const path = documentPath(doc), current = target.get(path);
    const sale = decodeFields(doc.fields);
    if (!target.has(`locations/${sale.locationId}`) && !source.collections.locations.some(location => documentId(location) === sale.locationId)) conflicts.push({ path, reason: "Venta sin ubicación original" });
    if ((sale.items || []).some(item => !maps.products.has(item.productId))) conflicts.push({ path, reason: "Venta sin producto original" });
    const mapped = mappedFields(doc.fields, maps.products);
    if (!current) add(path, { ...mapped, ...metadata, legacySourceSaleId: encode(documentId(doc)) });
    else {
      const expectedItems = mapped.items;
      const originalItems = doc.fields.items;
      const compatible = Object.entries(doc.fields).every(([key, value]) => same(current.fields[key], key === "items" ? expectedItems : value) || (key === "items" && same(current.fields[key], originalItems)));
      if (!compatible) conflicts.push({ path, reason: "Venta existente modificada: se conserva y requiere revisión" });
      else if (!same(current.fields.items, expectedItems)) {
        // Sólo la referencia al alias; importes, fechas y cualquier campo fiscal se conservan.
        if (Object.keys(current.fields).some(key => /^(fiscal|invoice|arca|cae)/i.test(key))) conflicts.push({ path, reason: "Venta fiscal existente requiere revisión de referencias" });
        else { mergePatch(path, { items: expectedItems }); stats.adaptedSaleReferences++; }
      }
    }
  }

  for (const doc of source.collections.stockMovements) {
    const path = documentPath(doc);
    if (target.has(path)) continue;
    const fields = mappedFields(doc.fields, maps.products);
    const movement = decodeFields(fields);
    if (maps.warehouses.has(movement.locationId)) {
      fields.warehouseId = encode(maps.warehouses.get(movement.locationId));
      fields.inventoryType = encode("warehouse");
      fields.inventoryId = fields.warehouseId;
    }
    add(path, { ...fields, ...metadata, legacySourceMovementId: encode(documentId(doc)) });
  }

  for (const doc of source.collections.counters) {
    const path = documentPath(doc), current = target.get(path);
    const sourceNumber = Number(decodeFields(doc.fields).lastNumber);
    const currentNumber = Number(decodeFields(current?.fields).lastNumber || 0);
    if (!Number.isInteger(sourceNumber) || sourceNumber < 0) { conflicts.push({ path, reason: "Contador inválido" }); continue; }
    if (!current) add(path, { ...doc.fields });
    else if (sourceNumber > currentNumber) mergePatch(path, { lastNumber: encode(sourceNumber) });
  }

  const sourceMovementIds = new Set(source.collections.stockMovements.map(documentId));
  const seeds = new Map(), ownByStock = new Map();
  for (const doc of destination.collections.stockMovements) {
    const movement = decodeFields(doc.fields), key = movementStockPath(movement);
    if (!key) continue;
    if (MIGRATION_TYPES.has(movement.type)) {
      if (!seeds.has(key) || new Date(movement.createdAt) > new Date(seeds.get(key).createdAt)) seeds.set(key, movement);
    } else if (!sourceMovementIds.has(documentId(doc)) && movement.legacySourceProject !== SOURCE_PROJECT) {
      ownByStock.set(key, [...(ownByStock.get(key) || []), movement]);
    }
  }
  for (const doc of source.collections.locationStock) {
    const sourcePath = documentPath(doc), path = targetStockPath(sourcePath, maps);
    const sourceStock = decodeFields(doc.fields), current = target.get(path), currentStock = current ? decodeFields(current.fields) : null;
    const [, sourceLocation, , originalProduct] = sourcePath.split("/");
    const productId = maps.products.get(originalProduct), warehouse = path.startsWith("warehouseStock/");
    if (!productId) { conflicts.push({ path, reason: "Stock sin producto maestro" }); continue; }
    let reconciled;
    try { reconciled = reconcileStock({ sourceStock, destinationStock: currentStock, seed: seeds.get(path), ownMovements: ownByStock.get(path) || [] }); }
    catch (error) { conflicts.push({ path, reason: error.message }); continue; }
    if (reconciled.stock < 0) { stats.negativeStocks++; warnings.push({ path, reason: "Saldo negativo del origen conservado; requiere conteo físico" }); }
    if (reconciled.delta !== 0) stats.stockWithOwnDelta++;
    const values = {
      productId, productName: sourceStock.productName || "Producto", abbreviation: sourceStock.abbreviation || "",
      categoryId: sourceStock.categoryId || "", categoryName: sourceStock.categoryName || "",
      imageUrl: legacyImagePath(sourceStock.imageUrl), thumbUrl: legacyImagePath(sourceStock.thumbUrl || sourceStock.imageUrl),
      currentStock: reconciled.stock, initialStock: sourceStock.initialStock ?? 0,
      active: sourceStock.active !== false, deleted: sourceStock.deleted === true, productDeleted: sourceStock.productDeleted === true,
      yellowAlertQty: sourceStock.yellowAlertQty || 0, redAlertQty: sourceStock.redAlertQty || 0,
      legacySourceLocationId: sourceLocation, legacySourceProductId: originalProduct,
    };
    if (!warehouse) Object.assign(values, { priceMode: sourceStock.price == null ? "default" : "custom", priceOverride: sourceStock.price ?? null, price: sourceStock.price ?? 0 });
    const patch = encodeFields(values);
    const seed = seeds.get(path);
    const configAudits = (destination.collections.auditLogs || []).map(audit => decodeFields(audit.fields)).filter(audit =>
      seed && new Date(audit.createdAt) > new Date(seed.createdAt) && audit.locationId === sourceLocation && audit.entityId === productId && /product|inventory.*settings/i.test(audit.action || ""));
    if (configAudits.length) {
      for (const key of ["active", "deleted", "priceMode", "price", "priceOverride", "yellowAlertQty", "redAlertQty"]) if (current?.fields[key]) patch[key] = current.fields[key];
      warnings.push({ path, reason: "Se conserva configuración propia posterior al snapshot" });
    }
    const differs = Object.entries(patch).some(([key, value]) => !same(current?.fields[key], value));
    if (!differs) continue;
    const stockFields = { ...(!current ? rebaseReferences(doc.fields) : current.fields), ...patch, updatedAt: timestamp, legacySyncOperationId: encode(operationId) };
    if (warehouse) for (const key of ["price", "priceMode", "priceOverride", "masterDefaultPrice"]) delete stockFields[key];
    const snapshotId = `legacy_sync_${fingerprint(`${operationId}|${path}`).slice(0,32)}`;
    const snapshotFields = encodeFields({
      type: "legacy_sync_snapshot", inventoryType: warehouse ? "warehouse" : "location", inventoryId: path.split("/")[1],
      ...(warehouse ? { warehouseId: path.split("/")[1] } : { locationId: sourceLocation }), productId,
      productName: values.productName, previousStock: currentStock?.currentStock ?? null, newStock: reconciled.stock,
      qty: reconciled.stock - (currentStock?.currentStock || 0), legacySourceReportedStock: sourceStock.currentStock,
      legacyDestinationDelta: reconciled.delta, legacySourceProject: SOURCE_PROJECT, legacySourceLocationId: sourceLocation,
      legacySourceProductId: originalProduct, reason: "Sincronización histórica: saldo del origen más movimientos propios conservados",
      operationId, userId: "legacy-data-migration", userName: "Migración sistema anterior", saleId: "", createdAt: new Date(now),
    });
    add(path, stockFields, [operation(`stockMovements/${snapshotId}`, snapshotFields)]);
  }
  if (groups.length) {
    const auditPath = `auditLogs/${operationId}`;
    const auditFields = encodeFields({ action: "inventory.legacyMigration", moduleId: "locations", entityType: "migration", entityId: operationId,
      userId: "legacy-data-migration", userName: "Migración sistema anterior", title: "Histórico de FM Stock y Ventas importado",
      description: "Ventas, catálogo y saldos importados sin ejecutar operaciones de venta ni emisión fiscal.",
      status: "completed", sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT, stats, createdAt: new Date(now) });
    groups.push({ id: auditPath, operations: [operation(auditPath, auditFields)] });
  }
  return { version: 1, operationId, createdAt: now, sourceDigest: sourceDigest(source), sourceProject: SOURCE_PROJECT, destinationProject: DESTINATION_PROJECT, mappings: { products: Object.fromEntries(maps.products), warehouses: Object.fromEntries(maps.warehouses) }, stats, conflicts, warnings, groups };
}
