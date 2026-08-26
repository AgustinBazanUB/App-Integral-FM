import { THEORY_LIMITS } from "./theorySchema.js";

export const PDF_TEXT_LIMITS = Object.freeze({
  maxBytes: THEORY_LIMITS.sourceBytes,
  maxPages: THEORY_LIMITS.pdfPages,
  maxCharacters: THEORY_LIMITS.sourceCharacters,
});

function pdfError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function bytesToLatin1(bytes) {
  const chunk = 32_768;
  let result = "";
  for (let index = 0; index < bytes.length; index += chunk) {
    result += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
  }
  return result;
}

function latin1ToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

function decodeEscapedLiteral(value) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") { result += char; continue; }
    const next = value[index + 1];
    if (next == null) break;
    if (next === "n") { result += "\n"; index += 1; continue; }
    if (next === "r") { result += "\r"; index += 1; continue; }
    if (next === "t") { result += "\t"; index += 1; continue; }
    if (next === "b") { result += "\b"; index += 1; continue; }
    if (next === "f") { result += "\f"; index += 1; continue; }
    if (next === "(" || next === ")" || next === "\\") { result += next; index += 1; continue; }
    if (/[0-7]/.test(next)) {
      const match = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] || "";
      if (match) { result += String.fromCharCode(parseInt(match, 8)); index += match.length; continue; }
    }
    if (next === "\n") { index += 1; continue; }
    if (next === "\r") { index += value[index + 2] === "\n" ? 2 : 1; continue; }
    result += next;
    index += 1;
  }
  return result;
}

function decodeHexText(hex) {
  const clean = hex.replace(/\s+/g, "");
  if (!clean || !/^[0-9a-f]+$/i.test(clean)) return "";
  const padded = clean.length % 2 ? `${clean}0` : clean;
  const bytes = [];
  for (let index = 0; index < padded.length; index += 2) bytes.push(parseInt(padded.slice(index, index + 2), 16));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    return text;
  }
  return String.fromCharCode(...bytes);
}

function extractTextOperators(content) {
  const fragments = [];
  const literalRegex = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/g;
  for (const match of content.matchAll(literalRegex)) fragments.push(decodeEscapedLiteral(match[1]));
  const hexRegex = /<([0-9a-fA-F\s]+)>\s*Tj/g;
  for (const match of content.matchAll(hexRegex)) fragments.push(decodeHexText(match[1]));
  const arrayRegex = /\[((?:.|\n|\r)*?)\]\s*TJ/g;
  for (const match of content.matchAll(arrayRegex)) {
    const pieces = [];
    const tokenRegex = /\(((?:\\.|[^\\()])*)\)|<([0-9a-fA-F\s]+)>/g;
    for (const token of match[1].matchAll(tokenRegex)) pieces.push(token[1] != null ? decodeEscapedLiteral(token[1]) : decodeHexText(token[2]));
    if (pieces.length) fragments.push(pieces.join(""));
  }
  return fragments;
}

async function inflateFlate(binaryText) {
  if (typeof DecompressionStream !== "function") return null;
  try {
    const stream = new Blob([latin1ToBytes(binaryText)]).stream().pipeThrough(new DecompressionStream("deflate"));
    const buffer = await new Response(stream).arrayBuffer();
    return bytesToLatin1(new Uint8Array(buffer));
  } catch { return null; }
}

async function contentStreams(raw) {
  const results = [raw];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streamRegex)) {
    const before = raw.slice(Math.max(0, match.index - 800), match.index);
    const stream = match[1];
    if (/\/FlateDecode\b/.test(before)) {
      const inflated = await inflateFlate(stream);
      if (inflated) results.push(inflated);
    } else results.push(stream);
    if (results.length > 500) break;
  }
  return results;
}

function normalizeExtractedText(fragments) {
  const cleaned = [];
  let previous = "";
  for (const fragment of fragments) {
    const value = String(fragment || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!value || value === previous) continue;
    const printable = [...value].filter((char) => { const code = char.charCodeAt(0); return code === 9 || code === 10 || code === 13 || code >= 32; }).length;
    if (printable / Math.max(1, value.length) < 0.85) continue;
    previous = value;
    cleaned.push(value);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, PDF_TEXT_LIMITS.maxCharacters).trim();
}

export async function extractPdfText(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw pdfError("pdf-invalid", "Seleccioná un archivo PDF válido.");
  if (file.size > PDF_TEXT_LIMITS.maxBytes) throw pdfError("pdf-too-large", `El PDF supera el límite de ${(PDF_TEXT_LIMITS.maxBytes / 1_000_000).toFixed(1)} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 5 || bytesToLatin1(bytes.subarray(0, 5)) !== "%PDF-") throw pdfError("pdf-invalid", "El archivo seleccionado no parece ser un PDF válido.");
  const raw = bytesToLatin1(bytes);
  const pageMatches = raw.match(/\/Type\s*\/Page(?!s)\b/g) || [];
  const pageCount = pageMatches.length || null;
  if (pageCount && pageCount > PDF_TEXT_LIMITS.maxPages) throw pdfError("pdf-too-many-pages", `El PDF supera el límite de ${PDF_TEXT_LIMITS.maxPages} páginas.`);
  const streams = await contentStreams(raw);
  const text = normalizeExtractedText(streams.flatMap(extractTextOperators));
  if (text.length < 20) throw pdfError("pdf-no-extractable-text", "Este PDF no contiene texto extraíble. Probá con texto, Markdown o el editor interno.");
  return { text, sourceSize: file.size, sourceName: file.name || "Documento PDF", sourceType: "pdf", pageCount, truncated: text.length >= PDF_TEXT_LIMITS.maxCharacters };
}
