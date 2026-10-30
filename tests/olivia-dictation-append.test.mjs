import test from "node:test";
import assert from "node:assert/strict";
import { appendTranscript } from "../src/gestion/olivia/dictation.mjs";
test("dictation appends without discarding the current draft or duplicating whitespace", () => {
  assert.equal(appendTranscript("Hola", " mundo "), "Hola mundo");
  assert.equal(appendTranscript("Hola\n", "mundo"), "Hola\nmundo");
  assert.equal(appendTranscript("", " mundo "), "mundo");
  assert.equal(appendTranscript("borrador", "  "), "borrador");
});
