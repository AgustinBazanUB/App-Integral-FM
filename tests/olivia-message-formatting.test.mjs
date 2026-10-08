import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OliviaRichText } from "../src/gestion/olivia/messageFormatting.mjs";

const render = content => renderToStaticMarkup(createElement(OliviaRichText, { content }));

test("las respuestas renderizan estructura semántica, listas anidadas, énfasis y tablas", () => {
  const html = render("### Stock\n\nRespuesta **destacada** y *aclaración*.\n\n1. Revisar productos\n   - Aceite: **410 unidades**\n   - Almendras: 0\n2. Confirmar\n\n| Producto | Cantidad |\n| --- | ---: |\n| Aceite | 410 |\n\n> Stock consultado.\n\nUsá `stock`.\n\n```text\nregistro\n```");
  for (const markup of ["<h3>Stock</h3>", "<strong>destacada</strong>", "<em>aclaración</em>", "<ol>", "<ul>", "<strong>410 unidades</strong>", "<table>", "<blockquote>", "<code>stock</code>", "<pre>"]) assert.ok(html.includes(markup), markup);
  assert.match(html, /Tabla de la respuesta/);
});

test("HTML, enlaces peligrosos, credenciales e imágenes externas no generan contenido activo", () => {
  const html = render('<script>alert(1)</script>\n\n[Malicioso](javascript:alert%281%29) [Datos](data:text/html,test) [Clave](https://user:pass@example.org) ![Foto](https://example.org/tracker.png) [Fuente](https://example.org/formula)');
  assert.doesNotMatch(html, /<script|<img|onerror|href="(?:javascript|data)|user:pass|tracker\.png/);
  assert.match(html, /<span>Malicioso<\/span>/);
  assert.match(html, /href="https:\/\/example.org\/formula" target="_blank" rel="noopener noreferrer"/);
});

test("el historial operativo agrupa productos sin alterar precios, cantidades ni nombres con markup", () => {
  const content = "Ingresar mercadería en Local Lavalle: 2 productos, 552 unidades. Se crearán 1 productos y 0 categorías.\nCrear Dulce [especial](https://example.org) · DULCE · Mermeladas · $14000: +12 unidades; stock 0 → 12.\nReutilizar Arbequina 500cc · ARB500 · Aceites · $22000: +540 unidades; stock 41 → 581.\nSolo al tocar Sí se crea el catálogo faltante y se carga toda la lista.";
  const html = render(content);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /<h3>Productos<\/h3>/);
  assert.ok(html.replace(/<[^>]*>/g, "").includes("Crear Dulce [especial](https://example.org)"));
  for (const text of ["$14000: +12", "$22000: +540", "41 → 581", "Solo al tocar Sí"]) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /<a /);
});

test("datos faltantes e incrementos de una respuesta conservan texto y se pueden renderizar", () => {
  const html = render("Para completar la lista falta el precio de venta de «Dulce»; cuál producto corresponde a «Aceitunas»: Aceitunas Griegas 500g. No se creó ni cargó nada todavía.");
  assert.match(html, /<h3>Datos que faltan<\/h3>/);
  assert.equal((html.match(/<li>/g) || []).length, 2);
  assert.match(html, /No se creó ni cargó nada todavía/);
  for (const text of ["### Propuesta\n\n- **Aceite", "| Nombre | Cantidad |\n|", "```text\nregistro", "Respuesta **parcial"]) assert.doesNotThrow(() => render(text));
});
