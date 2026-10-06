import test from "node:test";
import assert from "node:assert/strict";
import { oliviaMessageBlocks, oliviaInlineParts } from "../src/gestion/olivia/messageFormatting.mjs";

test("inventory and metrics replies render paragraphs and grouped lists", () => {
  const blocks = oliviaMessageBlocks("**Instal**\n\n- Aceite: **410 unidades**\n- Almendras: 0 unidades\n\nListado completo.");
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "list", "paragraph"]);
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(oliviaInlineParts(blocks[1].items[0]), [{ strong: false, text: "Aceite: " }, { strong: true, text: "410 unidades" }]);
  assert.equal(oliviaMessageBlocks("1. Ventas\n2. Operaciones")[0].type, "ordered");
});

test("untrusted HTML and links remain literal text in the formatting grammar", () => {
  const text = '<img src=x onerror=alert(1)> [Abrir](javascript:alert(1))';
  assert.deepEqual(oliviaMessageBlocks(text), [{ type: "paragraph", text }]);
  assert.deepEqual(oliviaInlineParts(text), [{ strong: false, text }]);
});
