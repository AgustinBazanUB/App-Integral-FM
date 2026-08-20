import test, { after, before } from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

let environment;

const baseCampaign = {
  name: "Campaña vieja",
  source: "whatsapp",
  filters: {},
  message: "Hola",
  imageCount: 0,
  imageNames: [],
  imageOrder: [],
  imageMetadata: [],
  totalRecipients: 1,
  sentCount: 0,
  confirmedSentCount: 0,
  unverifiedSentCount: 0,
  errorCount: 0,
  processedCount: 0,
  progressPercentage: 0,
  status: "paused",
  snapshotState: "ready",
  active: true,
  deleted: false,
  createdBy: "admin-1",
  createdByName: "Administrador",
  createdAt: new Date(),
  updatedAt: new Date(),
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-flor-mia-whatsapp-release",
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
      setDoc(doc(database, "users", "marketing-denied"), {
        name: "Marketing restringido",
        role: "marketing_manager",
        active: true,
        permissionDeny: { marketing: ["whatsappSendToExtension"] },
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-release"), baseCampaign),
      setDoc(doc(database, "whatsappCampaigns", "wa-denied-release"), {
        ...baseCampaign,
        createdBy: "marketing-denied",
        createdByName: "Marketing restringido",
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("una campaña puede persistir el estado stopped informado por la extensión", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    status: "stopped",
    stoppedAt: new Date(),
    stoppedBy: "admin-1",
    finishedAt: new Date(),
    lastExtensionSequence: 10,
    lastExtensionUpdateAt: new Date(),
    extensionBlockReason: null,
    extensionRetryableFailed: 0,
    extensionRetryCycle: 0,
    extensionVersion: "0.9.4.4",
    updatedAt: new Date(),
  }));
});

test("la reconciliación puede liberar el emisor de una campaña vieja", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    emitterReleased: true,
    emitterReleasedAt: new Date(),
    extensionBlockReason: null,
    updatedAt: new Date(),
  }));
});

test("la cancelación reconciliada puede persistir contadores y cierre sin ampliar permisos generales", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    status: "cancelled",
    sentCount: 0,
    confirmedSentCount: 0,
    unverifiedSentCount: 0,
    errorCount: 0,
    processedCount: 0,
    progressPercentage: 0,
    lastExtensionSequence: 11,
    lastExtensionUpdateAt: new Date(),
    extensionBlockReason: null,
    extensionRetryableFailed: 0,
    extensionRetryCycle: 0,
    extensionVersion: "0.9.4.4",
    finishedAt: new Date(),
    cancelledAt: new Date(),
    cancelledBy: "admin-1",
    updatedAt: new Date(),
  }));
});

test("un perfil con envío WhatsApp denegado sigue sin poder liberar el emisor", async () => {
  const database = environment.authenticatedContext("marketing-denied").firestore();
  await assertFails(updateDoc(doc(database, "whatsappCampaigns", "wa-denied-release"), {
    emitterReleased: true,
    emitterReleasedAt: new Date(),
    extensionBlockReason: null,
    updatedAt: new Date(),
  }));
});

test("la liberación no permite modificar contenido ni destinatarios de la campaña", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertFails(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    emitterReleased: true,
    message: "Contenido alterado",
    updatedAt: new Date(),
  }));
});
