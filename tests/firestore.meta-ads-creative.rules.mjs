import test, { after, before } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { readFile } from "node:fs/promises";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let environment;

const task = {
  schemaVersion: 1,
  id: "r1-hook-1",
  campaignId: "campaign-creative",
  sourcePlanRevision: 1,
  creativePieceId: "hook-1",
  requirementKey: "hook",
  category: "Hooks",
  order: 1,
  orderWithinCategory: 1,
  title: "Hook 1",
  script: "Guion",
  objective: "Detener el scroll",
  instructions: "Plano corto",
  targetDurationSeconds: 4,
  requirements: [],
  required: true,
  mediaKind: "video",
  allowedMimePrefixes: ["video/"],
  acceptedExtensions: ["mp4"],
  status: "pending",
  selectedAssetId: null,
  driveFolderId: null,
};

const asset = {
  schemaVersion: 1,
  id: "asset-1",
  campaignId: "campaign-creative",
  recordingTaskId: "r1-hook-1",
  creativePieceId: "hook-1",
  requirementKey: "hook",
  sourcePlanRevision: 1,
  driveFileId: "drive-file-1",
  driveFolderId: "drive-folder-1",
  driveFileName: "hook-01-take-01.mp4",
  originalFileName: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1024,
  takeNumber: 1,
  status: "ready_for_validation",
  uploadedBy: "admin-creative",
  uploadedByName: "Admin",
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId: "demo-flor-mia-creative",
    firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", "admin-creative"), { role: "admin", active: true, name: "Admin" }),
      setDoc(doc(db, "users", "marketing-creative"), { role: "marketing_manager", active: true, name: "Marketing" }),
      setDoc(doc(db, "users", "seller-creative"), { role: "seller", active: true, name: "Seller" }),
      setDoc(doc(db, "users", "inactive-creative"), { role: "marketing_manager", active: false, name: "Inactive" }),
      setDoc(doc(db, "users", "denied-creative"), {
        role: "marketing_manager",
        active: true,
        name: "Denied",
        permissionDeny: { marketing: ["metaAdsViewCreativeWorkspace", "metaAdsUploadCreative"] },
      }),
      setDoc(doc(db, "metaCampaignProjects", "campaign-creative"), { id: "campaign-creative", status: "creative" }),
      setDoc(doc(db, "metaCampaignProjects", "campaign-other"), { id: "campaign-other", status: "creative" }),
      setDoc(doc(db, "metaCampaignProjects", "campaign-creative", "recordingTasks", task.id), task),
      setDoc(doc(db, "metaCampaignProjects", "campaign-creative", "creativeAssets", asset.id), asset),
      setDoc(doc(db, "integrationConnections", "googleDrive"), { status: "connected", provider: "google_drive" }),
      setDoc(doc(db, "integrationSecrets", "googleDrive"), { refreshToken: "never-client-readable" }),
      setDoc(doc(db, "integrationOauthStates", "state-1"), { uid: "admin-creative" }),
      setDoc(doc(db, "creativeUploadSessions", "upload-1"), { campaignId: "campaign-creative" }),
    ]);
  });
});

after(async () => environment?.cleanup());

test("Workspace creativo: admin y marketing pueden leer; seller, inactivo y deny no", async () => {
  for (const uid of ["admin-creative", "marketing-creative"]) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, "metaCampaignProjects", "campaign-creative", "recordingTasks", task.id)));
    await assertSucceeds(getDoc(doc(db, "metaCampaignProjects", "campaign-creative", "creativeAssets", asset.id)));
  }
  for (const uid of ["seller-creative", "inactive-creative", "denied-creative"]) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, "metaCampaignProjects", "campaign-creative", "recordingTasks", task.id)));
    await assertFails(getDoc(doc(db, "metaCampaignProjects", "campaign-creative", "creativeAssets", asset.id)));
  }
});

test("RecordingTasks y CreativeAssets son backend-only incluso para admin", async () => {
  const db = environment.authenticatedContext("admin-creative").firestore();
  await assertFails(setDoc(doc(db, "metaCampaignProjects", "campaign-other", "recordingTasks", "r1-hook-1"), {
    ...task,
    campaignId: "campaign-other",
  }));
  await assertFails(updateDoc(doc(db, "metaCampaignProjects", "campaign-creative", "recordingTasks", task.id), {
    selectedAssetId: asset.id,
    status: "ready_for_validation",
  }));
  await assertFails(setDoc(doc(db, "metaCampaignProjects", "campaign-other", "creativeAssets", asset.id), {
    ...asset,
    campaignId: "campaign-other",
  }));
});

test("Conexión visible sin exponer secrets, OAuth state ni sesiones de carga", async () => {
  for (const uid of ["admin-creative", "marketing-creative"]) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, "integrationConnections", "googleDrive")));
    await assertFails(getDoc(doc(db, "integrationSecrets", "googleDrive")));
    await assertFails(getDoc(doc(db, "integrationOauthStates", "state-1")));
    await assertFails(getDoc(doc(db, "creativeUploadSessions", "upload-1")));
  }
});

test("ningún cliente puede escribir estado de integración ni sesiones", async () => {
  for (const uid of ["admin-creative", "marketing-creative", "seller-creative"]) {
    const db = environment.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(db, "integrationConnections", "googleDrive"), { status: "disconnected" }));
    await assertFails(setDoc(doc(db, "integrationSecrets", "attacker"), { refreshToken: "x" }));
    await assertFails(setDoc(doc(db, "creativeUploadSessions", "attacker"), { campaignId: "campaign-other" }));
  }
});
