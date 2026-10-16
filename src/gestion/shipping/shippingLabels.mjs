import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { TRANSPORTS } from "../../shared/shippingDomain.mjs";

const text = value => String(value || "").replace(/[\u0000-\u001f]/g, " ");
export async function buildShippingLabelPdf(input, baseUrl) {
  const shipments = [...new Map(input.filter(Boolean).map(row => [row.id, row])).values()].sort((a, b) => new Date(a.createdAt?.toDate?.() || a.createdAt) - new Date(b.createdAt?.toDate?.() || b.createdAt) || a.id.localeCompare(b.id));
  if (!shipments.length) throw new Error("Seleccioná al menos un envío autorizado.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Las etiquetas requieren la URL HTTPS de Flor Mía.");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", putOnlyUsedFonts: true });
  pdf.setProperties({ title: "Flor Mía · Etiquetas de envíos", subject: "Etiquetas logísticas", creator: "Flor Mía" });
  let y = 13;
  for (const shipment of shipments) {
    if (!/^[A-Za-z0-9_-]+$/.test(shipment.publicLookupId)) throw new Error("El envío no tiene un QR válido.");
    const destination = shipment.destination;
    const fields = [
      { value: shipment.customerSnapshot.name, size: 10.3, bold: true },
      { value: `Tel: ${shipment.customerSnapshot.phone}`, size: 8.2 },
      { value: `Dirección: ${destination.displayAddress}`, size: 8.2 },
      { value: `Observaciones: ${destination.notes || "No hay observaciones"}`, size: 8.2 },
      { value: `Pedido: ${shipment.itemsSnapshot.map(item => `${item.qty} × ${item.name}`).join("; ")}`, size: 8.2 },
    ].map(field => { pdf.setFont("helvetica", field.bold ? "bold" : "normal"); pdf.setFontSize(field.size); return { ...field, lines: pdf.splitTextToSize(text(field.value), 100) }; });
    const date = new Date(shipment.saleCreatedAt?.toDate?.() || shipment.saleCreatedAt || shipment.createdAt);
    const right = [new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }).format(date), `Prepara: ${(shipment.preparerNames || []).join(", ") || "Por asignar"}`, `Envío: ${TRANSPORTS[shipment.deliveryType] || "Por asignar"}`].map(value => { pdf.setFontSize(8.1); pdf.setFont("helvetica", "normal"); return pdf.splitTextToSize(text(value), 42); });
    const zone = destination.verified && destination.provinceOrCaba && destination.neighborhoodOrLocality ? `${destination.provinceOrCaba} (${destination.neighborhoodOrLocality})` : "ZONA POR CONFIRMAR";
    pdf.setFontSize(7.5); pdf.setFont("helvetica", "bold");
    const zoneLines = pdf.splitTextToSize(text(zone.toUpperCase()), 28);
    const centerHeight = fields.reduce((height, field) => height + field.lines.length * field.size * 0.352778 * 1.2 + 3, 0);
    const rightHeight = right.reduce((height, lines) => height + lines.length * 3.5 + 4, 0) + 12;
    const height = Math.max(78, centerHeight + 6, rightHeight + 6, 44 + zoneLines.length * 3.3);
    if (height > 271) throw new Error(`${shipment.publicCode}: el texto excede una etiqueta A4 completa. Revisá la extensión antes de imprimir; no se recortó información.`);
    if (y + height > 284) { pdf.addPage(); y = 13; }
    pdf.setDrawColor(32); pdf.setLineWidth(0.38); pdf.roundedRect(10, y, 190, height, 5.5, 5.5);
    pdf.setDrawColor(198, 201, 204); pdf.setLineWidth(0.23); pdf.line(43, y + 2.2, 43, y + height - 2.2); pdf.line(152, y + 2.2, 152, y + height - 2.2);
    pdf.setTextColor(17); pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.5);
    pdf.text(zoneLines, 26.5, y + 6, { align: "center", lineHeightFactor: 1.2 });
    const qrY = y + 9 + zoneLines.length * 3.3;
    const qr = QRCode.create(`${url.origin}/e/${shipment.publicLookupId}`, { errorCorrectionLevel: "M" });
    // Draw modules as vectors with four-module quiet zone; no raster scaling.
    const modules = qr.modules.size, unit = 26 / (modules + 8), x = 13.5;
    pdf.setFillColor(0);
    for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) if (qr.modules.get(row, col)) pdf.rect(x + (col + 4) * unit, qrY + (row + 4) * unit, unit + 0.005, unit + 0.005, "F");
    pdf.setFontSize(7.2); pdf.text(shipment.publicCode, 26.5, qrY + 30, { align: "center" });
    let cy = y + 6;
    for (const [index, field] of fields.entries()) { pdf.setFont("helvetica", field.bold ? "bold" : "normal"); pdf.setFontSize(field.size); pdf.text(field.lines, 47, cy, { lineHeightFactor: 1.2 }); cy += field.lines.length * field.size * 0.352778 * 1.2 + 3; if (index < fields.length - 1) pdf.line(47, cy - 2.4, 148, cy - 2.4); }
    let ry = y + 6;
    right.forEach((lines, index) => { pdf.setFontSize(index === 0 ? 9.5 : 8.1); pdf.setFont("helvetica", index === 0 ? "bold" : "normal"); pdf.text(lines, 156, ry, { lineHeightFactor: 1.2 }); ry += lines.length * 3.5 + 4; });
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11.2); pdf.text("FLOR MÍA", 196, y + height - 5, { align: "right" });
    y += height + 7;
  }
  return pdf;
}
