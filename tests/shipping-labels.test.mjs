import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { buildShippingLabelPdf } from "../src/gestion/shipping/shippingLabels.mjs";
export const fixture = (id = "1", long = false) => ({ id, publicCode: `FM-E-PRUEBA${id}`, publicLookupId: `public_lookup_${id}_cryptographic_fixture`, destination: { displayAddress: long ? "Avenida de prueba con nombre largo 1234, piso 7 departamento B, localidad de prueba, provincia de Buenos Aires" : "Calle de prueba 123, CABA", notes: long ? "Observaciones de prueba extensas para verificar el ajuste automático de texto. ".repeat(7) : "" }, customerSnapshot: { name: "Cliente de prueba para revisión", phone: "11 0000-0000" }, itemsSnapshot: long ? Array.from({ length: 20 }, (_, index) => ({ qty: index + 1, name: `Producto de prueba ${index + 1} con descripción y presentación de 2 litros` })) : [{ qty: 2, name: "Aceite de oliva de prueba 2 L" }], preparerNames: ["Preparador de prueba", "Segunda persona"], deliveryType: "repository", saleCreatedAt: "2026-10-16T15:00:00Z", createdAt: "2026-10-16T15:00:00Z" });
test("labels: deduplicated A4 batch, three standard labels per page, no financial fields", async () => {
  const pdf = await buildShippingLabelPdf([fixture("1"), fixture("1"), fixture("2"), fixture("3")], "https://flormia.example");
  assert.equal(pdf.getNumberOfPages(), 1);
  assert.equal(Math.round(pdf.internal.pageSize.getWidth()), 210);
  assert.equal(Math.round(pdf.internal.pageSize.getHeight()), 297);
  const output = pdf.output();
  assert.equal(output.match(/CONFIRMAR/g).length, 3);
  assert(!/DNI|CUIT|Efectivo|Subtotal/.test(output));
});
test("labels: long content wraps to taller labels with page breaks, impossible overflow fails explicitly", async () => {
  const pdf = await buildShippingLabelPdf([fixture("1", true), fixture("2", true), fixture("3", true)], "https://flormia.example");
  assert(pdf.getNumberOfPages() >= 2);
  const enormous = fixture("4"); enormous.destination.notes = "Texto de prueba ".repeat(5000);
  await assert.rejects(buildShippingLabelPdf([enormous], "https://flormia.example"), /excede/);
});
test("QR payload roundtrip at print scale identifies an independent operational URL", () => {
  for (const id of ["one", "two"]) {
    const url = `https://flormia.example/e/${fixture(id).publicLookupId}`, qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const scale = 6, size = (qr.modules.size + 8) * scale, data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < qr.modules.size; row++) for (let col = 0; col < qr.modules.size; col++) if (qr.modules.get(row, col)) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const offset = (((row + 4) * scale + dy) * size + (col + 4) * scale + dx) * 4; data[offset] = data[offset + 1] = data[offset + 2] = 0; }
    assert.equal(jsQR(data, size, size)?.data, url);
  }
});
