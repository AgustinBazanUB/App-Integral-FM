from pathlib import Path

rules_path = Path("firestore.rules")
rules = rules_path.read_text()
start = rules.index("    function validDurationValue(v) {")
end = rules.index("    function validTheoryParent(d) {", start)

creative_checks = "\n        && ".join(
    f"(v.size() < {i + 1} || validCreativeRequirement(v[{i}]))" for i in range(8)
)

replacement = f'''    function validDurationValue(v) {{
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
      return v is list && v.size() <= 8
        && {creative_checks};
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
        && c.campaignRules is list && c.campaignRules.size() <= 20
        && validCreativeRequirements(c.creativeRequirements)
        && c.validationRules is list && c.validationRules.size() <= 20
        && validQuestionPolicy(c.questionPolicy)
        && c.testingRules is list && c.testingRules.size() <= 20
        && c.recommendationRules is list && c.recommendationRules.size() <= 20
        && validTheoryMetadata(c.metadata);
    }}
'''
rules_path.write_text(rules[:start] + replacement + rules[end:])

# Align the central schema to the Firestore-safe maximum for dynamic creative categories.
schema_path = Path("src/gestion/marketing/metaAds/theorySchema.js")
schema = schema_path.read_text()
schema = schema.replace("requirementCount: 20, ruleCount: 20", "requirementCount: 8, ruleCount: 20")
schema = schema.replace("creativeRequirements:(Array.isArray(input.creativeRequirements)?input.creativeRequirements:[]).slice(0,20)", "creativeRequirements:(Array.isArray(input.creativeRequirements)?input.creativeRequirements:[]).slice(0,8)")
schema = schema.replace('creativeRequirements:{type:"array",maxItems:20,items:', 'creativeRequirements:{type:"array",maxItems:8,items:')
schema_path.write_text(schema)

print("Stage 3 Rules simplified below Firestore expression budget")
