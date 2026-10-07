import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Venta Rápida compacta canal/stock, cliente y categorías en acordeón único", async () => {
  const page = await read("../src/gestion/pages/QuickSalesPage.jsx");

  assert.match(page, /Elegir canal y stock/);
  assert.match(page, /Canal: indica por dónde llegó la venta\. Stock: define la ubicación o depósito/);
  assert.doesNotMatch(page, />Canal:\s*\{/);
  assert.doesNotMatch(page, />Stock:\s*\{/);

  assert.match(page, /className="fm-seller-add-customer"/);
  assert.match(page, /<strong>Agregar cliente<\/strong>/);

  assert.match(page, /const \[openCategoryId, setOpenCategoryId\] = useState\("")/);
  assert.match(page, /const open = openCategoryId === group\.id/);
  assert.match(page, /setOpenCategoryId\(current => current === group\.id \? "" : group\.id\)/);
  assert.match(page, /setOpenCategoryId\("")/);
  assert.doesNotMatch(page, /<details[^>]*\sopen/);
});

test("Venta Rápida mantiene el modal fiscal explícito", async () => {
  const page = await read("../src/gestion/pages/QuickSalesPage.jsx");
  assert.match(page, /title="Cargar factura"/);
  assert.match(page, />Generar factura y continuar</);
  assert.match(page, />Solo continuar</);
});
