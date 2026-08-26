import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  writeBatch,
} from "firebase/firestore";
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";
import {
  META_ADS_CAMPAIGN_CHANNEL,
  META_ADS_CAMPAIGN_SCHEMA_VERSION,
  campaignProjectEditablePatch,
  normalizeCampaignProjectInput,
} from "./campaignProjectDomain.js";

export const META_ADS_CAMPAIGN_COLLECTION = "metaCampaignProjects";
export const META_ADS_CAMPAIGN_PAGE_SIZE = 20;

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const profileName = (profile = {}) => profile.name || profile.email || "Usuario";

function assertPermission(profile, action, message) {
  if (!can(profile, "marketing", action)) throw new Error(message);
}

function projectAudit(profile, projectId, action, title, description) {
  return {
    action,
    title,
    description,
    moduleId: "marketing",
    entityType: "metaCampaignProject",
    entityId: projectId,
    userId: profile.id,
    userName: profileName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  };
}

export async function listMetaAdsCampaignProjects(profile, { pageSize = META_ADS_CAMPAIGN_PAGE_SIZE, cursor = null } = {}) {
  assertPermission(profile, "metaAdsView", "No tenés permiso para ver campañas de Meta Ads.");
  const safeSize = Math.max(1, Math.min(50, Number(pageSize) || META_ADS_CAMPAIGN_PAGE_SIZE));
  const constraints = [orderBy("updatedAt", "desc")];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(safeSize));
  const snapshot = await getDocs(query(collection(db, META_ADS_CAMPAIGN_COLLECTION), ...constraints));
  return {
    items: docsToArray(snapshot),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.docs.length === safeSize,
  };
}

export async function getMetaAdsCampaignProject(profile, campaignId) {
  assertPermission(profile, "metaAdsView", "No tenés permiso para ver campañas de Meta Ads.");
  if (!campaignId) throw new Error("La campaña no está disponible.");
  const snapshot = await getDoc(doc(db, META_ADS_CAMPAIGN_COLLECTION, campaignId));
  if (!snapshot.exists()) {
    const error = new Error("La campaña de Meta Ads no existe.");
    error.code = "not-found";
    throw error;
  }
  return { id: snapshot.id, ...snapshot.data() };
}

export async function createMetaAdsCampaignProject(profile, input) {
  assertPermission(profile, "metaAdsCreateProject", "No tenés permiso para crear campañas de Meta Ads.");
  const clean = normalizeCampaignProjectInput(input);
  const reference = doc(collection(db, META_ADS_CAMPAIGN_COLLECTION));
  const batch = writeBatch(db);
  batch.set(reference, {
    ...clean,
    channel: META_ADS_CAMPAIGN_CHANNEL,
    schemaVersion: META_ADS_CAMPAIGN_SCHEMA_VERSION,
    status: "draft",
    archived: false,
    createdBy: profile.id,
    createdByName: profileName(profile),
    createdAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "auditLogs")), projectAudit(
    profile,
    reference.id,
    "metaAds.project.created",
    "Campaña Meta Ads creada",
    clean.name,
  ));
  await batch.commit();
  return reference.id;
}

export async function updateMetaAdsCampaignProject(profile, campaign, input) {
  assertPermission(profile, "metaAdsEditProject", "No tenés permiso para editar campañas de Meta Ads.");
  if (!campaign?.id) throw new Error("La campaña no está disponible.");
  if (campaign.status !== "draft" || campaign.archived === true) {
    throw new Error("En esta etapa sólo se pueden editar campañas en borrador.");
  }
  const clean = campaignProjectEditablePatch(input);
  const batch = writeBatch(db);
  batch.set(doc(db, META_ADS_CAMPAIGN_COLLECTION, campaign.id), {
    ...clean,
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), projectAudit(
    profile,
    campaign.id,
    "metaAds.project.updated",
    "Campaña Meta Ads actualizada",
    clean.name,
  ));
  await batch.commit();
}

export async function archiveMetaAdsCampaignProject(profile, campaign) {
  assertPermission(profile, "metaAdsArchiveProject", "No tenés permiso para archivar campañas de Meta Ads.");
  if (!campaign?.id) throw new Error("La campaña no está disponible.");
  if (campaign.status !== "draft" || campaign.archived === true) {
    throw new Error("Sólo se pueden archivar campañas que todavía están en borrador.");
  }
  const batch = writeBatch(db);
  batch.set(doc(db, META_ADS_CAMPAIGN_COLLECTION, campaign.id), {
    status: "archived",
    archived: true,
    archivedAt: serverTimestamp(),
    archivedBy: profile.id,
    archivedByName: profileName(profile),
    updatedBy: profile.id,
    updatedByName: profileName(profile),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), projectAudit(
    profile,
    campaign.id,
    "metaAds.project.archived",
    "Campaña Meta Ads archivada",
    campaign.name,
  ));
  await batch.commit();
}

export function metaAdsFriendlyError(error) {
  if (error?.code === "permission-denied") return "No tenés permiso para realizar esta acción.";
  if (error?.code === "unavailable") return "No pudimos conectar con la base. Revisá tu conexión e intentá de nuevo.";
  if (error?.code === "unauthenticated") return "Tu sesión venció. Volvé a iniciar sesión.";
  if (error?.code === "not-found") return "La campaña ya no existe o no está disponible.";
  return error?.message || "No pudimos completar la operación.";
}
