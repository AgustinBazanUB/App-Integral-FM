import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { extractPdfText } from "../src/gestion/marketing/metaAds/pdfTextExtractor.js";

function ascii85(bytes) {
  let result = "";
  for (let index = 0; index < bytes.length; index += 4) {
    const group = bytes.subarray(index, Math.min(index + 4, bytes.length));
    const padded = Buffer.alloc(4);
    group.copy(padded);
    let value = padded.readUInt32BE(0);
    const chars = Array(5);
    for (let digit = 4; digit >= 0; digit -= 1) { chars[digit] = String.fromCharCode((value % 85) + 33); value = Math.floor(value / 85); }
    result += group.length === 4 ? chars.join("") : chars.slice(0, group.length + 1).join("");
  }
  return result;
}

function selectablePdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const encoded = `${ascii85(deflateSync(Buffer.from(stream, "latin1")))}~>`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Filter [/ASCII85Decode /FlateDecode] /Length ${encoded.length} >>\nstream\n${encoded}\nendstream\nendobj\n%%EOF`, "latin1");
}

test("extrae PDF textual con filtros ASCII85 y Flate", async () => {
  const bytes = selectablePdf("La campana requiere 3 hooks de entre 3 y 6 segundos.");
  const result = await extractPdfText({ name: "metodologia.pdf", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.equal(result.sourceType, "pdf");
  assert.equal(result.pageCount, 1);
  assert.match(result.text, /3 hooks/);
  assert.match(result.text, /3 y 6 segundos/);
});

test("extrae un stream ASCII85 sin salto antes de endstream", async () => {
  const bytes = Buffer.from(selectablePdf("Cierre de stream sin salto y texto seleccionable.").toString("latin1").replace("~>\nendstream", "~>endstream"), "latin1");
  const result = await extractPdfText({ name: "reportlab.pdf", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  assert.match(result.text, /texto seleccionable/);
});

test("rechaza un PDF sin operadores de texto", async () => {
  const bytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF", "latin1");
  await assert.rejects(
    () => extractPdfText({ name: "escaneado.pdf", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
    { code: "pdf-no-extractable-text" },
  );
});
