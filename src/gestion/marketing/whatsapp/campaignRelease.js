import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { can } from "../../permissions.js";
import { db } from "../../services/firebase.js";

function profileName(profile = {}) {
  return profile.name || profile.email || "Usuario";
}

function canCancel(profile) {
  return can(profile, "marketing", "whatsappCancelCampaign");
}

export async function archiveReleasedCampaign(profile, campaignId, { reason = "extension_released" } = {}) {
  if (!canCancel(profile)) throw new Error("No tenés permiso para cancelar campañas.");
  if (!campaignId) throw new Error("La campaña no está disponible.");

  const campaignRef = doc(db, "whatsappCampaigns", campaignId);
  const eventRef = doc(collection(db, "whatsappCampaigns", campaignId, "events"));
  const auditRef = doc(collection(db, "auditLogs"));

  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(campaignRef);
    if (!snapshot.exists()) return { ignored: true, status: "cancelled", emitterReleased: true };

    const current = snapshot.data();
    if (current.status === "cancelled") {
      return { ignored: true, status: "cancelled", emitterReleased: true };
    }

    // Esta escritura usa deliberadamente sólo los campos de cancelación que las
    // reglas Firestore ya desplegadas aceptan. La extensión ya liberó el emisor;
    // Firebase sólo debe sacar el registro histórico de la cola activa.
    transaction.set(campaignRef, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledBy: profile.id,
      finishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    transaction.set(eventRef, {
      type: "cancelled",
      label: "Campaña cancelada",
      reason,
      userId: profile.id,
      userName: profileName(profile),
      createdAt: serverTimestamp(),
    });

    transaction.set(auditRef, {
      action: "whatsappCampaign.cancelled",
      title: "Campaña de WhatsApp cancelada",
      description: "La extensión liberó el emisor y la campaña salió de la cola activa.",
      moduleId: "marketing",
      entityType: "whatsappCampaign",
      entityId: campaignId,
      userId: profile.id,
      userName: profileName(profile),
      status: "completed",
      createdAt: serverTimestamp(),
    });

    return { ignored: false, status: "cancelled", emitterReleased: true };
  });
}
