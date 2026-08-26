from pathlib import Path

# Keep browser/server schema and Firestore enforcement aligned to a bounded Spark-friendly size.
schema_path = Path("src/gestion/marketing/metaAds/theorySchema.js")
schema = schema_path.read_text()
schema = schema.replace("requirementCount: 80, ruleCount: 80", "requirementCount: 20, ruleCount: 20")
schema = schema.replace(".slice(0,80)", ".slice(0,20)")
schema = schema.replace("maxItems:80", "maxItems:20")
schema_path.write_text(schema)

rules_path = Path("firestore.rules")
rules = rules_path.read_text()
start = rules.index("    function validTheoryConfig(c) {")
end = rules.index("    function validTheoryParent(d) {", start)

creative_checks = "\n        && ".join(
    f"(v.size() < {i + 1} || validCreativeRequirement(v[{i}]))" for i in range(20)
)
generic_checks = "\n        && ".join(
    f"(v.size() < {i + 1} || validTheoryRule(v[{i}]))" for i in range(20)
)
validation_checks = "\n        && ".join(
    f"(v.size() < {i + 1} || validValidationRule(v[{i}]))" for i in range(20)
)

strong = f'''    function validDurationValue(v) {{
      return v == null || (v is number && v >= 0 && v <= 900);
    }}
    function validTheoryDuration(d) {{
      return d is map
        && d.keys().hasAll(["minSeconds", "idealSeconds", "maxSeconds"])
        && d.keys().hasOnly(["minSeconds", "idealSeconds", "maxSeconds"])
        && validDurationValue(d.minSeconds)
        && validDurationValue(d.idealSeconds)
        && validDurationValue(d.maxSeconds)
        && (d.minSeconds == null || d.idealSeconds == null || d.minSeconds <= d.idealSeconds)
        && (d.idealSeconds == null || d.maxSeconds == null || d.idealSeconds <= d.maxSeconds)
        && (d.minSeconds == null || d.maxSeconds == null || d.minSeconds <= d.maxSeconds);
    }}
    function validCreativeRequirement(r) {{
      return r is map
        && r.keys().hasAll(["key", "label", "required", "minCount", "recommendedCount", "maxCount", "duration", "instructions"])
        && r.keys().hasOnly(["key", "label", "required", "minCount", "recommendedCount", "maxCount", "duration", "instructions"])
        && r.key is string && r.key.size() > 0 && r.key.size() <= 64
        && r.label is string && r.label.size() > 0 && r.label.size() <= 160
        && r.required is bool
        && r.minCount is int && r.minCount >= 0 && r.minCount <= 100
        && r.recommendedCount is int && r.recommendedCount >= 0 && r.recommendedCount <= 100
        && r.maxCount is int && r.maxCount >= 0 && r.maxCount <= 100
        && r.minCount <= r.recommendedCount && r.recommendedCount <= r.maxCount
        && validTheoryDuration(r.duration)
        && r.instructions is string && r.instructions.size() <= 4000;
    }}
    function validCreativeRequirements(v) {{
      return v is list && v.size() <= 20
        && {creative_checks};
    }}
    function validTheoryRule(r) {{
      return r is map
        && r.keys().hasAll(["key", "label", "instructions", "appliesToObjectives", "appliesToPlatforms"])
        && r.keys().hasOnly(["key", "label", "instructions", "appliesToObjectives", "appliesToPlatforms"])
        && r.key is string && r.key.size() > 0 && r.key.size() <= 64
        && r.label is string && r.label.size() > 0 && r.label.size() <= 160
        && r.instructions is string && r.instructions.size() <= 4000
        && r.appliesToObjectives is list && r.appliesToObjectives.size() <= 30
        && r.appliesToPlatforms is list && r.appliesToPlatforms.size() <= 20;
    }}
    function validTheoryRuleList(v) {{
      return v is list && v.size() <= 20
        && {generic_checks};
    }}
    function validValidationRule(r) {{
      return r is map
        && r.keys().hasAll(["key", "label", "severity", "instructions"])
        && r.keys().hasOnly(["key", "label", "severity", "instructions"])
        && r.key is string && r.key.size() > 0 && r.key.size() <= 64
        && r.label is string && r.label.size() > 0 && r.label.size() <= 160
        && r.severity in ["info", "warning", "error"]
        && r.instructions is string && r.instructions.size() <= 4000;
    }}
    function validValidationRules(v) {{
      return v is list && v.size() <= 20
        && {validation_checks};
    }}
    function validQuestionPolicy(q) {{
      return q is map
        && q.keys().hasAll(["mode", "instructions", "requiredFields"])
        && q.keys().hasOnly(["mode", "instructions", "requiredFields"])
        && q.mode in ["minimal", "guided", "custom"]
        && q.instructions is string && q.instructions.size() <= 4000
        && q.requiredFields is list && q.requiredFields.size() <= 50;
    }}
    function validTheoryMetadata(m) {{
      return m is map
        && m.keys().hasAll(["compilerNotes"])
        && m.keys().hasOnly(["compilerNotes"])
        && m.compilerNotes is string && m.compilerNotes.size() <= 4000;
    }}
    function validTheoryConfig(c) {{
      return c is map
        && c.keys().hasAll(["schemaVersion", "platform", "name", "description", "campaignRules", "creativeRequirements", "validationRules", "questionPolicy", "testingRules", "recommendationRules", "metadata"])
        && c.keys().hasOnly(["schemaVersion", "platform", "name", "description", "campaignRules", "creativeRequirements", "validationRules", "questionPolicy", "testingRules", "recommendationRules", "metadata"])
        && c.schemaVersion == 1
        && c.platform is string && c.platform.size() > 0 && c.platform.size() <= 64
        && c.name is string && c.name.size() > 0 && c.name.size() <= 120
        && c.description is string && c.description.size() <= 4000
        && validTheoryRuleList(c.campaignRules)
        && validCreativeRequirements(c.creativeRequirements)
        && validValidationRules(c.validationRules)
        && validQuestionPolicy(c.questionPolicy)
        && validTheoryRuleList(c.testingRules)
        && validTheoryRuleList(c.recommendationRules)
        && validTheoryMetadata(c.metadata);
    }}
'''
rules_path.write_text(rules[:start] + strong + rules[end:])

# Extend Rules Emulator coverage for nested schema poisoning and invalid ranges.
test_path = Path("tests/firestore.meta-ads-theory.rules.mjs")
test_source = test_path.read_text()
if "Theory Rules rechazan cantidades, duraciones" not in test_source:
    test_source += r'''

test("Theory Rules rechazan cantidades, duraciones y claves anidadas inválidas", async () => {
  const db = environment.authenticatedContext("marketing-theory").firestore();
  const theoryId = "theory-invalid-nested";
  await assertSucceeds(setDoc(doc(db, "metaAdTheories", theoryId), {
    ...parent("marketing-theory"),
    name: "Nested invalid",
  }));
  const ref = doc(db, "metaAdTheories", theoryId, "versions", "v1");
  await assertSucceeds(setDoc(ref, {
    ...version("marketing-theory"),
    theoryId,
  }));
  await assertSucceeds(updateDoc(ref, {
    status: "compiling",
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
  const compilerMetadata = {
    provider: "openai",
    operation: "theory_compile",
    model: "test",
    responseId: null,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    actualCostUsd: null,
    compilerVersion: "1",
  };
  const negative = config();
  negative.creativeRequirements[0].minCount = -1;
  await assertFails(updateDoc(ref, {
    status: "review",
    config: negative,
    compilerMetadata,
    compileError: null,
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
  const badDuration = config();
  badDuration.creativeRequirements[0].duration = { minSeconds: 7, idealSeconds: 5, maxSeconds: 4 };
  await assertFails(updateDoc(ref, {
    status: "review",
    config: badDuration,
    compilerMetadata,
    compileError: null,
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
  const poisoned = config();
  poisoned.creativeRequirements[0].html = "<script>";
  await assertFails(updateDoc(ref, {
    status: "review",
    config: poisoned,
    compilerMetadata,
    compileError: null,
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
});
'''
    test_path.write_text(test_source)

print("Stage 3 Rules hardened")
