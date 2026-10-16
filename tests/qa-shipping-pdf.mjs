// Synthetic output for visual inspection; no Firebase, customers or fiscal calls.
import { mkdir, writeFile } from "node:fs/promises";
import { buildShippingLabelPdf } from "../src/gestion/shipping/shippingLabels.mjs";
const fixture = (id, long = false) => ({ id, publicCode: `FM-E-PRUEBA${id}`, publicLookupId: `synthetic_${id}_not_an_authorization`, destination: { displayAddress: "Avenida de prueba 1234, piso 2, departamento B, CABA", notes: long ? "Entregar después de las 18. El portero está sobre la calle lateral. ".repeat(4) : "" }, customerSnapshot: { name: "Destinatario de prueba", phone: "11 0000-0000" }, itemsSnapshot: Array.from({ length: long ? 17 : 3 }, (_, i) => ({ qty: i + 1, name: `Producto de prueba ${i + 1} · presentación 2 L` })), preparerNames: ["Preparador de prueba", "Segunda persona asignada"], deliveryType: id === "2" ? "repository" : "manual", saleCreatedAt: "2026-10-16T15:00:00Z", createdAt: "2026-10-16T15:00:00Z" });
const rows = [fixture("1"), fixture("2"), fixture("3"), fixture("4", true)];
const pdf = await buildShippingLabelPdf(rows, "https://flormia.example");
await mkdir("tmp/shipping-qa", { recursive: true });
await writeFile("tmp/shipping-qa/etiquetas-a4.pdf", new Uint8Array(pdf.output("arraybuffer")));
console.log(JSON.stringify({ pages: pdf.getNumberOfPages(), labels: rows.length, path: "tmp/shipping-qa/etiquetas-a4.pdf", qrUrls: rows.map(row => `https://flormia.example/e/${row.publicLookupId}`) }));
