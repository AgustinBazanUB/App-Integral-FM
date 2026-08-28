from pathlib import Path

p = Path("firestore.rules")
r = p.read_text()

start = r.index("    function metaAdsCampaignProjectUpdateAllowed() {")
end = r.index("    function validPlanningStateStatus", start)
replacement = '''    function metaAdsPlanningIdentityStable() {
      return request.resource.data.createdBy == resource.data.createdBy
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.channel == resource.data.channel
        && request.resource.data.schemaVersion == resource.data.schemaVersion;
    }
    function metaAdsPlanProjectAllowedCompact(changed) {
      return metaAdsCan("metaAdsPlanCampaign")
        && metaAdsPlanningIdentityStable()
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.archived == false
        && validMetaAdsCampaignProject(request.resource.data)
        && (resource.data.status == "draft"
          ? (request.resource.data.status == "planning"
            && request.resource.data.planningStatus == "context_ready"
            && request.resource.data.latestPlanRevision == 0
            && request.resource.data.approvedPlanRevision == null
            && request.resource.data.lastPlanningBy == request.auth.uid
            && metaAdsPlanningTheoryActive(request.resource.data)
            && changed.hasOnly([
              "status","planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot",
              "latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy",
              "updatedBy","updatedByName","updatedAt"
            ]))
          : (resource.data.status in ["planning","creative"]
            && request.resource.data.status == resource.data.status
            && request.resource.data.theoryId == resource.data.theoryId
            && request.resource.data.theoryVersionId == resource.data.theoryVersionId
            && request.resource.data.theoryVersion == resource.data.theoryVersion
            && request.resource.data.theoryNameSnapshot == resource.data.theoryNameSnapshot
            && request.resource.data.planningStatus in ["context_ready","questions_ready","answers_ready","plan_ready"]
            && request.resource.data.latestPlanRevision >= resource.data.latestPlanRevision
            && request.resource.data.latestPlanRevision <= resource.data.latestPlanRevision + 1
            && request.resource.data.approvedPlanRevision == resource.data.approvedPlanRevision
            && request.resource.data.lastPlanningBy == request.auth.uid
            && changed.hasOnly([
              "planningStatus","latestPlanRevision","lastPlanningAt","lastPlanningBy",
              "updatedBy","updatedByName","updatedAt"
            ])));
    }
    function metaAdsApproveProjectAllowedCompact(changed) {
      return metaAdsCan("metaAdsApprovePlan")
        && metaAdsPlanningIdentityStable()
        && request.resource.data.updatedBy == request.auth.uid
        && resource.data.status in ["planning","creative"]
        && request.resource.data.status == "creative"
        && request.resource.data.archived == false
        && request.resource.data.planningStatus == "approved"
        && request.resource.data.theoryId == resource.data.theoryId
        && request.resource.data.theoryVersionId == resource.data.theoryVersionId
        && request.resource.data.theoryVersion == resource.data.theoryVersion
        && request.resource.data.theoryNameSnapshot == resource.data.theoryNameSnapshot
        && request.resource.data.latestPlanRevision == resource.data.latestPlanRevision
        && request.resource.data.approvedPlanRevision is int
        && request.resource.data.approvedPlanRevision >= 1
        && request.resource.data.approvedPlanRevision <= request.resource.data.latestPlanRevision
        && request.resource.data.lastPlanningBy == request.auth.uid
        && changed.hasOnly([
          "status","planningStatus","approvedPlanRevision","lastPlanningAt","lastPlanningBy",
          "updatedBy","updatedByName","updatedAt"
        ])
        && validMetaAdsCampaignProject(request.resource.data);
    }
    function metaAdsCampaignProjectUpdateAllowed() {
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      let planningChange = changed.hasAny([
        "planningStatus","theoryId","theoryVersionId","theoryVersion","theoryNameSnapshot",
        "latestPlanRevision","approvedPlanRevision","lastPlanningAt","lastPlanningBy"
      ]);
      return planningChange
        ? (request.resource.data.planningStatus == "approved"
          ? metaAdsApproveProjectAllowedCompact(changed)
          : metaAdsPlanProjectAllowedCompact(changed))
        : (request.resource.data.status == "archived"
          ? metaAdsArchiveProjectAllowed()
          : metaAdsEditProjectAllowed());
    }
'''
r = r[:start] + replacement + r[end:]

# Route subcollection updates by the target state as well, so denied writes do
# not evaluate both the draft and approval contracts.
r = r.replace(
    'allow update: if planningId == "state" && planningStateUpdateAllowed(campaignId); allow delete: if false;',
    'allow update: if planningId == "state" && planningStateUpdateAllowed(campaignId); allow delete: if false;'
)
r = r.replace(
    'allow update: if campaignPlanDraftUpdateAllowed(campaignId) || campaignPlanApproveAllowed(campaignId); allow delete: if false;',
    'allow update: if request.resource.data.status == "approved" ? campaignPlanApproveAllowed(campaignId) : campaignPlanDraftUpdateAllowed(campaignId); allow delete: if false;'
)

# planning/state had its own eager OR. Make it branch on the target status.
old = '''    function planningStateUpdateAllowed(campaignId) {
      let immutable = request.resource.data.campaignId == resource.data.campaignId && request.resource.data.theoryId == resource.data.theoryId && request.resource.data.theoryVersionId == resource.data.theoryVersionId && request.resource.data.theoryVersion == resource.data.theoryVersion && request.resource.data.createdBy == resource.data.createdBy && request.resource.data.createdAt == resource.data.createdAt;
      let planUpdate = metaAdsCan("metaAdsPlanCampaign") && request.resource.data.status in ["context_ready","questions_ready","answers_ready","plan_ready"] && request.resource.data.approvedPlanRevision == resource.data.approvedPlanRevision;
      let approveUpdate = metaAdsCan("metaAdsApprovePlan") && request.resource.data.status == "approved" && resource.data.status == "plan_ready" && request.resource.data.approvedPlanRevision is int;
      return immutable && request.resource.data.updatedBy == request.auth.uid && validPlanningState(request.resource.data,campaignId) && (planUpdate || approveUpdate);
    }'''
new = '''    function planningStateUpdateAllowed(campaignId) {
      let immutable = request.resource.data.campaignId == resource.data.campaignId
        && request.resource.data.theoryId == resource.data.theoryId
        && request.resource.data.theoryVersionId == resource.data.theoryVersionId
        && request.resource.data.theoryVersion == resource.data.theoryVersion
        && request.resource.data.createdBy == resource.data.createdBy
        && request.resource.data.createdAt == resource.data.createdAt;
      return immutable
        && request.resource.data.updatedBy == request.auth.uid
        && validPlanningState(request.resource.data,campaignId)
        && (request.resource.data.status == "approved"
          ? (metaAdsCan("metaAdsApprovePlan")
            && resource.data.status == "plan_ready"
            && request.resource.data.approvedPlanRevision is int)
          : (metaAdsCan("metaAdsPlanCampaign")
            && request.resource.data.status in ["context_ready","questions_ready","answers_ready","plan_ready"]
            && request.resource.data.approvedPlanRevision == resource.data.approvedPlanRevision));
    }'''
if old not in r:
    raise SystemExit("planningStateUpdateAllowed marker not found")
r = r.replace(old, new)

p.write_text(r)
print("Applied short-circuit dispatch for Stage 4 Firestore updates")
