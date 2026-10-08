import { createHash } from "node:crypto";
import { can, canAccessAdministration, normalizedRole } from "../../../../src/gestion/permissions.js";
import { isLocationActiveNow } from "../../../../src/modules/locations/domain/locations.js";
import { buildMasterProductPayload } from "../../../../src/shared/productWritePlans.mjs";
import { buildLocationStockLinePlan } from "../../../../src/shared/operationalWritePlans.mjs";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";

const key = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)\s+(cc|ml|kg|gr)\b/g, "$1$2").replace(/[^a-z0-9]+/g, " ").trim();
const digest = value => createHash("sha256").update(value).digest("hex");
const entityIdFor = name => `olivia_${digest(key(name)).slice(0, 24)}`;
const categoryKey = value => key(value).split(" ").map(word => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word).join(" ");
const productWords = value => categoryKey(value).split(" ").filter(word => !["de", "del", "la", "las", "el", "los"].includes(word));
const productKey = value => productWords(value).join(" ");
const unavailable = row => !row || row.deleted === true || row.active === false;
const clean = value => value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter(k => !k.startsWith("__")).sort().map(k => [k, clean(value[k])])) : value;
const catalogSnapshot = rows => Object.fromEntries(rows.map(row => [row.id, { name: row.name || "", abbreviation: row.abbreviation || "", active: row.active !== false, deleted: row.deleted === true }]));
const incomplete = (missing, summary, details = {}) => ({ state: "DATOS_INCOMPLETOS", missing, summary, ...details });
function requirePermission(profile, module, action, message) {
  if ((profile.permissionDeny?.[module] || []).some(value => value === action || value === "admin") || !can(profile, module, action)) throw oliviaError("permission-denied", message, 403);
}
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function generatedAbbreviation(name, occupied) {
  const stem = key(name).replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 8);
  if (!occupied.has(key(stem))) return stem;
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = stem.slice(0, 4) + digest(`${key(name)}:${attempt}`).slice(0, 4).toUpperCase();
    if (!occupied.has(key(value))) return value;
  }
  throw oliviaError("abbreviation-conflict", "No pudimos proponer una abreviación libre. Indicá otra para el producto.", 409);
}

// Pure planning: reads only. Confirmation rebuilds this plan against the
// transaction snapshot and commits catalog, stock, movements and audit together.
export async function catalogStockPlan({ session, args, store, now = new Date(), entityId = "preview", correlation = {} }) {
  const profile = { ...session.profile, id: session.uid };
  if (!profile.active || !canAccessAdministration(profile)) throw oliviaError("permission-denied", "Crear catálogo y cargar una lista requiere un administrador autorizado.", 403);
  requirePermission(profile, "locations", "loadStock", "No tenés permiso para cargar stock.");
  requirePermission(profile, "locations", "viewStock", "No tenés permiso para consultar este stock.");
  requirePermission(profile, "products", "view", "No tenés permiso para revisar el catálogo de productos.");
  if (!args.items.length) return incomplete(["items"], "Pasame los nombres y cantidades de la mercadería que recibiste.");
  if (!args.locationId) return incomplete(["locationId"], "¿En qué local querés cargar esta lista? Conservé los productos y cantidades.");
  const documents = {};
  const reads = new Map();
  const read = path => {
    if (!reads.has(path)) reads.set(path, Promise.resolve(store.get(path)).then(value => { const row = value ? { ...value, id: path.split("/").at(-1) } : null; documents[path] = row; return row; }));
    return reads.get(path);
  };
  const location = await read(`locations/${args.locationId}`);
  if (!location || !isLocationActiveNow(location, now)) throw oliviaError("location-unavailable", "Ese local no está activo para recibir mercadería. Revisá la ubicación antes de cargarla.", 409);
  const [products, categories] = await Promise.all([store.list("products"), store.list("productCategories")]);
  const occupied = new Set(products.filter(row => !row.deleted).map(row => key(row.abbreviation)).filter(Boolean));
  const missing = [], questions = [], choices = [], resolved = [];
  const freshCategories = new Map(), freshProducts = new Map();
  const writes = [];
  const audit = (id, moduleId, action, title, before, after) => ({ type: "create", path: `auditLogs/${entityId}_${action.replaceAll(".", "_")}_${id}`, data: { ...correlation, origin: "Asistente IA / Olivia", moduleId, action, title, entityId: id, userId: session.uid, userName: profile.name || "Usuario", role: normalizedRole(profile), before, after, status: "completed", createdAt: now } });
  for (const [index, item] of args.items.entries()) {
    const name = item.name.trim();
    if (!key(name)) { missing.push(`items.${index}.name`); questions.push(`el nombre del producto de la línea ${index + 1}`); continue; }
    let product;
    if (item.productId) {
      product = products.find(row => row.id === item.productId);
      if (!product) throw oliviaError("product-unavailable", `${name}: el producto elegido ya no existe. Revisá la selección.`, 409);
    } else {
      const exact = products.filter(row => productKey(row.name) === productKey(name) || key(row.abbreviation) === key(name));
      const words = productWords(name);
      const similar = exact.length ? exact : products.filter(row => {
        const target = key(row.name);
        return words.length > 1 && words.every(word => productWords(row.name).includes(word)) || Math.abs(target.length - key(name).length) <= 2 && key(name).length > 6 && distance(target, key(name)) <= 2;
      });
      if (exact.length === 1) product = exact[0];
      else if (similar.length) {
        missing.push(`items.${index}.productId`); questions.push(`cuál producto corresponde a «${name}»: ${similar.slice(0, 10).map(row => `${row.name}${unavailable(row) ? " (desactivado)" : ""}`).join(" o ")}. Si es otra presentación, indicá el nombre completo para crearla`);
        choices.push({ index, name, products: similar.slice(0, 10).map(row => ({ productId: row.id, name: row.name, available: !unavailable(row) })) });
        continue;
      }
    }
    if (product && unavailable(product)) throw oliviaError("product-inactive", `${product.name} está desactivado o dado de baja. No creamos un duplicado: revisalo en Productos.`, 409);
    if (!product) {
      requirePermission(profile, "products", "create", `Falta crear ${name}, pero tu usuario no tiene permiso para crear productos.`);
      if (item.defaultPrice == null) { missing.push(`items.${index}.defaultPrice`); questions.push(`el precio de venta de «${name}»`); }
      if (!item.categoryName?.trim()) { missing.push(`items.${index}.categoryName`); questions.push(`la categoría de «${name}»`); }
      if (item.defaultPrice == null || !item.categoryName?.trim()) continue;
      const matchingCategories = categories.filter(row => categoryKey(row.name) === categoryKey(item.categoryName));
      if (matchingCategories.length > 1) throw oliviaError("category-ambiguous", `Hay más de una categoría llamada ${item.categoryName}. Unificalas en Productos antes de esta carga.`, 409);
      let category = matchingCategories[0] || freshCategories.get(categoryKey(item.categoryName));
      if (category && unavailable(category)) throw oliviaError("category-inactive", `La categoría ${category.name} está desactivada. Revisala antes de crear productos ahí.`, 409);
      if (!category) {
        requirePermission(profile, "products", "edit", `Falta crear la categoría ${item.categoryName}, pero tu usuario no tiene permiso para administrar categorías.`);
        category = { id: entityIdFor(categoryKey(item.categoryName)), name: item.categoryName.trim(), nameKey: key(item.categoryName), active: true, deleted: false, order: 0, createdAt: now, createdBy: session.uid, updatedAt: now, updatedBy: session.uid };
        if (await read(`productCategories/${category.id}`)) throw oliviaError("category-conflict", "La categoría cambió. Volvé a preparar la lista.", 409);
        freshCategories.set(categoryKey(item.categoryName), category);
        const { id, ...data } = category;
        writes.push({ type: "create", path: `productCategories/${id}`, data }, audit(id, "products", "category.created", "Categoría creada", null, data));
      }
      product = freshProducts.get(key(name));
      if (product && (product.defaultPrice !== item.defaultPrice || product.categoryId !== category.id || item.abbreviation && key(item.abbreviation) !== key(product.abbreviation))) throw oliviaError("product-conflict", `${name} aparece repetido con precios, abreviaciones o categorías diferentes. Corregí esa línea.`, 409);
      if (!product) {
        const abbreviation = item.abbreviation?.trim().toUpperCase() || generatedAbbreviation(name, occupied);
        if (occupied.has(key(abbreviation))) throw oliviaError("abbreviation-conflict", `${name}: la abreviación ${abbreviation} ya está ocupada. Elegí otra.`, 409);
        const data = buildMasterProductPayload({ name, abbreviation, defaultPrice: item.defaultPrice, categoryId: category.id }, category.name, profile, false, now);
        product = { ...data, id: entityIdFor(name) };
        if (await read(`products/${product.id}`)) throw oliviaError("product-conflict", `${name} cambió en el catálogo. Volvé a preparar la lista.`, 409);
        occupied.add(key(abbreviation)); freshProducts.set(key(name), product);
        writes.push({ type: "create", path: `products/${product.id}`, data }, audit(product.id, "products", "product.created", "Producto creado", null, data));
      }
    }
    resolved.push({ product, quantity: item.quantity, created: freshProducts.has(key(product.name)) });
  }
  if (missing.length) return incomplete(missing, `Para completar la lista falta ${questions.join("; ")}. No se creó ni cargó nada todavía.`, { choices, newProducts: args.items.filter(item => !products.some(row => row.id === item.productId || key(row.name) === key(item.name))).map(item => ({ name: item.name, quantity: item.quantity, categoryName: item.categoryName, defaultPrice: item.defaultPrice })) });
  const grouped = new Map();
  for (const row of resolved) {
    const previous = grouped.get(row.product.id);
    const quantity = row.quantity + (previous?.quantity || 0);
    if (!Number.isSafeInteger(quantity) || quantity > 1000000) throw oliviaError("quantity-invalid", `${row.product.name}: la cantidad total supera el límite de carga.`, 422);
    grouped.set(row.product.id, { ...row, quantity });
  }
  const lines = [], operationId = `olivia_stock_${entityId}`;
  const paths = [...new Set([...grouped.values()].flatMap(row => [`locationStock/${location.id}/items/${row.product.id}`, ...(!row.created ? [`products/${row.product.id}`] : []), ...(row.product.categoryId && !freshCategories.has(categoryKey(row.product.categoryName)) ? [`productCategories/${row.product.categoryId}`] : [])]))];
  for (let offset = 0; offset < paths.length; offset += 3) await Promise.all(paths.slice(offset, offset + 3).map(read));
  for (const row of grouped.values()) {
    const path = `locationStock/${location.id}/items/${row.product.id}`;
    const existing = await read(path);
    if (existing && (unavailable(existing) || existing.productDeleted === true)) throw oliviaError("stock-inactive", `${row.product.name} está desactivado en ${location.name}. Reactivalo desde la ubicación antes de cargar stock.`, 409);
    if (!existing) requirePermission(profile, "locations", "configureLocationProducts", `Tu usuario no puede agregar ${row.product.name} a este local.`);
    if (!row.created) await read(`products/${row.product.id}`);
    if (row.product.categoryId && !freshCategories.has(categoryKey(row.product.categoryName))) await read(`productCategories/${row.product.categoryId}`);
    const plan = buildLocationStockLinePlan({ product: row.product, existing: existing || {}, mode: "add", requested: row.quantity, entry: { reason: args.reason }, operationId, location, profile, stamp: now });
    writes.push({ type: existing ? "update" : "create", path, data: plan.stockData }, { type: "create", path: `stockMovements/${plan.movementId}`, data: { ...plan.movementData, ...correlation, origin: "Asistente IA / Olivia" } });
    lines.push({ productId: row.product.id, name: row.product.name, abbreviation: row.product.abbreviation, categoryName: row.product.categoryName || "Sin categoría", price: plan.stockData.price, created: row.created, quantity: row.quantity, previousStock: plan.previousStock, newStock: plan.currentStock });
  }
  writes.push({ type: "update", path: `locations/${location.id}`, data: { stockConfiguredAt: now, updatedAt: now, updatedBy: session.uid } });
  const totalUnits = lines.reduce((sum, row) => sum + row.quantity, 0);
  const result = { operationId, locationId: location.id, locationName: location.name, mode: "add", itemCount: lines.length, totalUnits, createdProducts: freshProducts.size, createdCategories: freshCategories.size, lines, userId: session.uid, status: "completed", createdAt: now, ...correlation, origin: "Asistente IA / Olivia" };
  writes.push({ type: "create", path: `stockOperations/${operationId}`, data: result }, audit(operationId, "locations", "stock.add", "Lista de mercadería ingresada", lines.map(row => ({ productId: row.productId, currentStock: row.previousStock })), result));
  const summary = `Ingresar mercadería en ${location.name}: ${lines.length} productos, ${totalUnits} unidades. Se crearán ${freshProducts.size} productos y ${freshCategories.size} categorías${freshCategories.size ? ` (${[...freshCategories.values()].map(row => row.name).join(", ")})` : ""}.\n${lines.map(row => `${row.created ? "Crear" : "Reutilizar"} ${row.name} · ${row.abbreviation || "sin abreviación"} · ${row.categoryName} · $${row.price}: +${row.quantity} unidades; stock ${row.previousStock} → ${row.newStock}.`).join("\n")}\nSolo al tocar Sí se crea el catálogo faltante y se carga toda la lista. No publica productos en la tienda.`;
  return { toolName: "prepare_catalog_stock_load", module: "locations", canonicalArgs: args, snapshotFingerprint: digest(JSON.stringify(clean({ documents, products: catalogSnapshot(products), categories: catalogSnapshot(categories), args }))), summary, writes, navigation: null, affectedId: location.id, completedMessage: `Ingreso registrado en ${location.name}: ${totalUnits} unidades de ${lines.length} productos. Se crearon ${freshProducts.size} productos y ${freshCategories.size} categorías.` };
}
