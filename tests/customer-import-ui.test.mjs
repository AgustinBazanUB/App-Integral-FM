import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseFlorMiaContactImport } from "../src/gestion/customers/customerImport.js";

test("Flor Mía WhatsApp Sender import deduplicates phones and preserves zone evidence", () => {
  const parsed = parseFlorMiaContactImport([
    ["Telefono", "Nombre y Apellido", "Zona"],
    ["+54 9 11 5555 0001", "Ana Pérez", "Tribunales"],
    ["11 5555 0001", "", "Microcentro"],
    ["+54 9 11 5555 0002", "", "Tribunales"],
    ["", "Sin teléfono", "Tribunales"],
  ], [{ id: "tribunales", name: "Tribunales", active: true }]);

  assert.equal(parsed.summary.total, 4);
  assert.equal(parsed.summary.valid, 2);
  assert.equal(parsed.summary.duplicates, 1);
  assert.equal(parsed.summary.invalid, 1);
  assert.equal(parsed.rows[0].name, "Ana Pérez");
  assert.equal(parsed.rows[0].zone, "Tribunales | Microcentro");
  assert.equal(parsed.rows[1].zoneId, "tribunales");
});

test("Clientes page exposes bulk import next to manual creation with contextual help", async () => {
  const page = await readFile(new URL("../src/gestion/pages/LoyalCustomersPage.jsx", import.meta.url), "utf8");
  const modules = await readFile(new URL("../src/gestion/modules.js", import.meta.url), "utf8");
  const modal = await readFile(new URL("../src/gestion/customers/CustomerImportModal.jsx", import.meta.url), "utf8");

  assert.match(page, /title="Clientes"/);
  assert.match(page, />Nuevo cliente<\/Button>/);
  assert.match(page, />\s*Agregar Clientes\s*<\/Button>/);
  assert.match(page, /CustomerImportModal/);
  assert.match(page, /Flor Mía WhatsApp Sender/);
  assert.match(page, /Contactos → elegí la etiqueta → Analizar → Exportar Excel/);
  assert.match(modules, /label: "Clientes"/);
  assert.match(modal, /Telefono, Nombre y Apellido y Zona/);
});
