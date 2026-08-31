import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`No se encontró el bloque: ${label}`);
  return source.replace(from, to);
}

// Permissions: Marketing Manager may view/upload creative material, but Drive connection stays admin/explicit only.
{
  const path = "src/gestion/permissions.js";
  let source = read(path);
  source = replaceOnce(source,
`  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
];`,
`  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace",
  "metaAdsUploadCreative",
  "metaAdsManageDrive",
];`, "ACTIONS Stage5");
  source = replaceOnce(source,
`  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
];
const sellerSalesActions`,
`  "metaAdsPlanCampaign",
  "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace",
  "metaAdsUploadCreative",
];
const sellerSalesActions`, "metaAdsMarketingActions Stage5");
  write(path, source);
}

// Backend permission helper: don't let marketing_manager administer OAuth just because it's a Meta Ads action.
{
  const path = "netlify/functions/_lib/firebaseAuth.mjs";
  let source = read(path);
  source = replaceOnce(source,
`function allowedAction(profile, action) {
  if (profile?.active !== true) return false;`,
`const MARKETING_MANAGER_META_ADS_ACTIONS = new Set([
  "metaAdsView", "metaAdsCreateProject", "metaAdsEditProject", "metaAdsArchiveProject",
  "metaAdsManageKnowledge", "metaAdsManageTheory", "metaAdsPlanCampaign", "metaAdsApprovePlan",
  "metaAdsViewCreativeWorkspace", "metaAdsUploadCreative",
]);

function allowedAction(profile, action) {
  if (profile?.active !== true) return false;`, "backend marketing whitelist");
  source = replaceOnce(source,
`  if (role === "marketing_manager") return true;`,
`  if (role === "marketing_manager") return MARKETING_MANAGER_META_ADS_ACTIONS.has(action);`, "backend marketing role restriction");
  write(path, source);
}

// Campaign detail: Stage 5 becomes a real step and future panel starts at Validation.
{
  const path = "src/gestion/pages/MetaAdsPage.jsx";
  let source = read(path);
  source = replaceOnce(source,
`import MetaAdsCampaignPlanningWorkspace from "./MetaAdsCampaignPlanningWorkspace";`,
`import MetaAdsCampaignPlanningWorkspace from "./MetaAdsCampaignPlanningWorkspace";
import MetaAdsCreativeWorkspace from "./MetaAdsCreativeWorkspace";`, "creative workspace import");
  source = replaceOnce(source,
`const phases = [
  "Estrategia",
  "Guiones",
  "Grabaciones",
  "Validación",
  "Producción",
  "Meta Ads",
  "Resultados",
];`,
`const phases = [
  "Validación",
  "Producción",
  "Meta Ads",
  "Resultados",
];`, "future phases");
  source = replaceOnce(source,
`      <MetaAdsCampaignPlanningWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />

      <Panel title="Siguientes etapas" description="Drive, validación, render y publicación continúan fuera de esta etapa.">`,
`      <MetaAdsCampaignPlanningWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />
      <MetaAdsCreativeWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />

      <Panel title="Siguientes etapas" description="Después de grabar y cargar el material, validación, render y publicación continúan en etapas posteriores.">`, "render creative workspace");
  write(path, source);
}

// First upload may provision folders: reload CampaignProject before parent verification.
{
  const path = "netlify/functions/google-drive.mjs";
  let source = read(path);
  source = replaceOnce(source,
`async function createUpload(session, body) {
  const campaign = await loadCampaign(body.campaignId);`,
`async function createUpload(session, body) {
  let campaign = await loadCampaign(body.campaignId);`, "createUpload mutable campaign");
  source = replaceOnce(source,
`  if (!campaign.driveFolderId || !task.driveFolderId) {
    await provisionCampaign(session, campaign.id);
    task = await adminGet(taskPath(campaign.id, taskId));
  }`,
`  if (!campaign.driveFolderId || !task.driveFolderId) {
    await provisionCampaign(session, campaign.id);
    campaign = await loadCampaign(campaign.id);
    task = await adminGet(taskPath(campaign.id, taskId));
  }`, "reload provisioned campaign");
  write(path, source);
}

// Firestore Rules are prepared only. They are NOT deployed by this workflow.
{
  const path = "firestore.rules";
  let source = read(path);
  source = replaceOnce(source,
`        "metaAdsManageKnowledge", "metaAdsManageTheory",
        "metaAdsPlanCampaign", "metaAdsApprovePlan"
      ];`,
`        "metaAdsManageKnowledge", "metaAdsManageTheory",
        "metaAdsPlanCampaign", "metaAdsApprovePlan",
        "metaAdsViewCreativeWorkspace", "metaAdsUploadCreative"
      ];`, "Rules role Stage5 actions");

  source = replaceOnce(source,
`    function validMetaAdsCampaignProject(data) {
      return data.keys().hasOnly(["name","channel","status","schemaVersion","productId","productNameSnapshot","archived","createdBy","createdByName","createdAt","updatedBy","updatedByName","updatedAt","archivedAt","archivedBy","archivedByName","planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot","latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy"])
        && data.name is string`,
`    function validMetaAdsDriveFields(data) {
      let fields = ["driveFolderId","driveConnectionId","driveId","driveProvisionedAt","driveStructure"];
      return !data.keys().hasAny(fields)
        || (data.keys().hasAll(fields)
          && data.driveFolderId is string && data.driveFolderId.size() > 0 && data.driveFolderId.size() <= 220
          && data.driveConnectionId == "googleDrive"
          && (data.driveId == null || (data.driveId is string && data.driveId.size() <= 220))
          && data.driveProvisionedAt is timestamp
          && data.driveStructure is map
          && data.driveStructure.keys().hasAll(["sourceFolderId","rendersFolderId","finalFolderId","categories"])
          && data.driveStructure.keys().hasOnly(["sourceFolderId","rendersFolderId","finalFolderId","categories"])
          && data.driveStructure.sourceFolderId is string && data.driveStructure.sourceFolderId.size() <= 220
          && data.driveStructure.rendersFolderId is string && data.driveStructure.rendersFolderId.size() <= 220
          && data.driveStructure.finalFolderId is string && data.driveStructure.finalFolderId.size() <= 220
          && data.driveStructure.categories is map && data.driveStructure.categories.size() <= 40);
    }
    function validMetaAdsCampaignProject(data) {
      return data.keys().hasOnly(["name","channel","status","schemaVersion","productId","productNameSnapshot","archived","createdBy","createdByName","createdAt","updatedBy","updatedByName","updatedAt","archivedAt","archivedBy","archivedByName","planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot","latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy","driveFolderId","driveConnectionId","driveId","driveProvisionedAt","driveStructure"])
        && data.name is string`, "Rules Drive campaign fields");
  source = replaceOnce(source,
`        && validMetaAdsProduct(data) && validMetaAdsPlanningFields(data)
        && data.createdBy is string`,
`        && validMetaAdsProduct(data) && validMetaAdsPlanningFields(data) && validMetaAdsDriveFields(data)
        && data.createdBy is string`, "Rules validate Drive fields");

  source = replaceOnce(source,
`      match /plans/{planId} {
        allow get,list: if metaAdsCan("metaAdsView");
        allow create: if metaAdsCan("metaAdsPlanCampaign") && request.resource.data.status == "draft" && request.resource.data.createdBy == request.auth.uid && request.resource.data.updatedBy == request.auth.uid && campaignPlanTheoryMatches(request.resource.data,campaignId) && validCampaignPlanRecord(request.resource.data,campaignId);
        allow update: if request.resource.data.status == "approved" ? campaignPlanApproveAllowed(campaignId) : campaignPlanDraftUpdateAllowed(campaignId); allow delete: if false;
      }
    }`,
`      match /plans/{planId} {
        allow get,list: if metaAdsCan("metaAdsView");
        allow create: if metaAdsCan("metaAdsPlanCampaign") && request.resource.data.status == "draft" && request.resource.data.createdBy == request.auth.uid && request.resource.data.updatedBy == request.auth.uid && campaignPlanTheoryMatches(request.resource.data,campaignId) && validCampaignPlanRecord(request.resource.data,campaignId);
        allow update: if request.resource.data.status == "approved" ? campaignPlanApproveAllowed(campaignId) : campaignPlanDraftUpdateAllowed(campaignId); allow delete: if false;
      }
      match /recordingTasks/{taskId} {
        allow get,list: if metaAdsCan("metaAdsViewCreativeWorkspace");
        allow create,update,delete: if false;
      }
      match /creativeAssets/{assetId} {
        allow get,list: if metaAdsCan("metaAdsViewCreativeWorkspace");
        allow create,update,delete: if false;
      }
    }
    match /integrationConnections/{integrationId} {
      allow get: if integrationId == "googleDrive" && (metaAdsCan("metaAdsViewCreativeWorkspace") || metaAdsCan("metaAdsManageDrive"));
      allow list,create,update,delete: if false;
    }
    match /integrationSecrets/{secretId} { allow read,write: if false; }
    match /integrationOauthStates/{stateId} { allow read,write: if false; }
    match /creativeUploadSessions/{sessionId} { allow read,write: if false; }`, "Rules Stage5 collections");

  source = replaceOnce(source,
`              || metaAdsCan("metaAdsPlanCampaign")
              || metaAdsCan("metaAdsApprovePlan")
              || canModule("marketing", "edit")))`,
`              || metaAdsCan("metaAdsPlanCampaign")
              || metaAdsCan("metaAdsApprovePlan")
              || metaAdsCan("metaAdsViewCreativeWorkspace")
              || metaAdsCan("metaAdsUploadCreative")
              || metaAdsCan("metaAdsManageDrive")
              || canModule("marketing", "edit")))`, "Rules audit Stage5 actions");
  write(path, source);
}

// Server-only Google/Firebase variables. No real secrets are written.
{
  const path = ".env.example";
  let source = read(path).trimEnd();
  const addition = `

# Meta Ads Etapa 5 — server-only (NO usar prefijo VITE_)
FIREBASE_SERVICE_ACCOUNT_JSON=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
GOOGLE_TOKEN_ENCRYPTION_KEY=
GOOGLE_DRIVE_ROOT_FOLDER_NAME=Meta Ads
GOOGLE_DRIVE_SHARED_DRIVE_ID=
META_ADS_MAX_UPLOAD_BYTES=1073741824
META_ADS_UPLOAD_CHUNK_BYTES=8388608
`;
  if (!source.includes("GOOGLE_CLIENT_ID=")) source += addition;
  write(path, `${source.trimEnd()}\n`);
}

console.log("Stage 5 integration patch applied.");
