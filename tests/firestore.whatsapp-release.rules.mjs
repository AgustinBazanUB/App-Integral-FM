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
      setDoc(doc(database, "users", "marketing-cancel-denied"), {
        name: "Marketing sin cancelación",
        role: "marketing_manager",
        active: true,
        permissionDeny: { marketing: ["whatsappCancelCampaign"] },
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-release"), baseCampaign),
      setDoc(doc(database, "whatsappCampaigns", "wa-send-denied"), {
        ...baseCampaign,
        createdBy: "marketing-send-denied",
        createdByName: "Marketing sin envío",
      }),
      setDoc(doc(database, "whatsappCampaigns", "wa-cancel-denied"), {
        ...baseCampaign,
        createdBy: "marketing-cancel-denied",
        createdByName: "Marketing sin cancelación",
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

test("un perfil con cancelación WhatsApp denegada no puede archivar la campaña", async () => {
  const database = environment.authenticatedContext("marketing-cancel-denied").firestore();
  await assertFails(updateDoc(
    doc(database, "whatsappCampaigns", "wa-cancel-denied"),
    cancellationPatch("marketing-cancel-denied"),
  ));
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
