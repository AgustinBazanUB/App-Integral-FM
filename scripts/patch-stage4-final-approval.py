from pathlib import Path

# Strengthen the parent approval transition: approval only starts from a real
# plan_ready campaign that already has at least one generated revision.
rules = Path("firestore.rules")
r = rules.read_text()
old = '''        && resource.data.status in ["planning","creative"]
        && request.resource.data.status == "creative"'''
new = '''        && resource.data.status in ["planning","creative"]
        && resource.data.planningStatus == "plan_ready"
        && resource.data.latestPlanRevision >= 1
        && request.resource.data.status == "creative"'''
if old not in r:
    raise SystemExit("approval rule marker not found")
r = r.replace(old, new, 1)
rules.write_text(r)

# The rules test must mirror persistGeneratedPlan(): creating r1 is followed by
# planning/state + CampaignProject moving to plan_ready/latestPlanRevision=1.
test = Path("tests/firestore.meta-ads-planner.rules.mjs")
s = test.read_text()
old_test = '''test("CampaignPlan draft válido se crea y TheoryVersion no puede alterarse",async()=>{const db=environment.authenticatedContext("marketing-planner").firestore(),ref=doc(db,"metaCampaignProjects","campaign-seeded","plans","r1"),valid={...planEnvelope("marketing-planner"),campaignId:"campaign-seeded"};await assertSucceeds(setDoc(ref,valid));await assertFails(updateDoc(ref,{theoryVersionId:"v999",updatedBy:"marketing-planner",updatedByName:"Marketing",updatedAt:now()}));});'''
new_test = '''test("CampaignPlan draft válido se crea y TheoryVersion no puede alterarse",async()=>{const db=environment.authenticatedContext("marketing-planner").firestore(),ref=doc(db,"metaCampaignProjects","campaign-seeded","plans","r1"),valid={...planEnvelope("marketing-planner"),campaignId:"campaign-seeded"};await assertSucceeds(setDoc(ref,valid));await assertSucceeds(updateDoc(doc(db,"metaCampaignProjects","campaign-seeded","planning","state"),{status:"plan_ready",latestPlanRevision:1,updatedBy:"marketing-planner",updatedByName:"Marketing",updatedAt:now()}));await assertSucceeds(updateDoc(doc(db,"metaCampaignProjects","campaign-seeded"),{planningStatus:"plan_ready",latestPlanRevision:1,lastPlanningAt:now(),lastPlanningBy:"marketing-planner",updatedBy:"marketing-planner",updatedByName:"Marketing",updatedAt:now()}));await assertFails(updateDoc(ref,{theoryVersionId:"v999",updatedBy:"marketing-planner",updatedByName:"Marketing",updatedAt:now()}));});'''
if old_test not in s:
    raise SystemExit("planner rules test marker not found")
s = s.replace(old_test, new_test, 1)
test.write_text(s)

print("Aligned Stage 4 approval test with persistGeneratedPlan and tightened approval precondition")
