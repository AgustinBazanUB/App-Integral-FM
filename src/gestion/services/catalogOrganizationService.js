import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";
import { can } from "../permissions";
import { invalidateRuntimeCache } from "./runtimeCache";
import { categorySubcategories, suggestSubcategory, validateSubcategories } from "../../shared/productSubcategories.mjs";

const refreshCatalog = () => ["products:", "categories:", "seller-resources:"].forEach(invalidateRuntimeCache);
const requireEdit = profile => { if (!can(profile, "products", "edit")) throw new Error("Tu usuario no puede organizar el catálogo."); };

export async function createProductSubcategory({ profile, categoryId, name, id = crypto.randomUUID() }) {
  requireEdit(profile);
  const ref = doc(db, "productCategories", categoryId);
  const result = await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().deleted === true) throw new Error("La categoría ya no está disponible.");
    const subcategories = validateSubcategories([...categorySubcategories(snapshot.data()), { id, name }]);
    transaction.update(ref, { subcategories, updatedAt: serverTimestamp(), updatedBy: profile.id });
    transaction.set(doc(collection(db, "auditLogs")), { action: "category.subcategory.created", title: "Subcategoría creada", description: `${snapshot.data().name} · ${name.trim()}`, moduleId: "products", entityType: "category", entityId: categoryId, userId: profile.id, userName: profile.name || profile.email, status: "completed", createdAt: serverTimestamp() });
    return id;
  });
  refreshCatalog();
  return result;
}

export async function organizeExistingCatalog(profile) {
  requireEdit(profile);
  const [categories, products] = await Promise.all([getDocs(collection(db, "productCategories")), getDocs(collection(db, "products"))]);
  if (categories.size + products.size > 350) throw new Error("El catálogo necesita organizarse por partes. No se hicieron cambios.");
  const count = await runTransaction(db, async transaction => {
    const categorySnapshots = await Promise.all(categories.docs.map(row => transaction.get(row.ref)));
    const productSnapshots = await Promise.all(products.docs.map(row => transaction.get(row.ref)));
    const byId = new Map(categorySnapshots.filter(row => row.exists() && row.data().deleted !== true).map(row => [row.id, row.data()]));
    let assigned = 0;
    for (const row of categorySnapshots) {
      if (!row.exists() || row.data().deleted === true || Array.isArray(row.data().subcategories)) continue;
      const subcategories = categorySubcategories(row.data());
      if (subcategories.length) transaction.update(row.ref, { subcategories, updatedAt: serverTimestamp(), updatedBy: profile.id });
    }
    for (const row of productSnapshots) {
      if (!row.exists() || row.data().deleted === true || typeof row.data().subcategoryId === "string") continue;
      const category = byId.get(row.data().categoryId);
      if (!category) continue;
      const subcategory = categorySubcategories(category).find(sub => sub.id === suggestSubcategory(row.data(), category));
      if (!subcategory) continue;
      transaction.update(row.ref, { subcategoryId: subcategory.id, subcategoryName: subcategory.name, updatedAt: serverTimestamp(), updatedBy: profile.id });
      assigned++;
    }
    transaction.set(doc(collection(db, "auditLogs")), { action: "catalog.organized", title: "Catálogo organizado en subcategorías", description: `${assigned} productos asignados. Se conservaron precios y stock.`, moduleId: "products", entityType: "catalog", entityId: "subcategories", userId: profile.id, userName: profile.name || profile.email, status: "completed", createdAt: serverTimestamp() });
    return assigned;
  });
  refreshCatalog();
  return count;
}

export async function catalogMergeRequest(payload) {
  if (!auth.currentUser) throw new Error("Iniciá sesión para unificar productos.");
  const response = await fetch("/.netlify/functions/catalog-merge", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.currentUser.getIdToken()}` }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "No se pudo unificar el producto.");
  if (payload.action === "merge") refreshCatalog();
  return data;
}
