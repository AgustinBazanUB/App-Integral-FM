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
  errorCount: 0,
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
      setDoc(doc(database, "users", "marketing-send-denied"), {
        name: "Marketing sin envío",
        role: "marketing_manager",
        active: true,
        permissionDeny: { marketing: ["whatsappSendToExtension"] },
      }),
      setDoc(doc(database, "users", "marketing-control-denied"), {
        name: "Marketing sin control de campaña",
        role: "marketing_manager",
        active: true,
        permissionDeny: {
          marketing: ["whatsappCancelCampaign", "whatsappSendToExtension"],
        },
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-release"), baseCampaign),
      setDoc(doc(database, "whatsappCampaigns", "wa-send-denied"), {
        ...baseCampaign,
        createdBy: "marketing-send-denied",
        createdByName: "Marketing sin envío",
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-control-denied"), {
        ...baseCampaign,
        createdBy: "marketing-control-denied",
        createdByName: "Marketing sin control de campaña",
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-prepare"), {
        ...baseCampaign,
        status: "draft",
        snapshotState: "writing",
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

const cancellationPatch = (userId) => ({
  status: "cancelled",
  cancelledAt: new Date(),
  cancelledBy: userId,
  finishedAt: new Date(),
  updatedAt: new Date(),
});

test("una campaña vieja puede salir de activas usando sólo el contrato Firestore ya permitido", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(
    doc(database, "whatsappCampaigns", "wa-release"),
    cancellationPatch("admin-1"),
  ));
});

test("quitar una campaña vieja depende de permiso de cancelación, no de permiso de envío", async () => {
  const database = environment.authenticatedContext("marketing-send-denied").firestore();
  await assertSucceeds(updateDoc(
    doc(database, "whatsappCampaigns", "wa-send-denied"),
    cancellationPatch("marketing-send-denied"),
  ));
});

test("un perfil sin permisos de cancelación ni envío no puede archivar la campaña", async () => {
  const database = environment.authenticatedContext("marketing-control-denied").firestore();
  await assertFails(updateDoc(
    doc(database, "whatsappCampaigns", "wa-control-denied"),
    cancellationPatch("marketing-control-denied"),
  ));
});

test("preparar una campaña nueva usa sólo campos permitidos en draft a ready", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(database, "whatsappCampaigns", "wa-prepare"), {
    totalRecipients: 1,
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    status: "ready",
    snapshotState: "ready",
    preparedAt: new Date(),
    updatedAt: new Date(),
  }));
});

test("iniciar la campaña persiste el estado running sin campos nuevos no desplegados", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertSucceeds(updateDoc(doc(database, "whatsappCampaigns", "wa-prepare"), {
    status: "running",
    sentCount: 0,
    errorCount: 0,
    progressPercentage: 0,
    lastExtensionSequence: 1,
    lastExtensionUpdateAt: new Date(),
    startedAt: new Date(),
    updatedAt: new Date(),
  }));
});

test("Firestore sigue rechazando métricas nuevas si se escriben directo en el documento principal", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertFails(updateDoc(doc(database, "whatsappCampaigns", "wa-prepare"), {
    confirmedSentCount: 1,
    unverifiedSentCount: 0,
    processedCount: 1,
    updatedAt: new Date(),
  }));
});

test("el estado stopped sigue bloqueado por las reglas actuales y por eso no se persiste como paso intermedio", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertFails(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    status: "stopped",
    stoppedAt: new Date(),
    stoppedBy: "admin-1",
    updatedAt: new Date(),
  }));
});

test("el cierre no puede colar campos de runtime que las reglas desplegadas no autorizan", async () => {
  const database = environment.authenticatedContext("admin-1").firestore();
  await assertFails(updateDoc(doc(database, "whatsappCampaigns", "wa-release"), {
    emitterReleased: true,
    emitterReleasedAt: new Date(),
    updatedAt: new Date(),
  }));
});
