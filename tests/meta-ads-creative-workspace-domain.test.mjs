import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDriveFileName,
  folderNameForRequirement,
  generateRecordingTasks,
  validateCreativeAsset,
  validateUploadMetadata,
} from "../src/gestion/marketing/metaAds/creativeWorkspaceDomain.js";

const theory = {
  creativeRequirements: [
    { key: "hook", label: "Hook", required: true, recommendedCount: 3, instructions: "Video vertical", duration: { idealSeconds: 4 } },
    { key: "testimonial", label: "Testimonial", required: true, recommendedCount: 1, instructions: "Testimonio en cámara", duration: { idealSeconds: 8 } },
  ],
};
const pieces = [
  ...Array.from({ length: 3 }, (_, index) => ({ id: `hook_${index + 1}`, requirementKey: "hook", title: `Hook ${index + 1}`, script: `Texto ${index + 1}`, objective: "Detener el scroll", instructions: "Mirar a cámara", durationSeconds: 4, requirements: [], status: "approved" })),
  { id: "testimonial_1", requirementKey: "testimonial", title: "Testimonial 1", script: "Experiencia real", objective: "Prueba social", instructions: "Plano medio", durationSeconds: 8, requirements: [], status: "approved" },
];

function approvedPlan(creativePieces = pieces) {
  return { revision: 2, status: "approved", plan: { creativePieces } };
}

test("RecordingTaskGenerator crea una tarea por CreativePiece", () => {
  const tasks = generateRecordingTasks({ campaignId: "campaign123", planRecord: approvedPlan(pieces.slice(0, 3)), theoryConfig: { creativeRequirements: [theory.creativeRequirements[0]] } });
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.title), ["Hook 1", "Hook 2", "Hook 3"]);
  assert.ok(tasks.every((task) => task.sourcePlanRevision === 2 && task.requirementKey === "hook"));
});

test("una categoría dinámica genera tarea sin cambiar componentes", () => {
  const task = generateRecordingTasks({ campaignId: "campaign123", planRecord: approvedPlan([pieces[3]]), theoryConfig: { creativeRequirements: [theory.creativeRequirements[1]] } })[0];
  assert.equal(task.requirementKey, "testimonial");
  assert.equal(task.category, "Testimonial");
  assert.equal(task.mediaKind, "video");
});

test("folder mapping mantiene nombres amigables y fallback dinámico", () => {
  assert.equal(folderNameForRequirement("hook", "Hook"), "Hooks");
  assert.equal(folderNameForRequirement("testimonial", "Testimonial"), "Testimonials");
  assert.equal(folderNameForRequirement("ugc_creator", "UGC Creator"), "UGC-Creator");
});

test("file naming es estable, ordenado y no usa el nombre original como path", () => {
  const task = generateRecordingTasks({ campaignId: "campaign123", planRecord: approvedPlan([pieces[3]]), theoryConfig: { creativeRequirements: [theory.creativeRequirements[1]] } })[0];
  assert.equal(buildDriveFileName(task, 2, { name: "Video final raro.mov" }), "testimonial-01-take-02.mov");
});

test("metadata local rechaza tipo y tamaño inválidos", () => {
  const task = generateRecordingTasks({ campaignId: "campaign123", planRecord: approvedPlan([pieces[3]]), theoryConfig: { creativeRequirements: [theory.creativeRequirements[1]] } })[0];
  assert.equal(validateUploadMetadata({ name: "clip.mp4", type: "video/mp4", size: 1024 }, task).valid, true);
  assert.equal(validateUploadMetadata({ name: "clip.mp3", type: "audio/mpeg", size: 1024 }, task).valid, false);
  assert.equal(validateUploadMetadata({ name: "clip.mp4", type: "video/mp4", size: 0 }, task).valid, false);
});

test("CreativeAsset válido no admite credenciales o sesiones", () => {
  const task = generateRecordingTasks({ campaignId: "campaign123", planRecord: approvedPlan([pieces[3]]), theoryConfig: { creativeRequirements: [theory.creativeRequirements[1]] } })[0];
  const base = {
    id: "asset1",
    campaignId: "campaign123",
    recordingTaskId: task.id,
    creativePieceId: task.creativePieceId,
    requirementKey: task.requirementKey,
    sourcePlanRevision: 2,
    driveFileId: "drive-file-1",
    driveFolderId: "drive-folder-1",
    driveFileName: "testimonial-01-take-01.mp4",
    originalFileName: "IMG_0001.mp4",
    mimeType: "video/mp4",
    sizeBytes: 1234,
    takeNumber: 1,
    status: "ready_for_validation",
    uploadedBy: "admin1",
    uploadedByName: "Admin",
  };
  assert.equal(validateCreativeAsset(base, { campaignId: "campaign123", task }).valid, true);
  assert.equal(validateCreativeAsset({ ...base, resumableSessionUrl: "secret" }, { campaignId: "campaign123", task }).valid, false);
});
