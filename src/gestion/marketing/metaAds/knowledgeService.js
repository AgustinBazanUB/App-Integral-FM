import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";
import {
  listLocationsShared,
  listMasterProductsShared,
} from "../../services/sharedResources.js";
import {
  buildMarketingKnowledge,
  normalizeBusinessContext,
  normalizeProductMarketingProfile,
} from "./knowledgeDomain.js";

export const BUSINESS_CONTEXT_PATH = ["marketingKnowledge", "businessContext"];
export const PRODUCT_MARKETING_COLLECTION = "marketingProductProfiles";

const profileName = (profile = {}) => profile.name || profile.email || "Usuario";

function assertView(profile) {
  if (!can(profile, "marketing", "metaAdsView")) {
    const error = new Error("No tenés permiso para ver el conocimiento de Marketing.");
    error.code = "permission-denied";
    throw error;
  }
}

function assertManage(profile) {
  if (!can(profile, "marketing", "metaAdsManageKnowledge")) {
    const error = new Error("No tenés permiso para modificar el conocimiento de Marketing.");
    error.code = "permission-denied";
    throw error;
  }
}

function audit(profile, entityType, entityId, action, title, description = "") {
  return {
    action,
    title,
    description,
    moduleId: "marketing",
    entityType,
    entityId,
    userId: profile.id,
    userName: profileName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  };
}

export async function getBusinessContext(profile) {
  assertView(profile);
  const snapshot = await getDoc(doc(db, ...BUSINESS_CONTEXT_PATH));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function saveBusinessContext(profile, input) {
  assertManage(profile);
  const clean = normalizeBusinessContext(input);
  const reference = doc(db, ...BUSINESS_CONTEXT_PATH);
  const existing = await getDoc(reference);
  const batch = writeBatch(db);
  const ownership = existing.exists()
    ? {}
    : { createdBy: profile.id, createdByName: profileName(profile), createdAt: serverTimestamp() };
  batch.set(reference, {
    ...clean,
    ...ownership,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), audit(
    profile,
    "marketingBusinessContext",
    "businessContext",
    existing.exists() ? "metaAds.knowledge.business.updated" : "metaAds.knowledge.business.created",
    existing.exists() ? "Conocimiento de negocio actualizado" : "Conocimiento de negocio creado",
  ));
  await batch.commit();
  return clean;
}

export async function getProductMarketingProfile(profile, productId) {
  assertView(profile);
  if (!productId) return null;
  const snapshot = await getDoc(doc(db, PRODUCT_MARKETING_COLLECTION, productId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function saveProductMarketingProfile(profile, input) {
  assertManage(profile);
  const clean = normalizeProductMarketingProfile(input);
  const productReference = doc(db, "products", clean.productId);
  const productSnapshot = await getDoc(productReference);
  if (!productSnapshot.exists()) {
    const error = new Error("El producto ya no existe en el catálogo maestro.");
    error.code = "product-not-found";
    throw error;
  }
  const reference = doc(db, PRODUCT_MARKETING_COLLECTION, clean.productId);
  const existing = await getDoc(reference);
  const batch = writeBatch(db);
  const ownership = existing.exists()
    ? {}
    : { createdBy: profile.id, createdByName: profileName(profile), createdAt: serverTimestamp() };
  batch.set(reference, {
    ...clean,
    ...ownership,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), audit(
    profile,
    "marketingProductProfile",
    clean.productId,
    existing.exists() ? "metaAds.knowledge.product.updated" : "metaAds.knowledge.product.created",
    existing.exists() ? "Metadata de Marketing actualizada" : "Metadata de Marketing creada",
    productSnapshot.data()?.name || clean.productId,
  ));
  await batch.commit();
  return clean;
}

export async function getMarketingKnowledge(profile, { productId = null } = {}) {
  assertView(profile);
  const [businessContext, products, locations] = await Promise.all([
    getBusinessContext(profile),
    listMasterProductsShared(profile),
    listLocationsShared(profile),
  ]);
  const product = productId ? (products || []).find((item) => item.id === productId) || null : null;
  const productProfile = product ? await getProductMarketingProfile(profile, product.id) : null;
  return buildMarketingKnowledge({ businessContext, product, productProfile, locations });
}

export function marketingKnowledgeFriendlyError(error) {
  if (error?.code === "permission-denied") return "No tenés permiso para realizar esta acción.";
  if (error?.code === "product-not-found") return "El producto ya no existe en el catálogo maestro.";
  if (error?.code === "unavailable") return "No pudimos conectar con Firebase. Revisá tu conexión.";
  return error?.message || "No pudimos completar la operación.";
}
