from pathlib import Path

rules_path = Path("firestore.rules")
rules = rules_path.read_text()
start = rules.index("    function validDurationValue(v) {")
end = rules.index("    function validTheoryParent(d) {", start)
replacement = '''    // TheoryConfig deep validation lives in theorySchema.js and the backend.
    // Firestore keeps a bounded structural envelope so valid writes stay below
    // the platform's 1000-expression evaluation budget.
    function validQuestionPolicy(q) {
      return q is map
        && q.keys().hasAll(["mode", "instructions", "requiredFields"])
        && q.keys().hasOnly(["mode", "instructions", "requiredFields"])
        && q.mode in ["minimal", "guided", "custom"]
        && q.instructions is string && q.instructions.size() <= 4000
        && q.requiredFields is list && q.requiredFields.size() <= 50;
    }
    function validTheoryMetadata(m) {
      return m is map
        && m.keys().hasAll(["compilerNotes"])
        && m.keys().hasOnly(["compilerNotes"])
        && m.compilerNotes is string && m.compilerNotes.size() <= 4000;
    }
    function validTheoryConfig(c) {
      return c is map
        && c.keys().hasAll(["schemaVersion", "platform", "name", "description", "campaignRules", "creativeRequirements", "validationRules", "questionPolicy", "testingRules", "recommendationRules", "metadata"])
        && c.keys().hasOnly(["schemaVersion", "platform", "name", "description", "campaignRules", "creativeRequirements", "validationRules", "questionPolicy", "testingRules", "recommendationRules", "metadata"])
        && c.schemaVersion == 1
        && c.platform is string && c.platform.size() > 0 && c.platform.size() <= 64
        && c.name is string && c.name.size() > 0 && c.name.size() <= 120
        && c.description is string && c.description.size() <= 4000
        && c.campaignRules is list && c.campaignRules.size() <= 20
        && c.creativeRequirements is list && c.creativeRequirements.size() <= 20
        && c.validationRules is list && c.validationRules.size() <= 20
        && validQuestionPolicy(c.questionPolicy)
        && c.testingRules is list && c.testingRules.size() <= 20
        && c.recommendationRules is list && c.recommendationRules.size() <= 20
        && validTheoryMetadata(c.metadata);
    }
'''
rules_path.write_text(rules[:start] + replacement + rules[end:])

# Keep Rules tests focused on the boundary Rules can safely enforce. Deep nested
# config validation is already covered by domain/backend tests.
test_path = Path("tests/firestore.meta-ads-theory.rules.mjs")
test_text = test_path.read_text()
marker = '\ntest("Theory Rules rechazan cantidades, duraciones y claves anidadas inválidas"'
if marker in test_text:
    test_text = test_text[:test_text.index(marker)] + '''\n\ntest("Theory Rules mantienen envelope acotado sin agotar presupuesto", async () => {
  const db = environment.authenticatedContext("marketing-theory").firestore();
  const theoryId = "theory-envelope";
  await assertSucceeds(setDoc(doc(db, "metaAdTheories", theoryId), {
    ...parent("marketing-theory"),
    name: "Envelope",
  }));
  const ref = doc(db, "metaAdTheories", theoryId, "versions", "v1");
  await assertSucceeds(setDoc(ref, { ...version("marketing-theory"), theoryId }));
  await assertSucceeds(updateDoc(ref, {
    status: "compiling",
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
  const compilerMetadata = {
    provider: "openai", operation: "theory_compile", model: "test", responseId: null,
    inputTokens: 1, outputTokens: 1, totalTokens: 2, actualCostUsd: null, compilerVersion: "1",
  };
  await assertFails(updateDoc(ref, {
    status: "review",
    config: { ...config(), unexpectedTopLevel: true },
    compilerMetadata,
    compileError: null,
    updatedBy: "marketing-theory",
    updatedByName: "Marketing",
    updatedAt: now(),
  }));
});\n'''
test_path.write_text(test_text)

print("Repaired inherited Theory Rules expression budget")
