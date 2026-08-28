from pathlib import Path
import json

p=Path('src/gestion/permissions.js'); s=p.read_text()
s=s.replace('  "metaAdsManageTheory",\n];','  "metaAdsManageTheory",\n  "metaAdsPlanCampaign",\n  "metaAdsApprovePlan",\n];',2)
p.write_text(s)

p=Path('src/gestion/pages/MetaAdsPage.jsx'); s=p.read_text(); anchor='import { useAsyncData } from "../hooks";\n'
if 'MetaAdsCampaignPlanningWorkspace' not in s:s=s.replace(anchor,anchor+'import MetaAdsCampaignPlanningWorkspace from "./MetaAdsCampaignPlanningWorkspace";\n')
s=s.replace('description="CampaignProject interno de Flor Mía. Las fases de IA, Drive, render y publicación todavía no están conectadas."','description="CampaignProject interno de Flor Mía. La planificación guiada ya puede convertir contexto + metodología + tus respuestas en un plan de campaña."')
s=s.replace('description={editable ? "En Etapa 2 sólo se editan nombre y producto mientras la campaña está en borrador." : "Este estado queda en modo lectura en Etapa 2."}','description={editable ? "Podés editar nombre y producto mientras la campaña está en borrador." : "Una vez iniciada la planificación, los datos base quedan en modo lectura."}')
marker='      <Panel title="Proceso de campaña" description="La estructura queda preparada; ninguna fase futura se simula en esta etapa.">'
if '<MetaAdsCampaignPlanningWorkspace' not in s:s=s.replace(marker,'      <MetaAdsCampaignPlanningWorkspace profile={profile} campaign={project} onCampaignRefresh={projectResult.refresh} />\n\n'+marker)
s=s.replace('title="Proceso de campaña" description="La estructura queda preparada; ninguna fase futura se simula en esta etapa."','title="Siguientes etapas" description="Drive, validación, render y publicación continúan fuera de esta etapa."')
p.write_text(s)

p=Path('src/styles/meta-ads.css'); s=p.read_text()
css='''\n\n/* Stage 4 — Campaign Planner */
.fm-planner-workspace{display:grid;gap:1rem}.fm-planner-context{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.fm-planner-context>div{display:grid;gap:.2rem;padding:.8rem;border:1px solid var(--fm-border,#e5e7eb);border-radius:12px}.fm-planner-context span{font-size:.78rem;color:var(--fm-muted,#667085)}.fm-planner-questions{display:grid;gap:1rem}.fm-planner-options{display:grid;gap:.5rem}.fm-planner-options label{display:flex;align-items:center;gap:.55rem}.fm-planner-plan-head,.fm-planner-piece__head,.fm-planner-piece-summary{display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap}.fm-planner-editorial{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin:1rem 0}.fm-planner-editorial section{padding:.8rem;border:1px solid var(--fm-border,#e5e7eb);border-radius:12px}.fm-planner-editorial h4,.fm-planner-piece h4{margin:0 0 .35rem}.fm-planner-editorial p{white-space:pre-wrap;margin:0}.fm-planner-editorial textarea,.fm-planner-piece textarea{width:100%}.fm-planner-pieces{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.fm-planner-piece{padding:1rem;border:1px solid var(--fm-border,#e5e7eb);border-radius:14px;background:var(--fm-surface,#fff)}.fm-planner-piece p{white-space:pre-wrap}.fm-planner-piece-summary{justify-content:flex-start}.fm-planner-workspace button[disabled]{cursor:not-allowed}@media(max-width:760px){.fm-planner-context,.fm-planner-editorial,.fm-planner-pieces{grid-template-columns:1fr}.fm-planner-plan-head{align-items:stretch}.fm-planner-plan-head .fm-button{width:100%}.fm-planner-piece{padding:.8rem}}
'''
if 'Stage 4 — Campaign Planner' not in s:s+=css
p.write_text(s)

p=Path('package.json'); data=json.loads(p.read_text()); cmd=data['scripts']['test:rules']
if 'tests/firestore.meta-ads-planner.rules.mjs' not in cmd:data['scripts']['test:rules']=cmd+' tests/firestore.meta-ads-planner.rules.mjs'
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')

p=Path('firestore.rules'); r=p.read_text()
r=r.replace('        "metaAdsManageKnowledge", "metaAdsManageTheory"\n      ];','        "metaAdsManageKnowledge", "metaAdsManageTheory",\n        "metaAdsPlanCampaign", "metaAdsApprovePlan"\n      ];')
start=r.index('    function validAiUsage(d) {'); end=r.index('\n\n    function validMetaAdsStatus',start)
ai='''    function validAiUsage(d) {
      let theoryOperation = d.operation == "theory_compile";
      let campaignOperation = d.operation in ["campaign_questions", "campaign_plan"];
      return d.keys().hasOnly(["schemaVersion","operation","theoryId","theoryVersionId","campaignId","userId","userName","model","inputTokens","outputTokens","totalTokens","actualCostUsd","success","errorCode","responseId","createdAt"])
        && d.schemaVersion == 1 && (theoryOperation || campaignOperation) && d.userId == request.auth.uid
        && d.model is string && d.inputTokens is int && d.inputTokens >= 0 && d.outputTokens is int && d.outputTokens >= 0
        && d.totalTokens is int && d.totalTokens >= 0 && (d.actualCostUsd == null || (d.actualCostUsd is number && d.actualCostUsd >= 0))
        && d.success is bool && d.createdAt is timestamp
        && ((theoryOperation && d.theoryId is string && d.theoryVersionId is string)
          || (campaignOperation && d.campaignId is string && d.campaignId.size() > 0 && d.campaignId.size() <= 128));
    }
    function aiUsageCanCreate() {
      return (request.resource.data.operation == "theory_compile" && metaAdsCan("metaAdsManageTheory"))
        || (request.resource.data.operation in ["campaign_questions", "campaign_plan"] && metaAdsCan("metaAdsPlanCampaign"));
    }'''
r=r[:start]+ai+r[end:]
start=r.index('    function validMetaAdsCampaignProject(data) {'); end=r.index('\n    function metaAdsCreateProjectAllowed()',start)
project='''    function validMetaAdsPlanningFields(data) {
      let fields = ["planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot","latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy"];
      return !data.keys().hasAny(fields)
        || (data.keys().hasAll(fields)
          && data.planningStatus in ["context_ready","questions_ready","answers_ready","plan_ready","approved"]
          && data.theoryId is string && data.theoryId.size() > 0 && data.theoryId.size() <= 128
          && data.theoryVersionId is string && data.theoryVersionId.size() > 0 && data.theoryVersionId.size() <= 128
          && data.theoryVersion is int && data.theoryVersion >= 1
          && data.theoryNameSnapshot is string && data.theoryNameSnapshot.size() > 0 && data.theoryNameSnapshot.size() <= 120
          && data.latestPlanRevision is int && data.latestPlanRevision >= 0
          && (data.approvedPlanRevision == null || (data.approvedPlanRevision is int && data.approvedPlanRevision >= 1 && data.approvedPlanRevision <= data.latestPlanRevision))
          && data.lastPlanningAt is timestamp && data.lastPlanningBy is string && data.lastPlanningBy.size() > 0);
    }
    function validMetaAdsCampaignProject(data) {
      return data.keys().hasOnly(["name","channel","status","schemaVersion","productId","productNameSnapshot","archived","createdBy","createdByName","createdAt","updatedBy","updatedByName","updatedAt","archivedAt","archivedBy","archivedByName","planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot","latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy"])
        && data.name is string && data.name.size() > 0 && data.name.size() <= 120 && data.channel == "meta_ads" && data.schemaVersion == 1
        && validMetaAdsStatus(data.status) && data.archived is bool && data.archived == (data.status == "archived")
        && validMetaAdsProduct(data) && validMetaAdsPlanningFields(data)
        && data.createdBy is string && data.createdBy.size() > 0 && data.createdByName is string && data.createdByName.size() > 0 && data.createdAt is timestamp
        && data.updatedBy is string && data.updatedBy.size() > 0 && data.updatedByName is string && data.updatedByName.size() > 0 && data.updatedAt is timestamp
        && ((data.status == "archived" && ("archivedAt" in data) && data.archivedAt is timestamp && ("archivedBy" in data) && data.archivedBy is string && data.archivedBy.size() > 0 && ("archivedByName" in data) && data.archivedByName is string && data.archivedByName.size() > 0)
          || (data.status != "archived" && !data.keys().hasAny(["archivedAt","archivedBy","archivedByName"])));
    }
    function metaAdsPlanningTheoryActive(data) {
      let theoryPath = /databases/$(database)/documents/metaAdTheories/$(data.theoryId)/versions/$(data.theoryVersionId);
      return exists(theoryPath) && get(theoryPath).data.status == "active" && get(theoryPath).data.version == data.theoryVersion;
    }
    function metaAdsPlanProjectAllowed() {
      let sameIdentity = request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt && request.resource.data.channel == resource.data.channel && request.resource.data.schemaVersion == resource.data.schemaVersion;
      let start = resource.data.status == "draft" && request.resource.data.status == "planning" && request.resource.data.planningStatus == "context_ready" && request.resource.data.latestPlanRevision == 0 && request.resource.data.approvedPlanRevision == null && request.resource.data.lastPlanningBy == request.auth.uid && metaAdsPlanningTheoryActive(request.resource.data)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["status","planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot","latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy","updatedBy","updatedByName","updatedAt"]);
      let progress = resource.data.status in ["planning","creative"] && request.resource.data.status == resource.data.status && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion && request.resource.data.theoryNameSnapshot == resource.data.theoryNameSnapshot
        && request.resource.data.planningStatus in ["context_ready","questions_ready","answers_ready","plan_ready"]
        && request.resource.data.latestPlanRevision >= resource.data.latestPlanRevision && request.resource.data.latestPlanRevision <= resource.data.latestPlanRevision + 1
        && request.resource.data.approvedPlanRevision == resource.data.approvedPlanRevision && request.resource.data.lastPlanningBy == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["planningStatus","latestPlanRevision","lastPlanningAt","lastPlanningBy","updatedBy","updatedByName","updatedAt"]);
      return metaAdsCan("metaAdsPlanCampaign") && sameIdentity && request.resource.data.updatedBy == request.auth.uid && validMetaAdsCampaignProject(request.resource.data) && (start || progress);
    }
    function metaAdsApproveProjectAllowed() {
      return metaAdsCan("metaAdsApprovePlan") && resource.data.status in ["planning","creative"] && request.resource.data.status == "creative" && request.resource.data.planningStatus == "approved"
        && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion && request.resource.data.theoryNameSnapshot == resource.data.theoryNameSnapshot
        && request.resource.data.approvedPlanRevision is int && request.resource.data.approvedPlanRevision >= 1 && request.resource.data.approvedPlanRevision <= request.resource.data.latestPlanRevision
        && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt && request.resource.data.updatedBy == request.auth.uid && request.resource.data.lastPlanningBy == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["status","planningStatus","approvedPlanRevision","lastPlanningAt","lastPlanningBy","updatedBy","updatedByName","updatedAt"])
        && validMetaAdsCampaignProject(request.resource.data);
    }
    function validPlanningStateStatus(value) { return value in ["context_ready","questions_ready","answers_ready","plan_ready","approved"]; }
    function validPlanningState(data,campaignId) {
      return data.keys().hasOnly(["schemaVersion","campaignId","status","theoryId","theoryVersionId","theoryVersion","questions","answers","latestPlanRevision","approvedPlanRevision","createdBy","createdByName","createdAt","updatedBy","updatedByName","updatedAt"])
        && data.schemaVersion == 1 && data.campaignId == campaignId && validPlanningStateStatus(data.status)
        && data.theoryId is string && data.theoryVersionId is string && data.theoryVersion is int && data.theoryVersion >= 1
        && data.questions is list && data.questions.size() <= 6 && data.answers is map && data.latestPlanRevision is int && data.latestPlanRevision >= 0
        && (data.approvedPlanRevision == null || (data.approvedPlanRevision is int && data.approvedPlanRevision >= 1 && data.approvedPlanRevision <= data.latestPlanRevision))
        && data.createdBy is string && data.createdAt is timestamp && data.updatedBy is string && data.updatedAt is timestamp;
    }
    function planningStateUpdateAllowed(campaignId) {
      let immutable = request.resource.data.campaignId == resource.data.campaignId && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt;
      let planUpdate = metaAdsCan("metaAdsPlanCampaign") && request.resource.data.status in ["context_ready","questions_ready","answers_ready","plan_ready"] && request.resource.data.approvedPlanRevision == resource.data.approvedPlanRevision;
      let approveUpdate = metaAdsCan("metaAdsApprovePlan") && request.resource.data.status == "approved" && resource.data.status == "plan_ready" && request.resource.data.approvedPlanRevision is int;
      return immutable && request.resource.data.updatedBy == request.auth.uid && validPlanningState(request.resource.data,campaignId) && (planUpdate || approveUpdate);
    }
    function validCampaignPlanEnvelope(plan) {
      return plan is map && plan.keys().hasAll(["schemaVersion","summary","strategy","concept","angle","commercialObjective","targetAudience","coreMessage","offer","cta","creativeDirection","creativePieces","testingPlan","assumptions","warnings"])
        && plan.keys().hasOnly(["schemaVersion","summary","strategy","concept","angle","commercialObjective","targetAudience","coreMessage","offer","cta","creativeDirection","creativePieces","testingPlan","assumptions","warnings"])
        && plan.schemaVersion == 1 && plan.summary is string && plan.strategy is string && plan.concept is string && plan.angle is string && plan.commercialObjective is string && plan.targetAudience is string && plan.coreMessage is string && plan.offer is string && plan.cta is string && plan.creativeDirection is string && plan.testingPlan is string
        && plan.creativePieces is list && plan.creativePieces.size() <= 100 && plan.assumptions is list && plan.assumptions.size() <= 30 && plan.warnings is list && plan.warnings.size() <= 30;
    }
    function campaignPlanTheoryMatches(data,campaignId) {
      let project = get(/databases/$(database)/documents/metaCampaignProjects/$(campaignId)).data;
      return data.theoryId == project.theoryId && data.theoryVersionId == project.theoryVersionId && data.theoryVersion == project.theoryVersion;
    }
    function validCampaignPlanRecord(data,campaignId) {
      return data.keys().hasOnly(["schemaVersion","campaignId","revision","status","theoryId","theoryVersionId","theoryVersion","plan","model","responseId","createdBy","createdByName","createdAt","updatedBy","updatedByName","updatedAt","approvedBy","approvedByName","approvedAt"])
        && data.schemaVersion == 1 && data.campaignId == campaignId && data.revision is int && data.revision >= 1 && data.status in ["draft","approved"]
        && data.theoryId is string && data.theoryVersionId is string && data.theoryVersion is int && data.theoryVersion >= 1 && validCampaignPlanEnvelope(data.plan)
        && data.model is string && (data.responseId == null || data.responseId is string) && data.createdBy is string && data.createdAt is timestamp && data.updatedBy is string && data.updatedAt is timestamp
        && ((data.status == "draft" && data.approvedBy == null && data.approvedByName == null && data.approvedAt == null) || (data.status == "approved" && data.approvedBy is string && data.approvedByName is string && data.approvedAt is timestamp));
    }
    function campaignPlanDraftUpdateAllowed(campaignId) {
      return metaAdsCan("metaAdsPlanCampaign") && resource.data.status == "draft" && request.resource.data.status == "draft"
        && request.resource.data.campaignId == resource.data.campaignId && request.resource.data.revision == resource.data.revision
        && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion
        && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["plan","updatedBy","updatedByName","updatedAt"]) && validCampaignPlanRecord(request.resource.data,campaignId);
    }
    function campaignPlanApproveAllowed(campaignId) {
      return metaAdsCan("metaAdsApprovePlan") && resource.data.status == "draft" && request.resource.data.status == "approved"
        && request.resource.data.campaignId == resource.data.campaignId && request.resource.data.revision == resource.data.revision
        && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion
        && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.approvedBy == request.auth.uid && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["status","plan","approvedBy","approvedByName","approvedAt","updatedBy","updatedByName","updatedAt"])
        && validCampaignPlanRecord(request.resource.data,campaignId);
    }'''
r=r[:start]+project+r[end:]
r=r.replace('    match /aiUsage/{usageId} { allow get,list: if metaAdsCan("metaAdsManageTheory"); allow create: if metaAdsCan("metaAdsManageTheory") && validAiUsage(request.resource.data); allow update,delete: if false; }','    match /aiUsage/{usageId} { allow get,list: if metaAdsCan("metaAdsManageTheory") || metaAdsCan("metaAdsPlanCampaign"); allow create: if aiUsageCanCreate() && validAiUsage(request.resource.data); allow update,delete: if false; }')
old='''    match /metaCampaignProjects/{campaignId} {
      allow get, list: if metaAdsCan("metaAdsView");
      allow create: if metaAdsCreateProjectAllowed();
      allow update: if metaAdsEditProjectAllowed() || metaAdsArchiveProjectAllowed();
      allow delete: if false;
    }'''
new='''    match /metaCampaignProjects/{campaignId} {
      allow get, list: if metaAdsCan("metaAdsView");
      allow create: if metaAdsCreateProjectAllowed();
      allow update: if metaAdsEditProjectAllowed() || metaAdsArchiveProjectAllowed() || metaAdsPlanProjectAllowed() || metaAdsApproveProjectAllowed();
      allow delete: if false;
      match /planning/{planningId} {
        allow get: if planningId == "state" && metaAdsCan("metaAdsView"); allow list: if false;
        allow create: if planningId == "state" && metaAdsCan("metaAdsPlanCampaign") && request.resource.data.createdBy == request.auth.uid && request.resource.data.updatedBy == request.auth.uid && campaignPlanTheoryMatches(request.resource.data,campaignId) && validPlanningState(request.resource.data,campaignId);
        allow update: if planningId == "state" && planningStateUpdateAllowed(campaignId); allow delete: if false;
      }
      match /plans/{planId} {
        allow get,list: if metaAdsCan("metaAdsView");
        allow create: if metaAdsCan("metaAdsPlanCampaign") && request.resource.data.status == "draft" && request.resource.data.createdBy == request.auth.uid && request.resource.data.updatedBy == request.auth.uid && campaignPlanTheoryMatches(request.resource.data,campaignId) && validCampaignPlanRecord(request.resource.data,campaignId);
        allow update: if campaignPlanDraftUpdateAllowed(campaignId) || campaignPlanApproveAllowed(campaignId); allow delete: if false;
      }
    }'''
if old not in r: raise SystemExit('metaCampaignProjects marker not found')
r=r.replace(old,new)
r=r.replace('              || metaAdsCan("metaAdsManageTheory")\n              || canModule("marketing", "edit")))','              || metaAdsCan("metaAdsManageTheory")\n              || metaAdsCan("metaAdsPlanCampaign")\n              || metaAdsCan("metaAdsApprovePlan")\n              || canModule("marketing", "edit")))')
p.write_text(r)
print('Stage 4 patches applied')
