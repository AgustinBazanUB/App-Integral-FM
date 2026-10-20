import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { TRANSPORTS } from "../../shared/shippingDomain.mjs";

const text = value => String(value || "").replace(/[\u0000-\u001f]/g, " ");
const mmPerPoint = 0.352778;
const lineHeight = size => size * mmPerPoint * 1.15;

function measured(pdf, value, size, width, { bold = false } = {}) {
  pdf.setFont("helvetica", bold ? "bold" : "normal");
  pdf.setFontSize(size);
  return { value: text(value), size, bold, lines: pdf.splitTextToSize(text(value), width), leading: lineHeight(size) };
}

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
      measured(pdf, shipment.customerSnapshot.name, 12.36, 101, { bold: true }),
      measured(pdf, `Tel: ${shipment.customerSnapshot.phone}`, 9.84, 101),
      measured(pdf, `Dirección: ${destination.displayAddress}`, 9.84, 101),
      measured(pdf, `Observaciones: ${destination.notes || "No hay observaciones"}`, 9.84, 101),
      measured(pdf, `Pedido: ${shipment.itemsSnapshot.map(item => `${item.qty} × ${item.name}`).join("; ")}`, 9.84, 101),
    ];

    const date = new Date(shipment.saleCreatedAt?.toDate?.() || shipment.saleCreatedAt || shipment.createdAt);
    const right = [
      measured(pdf, new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }).format(date), 11.4, 38, { bold: true }),
      measured(pdf, `Prepara: ${(shipment.preparerNames || []).join(", ") || "Por asignar"}`, 9.72, 38),
      measured(pdf, `Envío: ${TRANSPORTS[shipment.deliveryType] || "Por asignar"}`, 9.72, 38),
    ];
    const zone = destination.verified && destination.provinceOrCaba && destination.neighborhoodOrLocality
      ? `${destination.provinceOrCaba} (${destination.neighborhoodOrLocality})`
      : "ZONA POR CONFIRMAR";
    const zoneBlock = measured(pdf, zone.toUpperCase(), 9, 28, { bold: true });

    // The customer name leads the middle column; each of the four detail rows
    // gets its rule below the text, like a writing line.
    let cy = y + 5.5;
    const center = [{ ...fields[0], baseline: cy, ruleY: null }];
    cy += fields[0].lines.length * fields[0].leading + 1.5;
    for (const field of fields.slice(1)) {
      const block = { ...field, baseline: cy };
      block.ruleY = cy + field.lines.length * field.leading + 0.65;
      center.push(block);
      cy = block.ruleY + 4.2;
    }
    const centerEnd = center.at(-1).ruleY;

    let ry = y + 6;
    const meta = right.map((block, index) => {
      const placed = { ...block, baseline: ry };
      ry += block.lines.length * block.leading + (index < right.length - 1 ? 2.6 : 0);
      return placed;
    });
    const rightEnd = ry;

    let qrY = y + 5.5 + zoneBlock.lines.length * zoneBlock.leading + 1.6;
    const qrSize = 19.5;
    let qrCodeY = qrY + qrSize + 3;
    const leftEnd = qrCodeY + lineHeight(8.64);
    const height = Math.max(46, centerEnd - y + 3.6, rightEnd - y + 12, leftEnd - y + 4.2);
    if (height > 271) throw new Error(`${shipment.publicCode}: el texto excede una etiqueta A4 completa. Revisá la extensión antes de imprimir; no se recortó información.`);
    if (y + height > 284) {
      pdf.addPage();
      const shift = 13 - y;
      y = 13;
      center.forEach(block => { block.baseline += shift; if (block.ruleY !== null) block.ruleY += shift; });
      meta.forEach(block => { block.baseline += shift; });
      qrY += shift;
      qrCodeY += shift;
    }

    pdf.setDrawColor(32); pdf.setLineWidth(0.38); pdf.roundedRect(10, y, 190, height, 4.5, 4.5);
    pdf.setDrawColor(198, 201, 204); pdf.setLineWidth(0.23);
    pdf.line(43, y + 2, 43, y + height - 2);
    pdf.line(152, y + 2, 152, y + height - 2);

    pdf.setTextColor(17);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(zoneBlock.size);
    pdf.text(zoneBlock.lines, 26.5, y + 5.5, { align: "center", lineHeightFactor: 1.15 });
    const qr = QRCode.create(`${url.origin}/e/${shipment.publicLookupId}`, { errorCorrectionLevel: "M" });
    // Keep a four-module quiet zone while shrinking the QR to fit the compact label.
    const modules = qr.modules.size, unit = qrSize / (modules + 8), x = 26.5 - qrSize / 2;
    pdf.setFillColor(0);
    for (let row = 0; row < modules; row++) for (let col = 0; col < modules; col++) if (qr.modules.get(row, col)) pdf.rect(x + (col + 4) * unit, qrY + (row + 4) * unit, unit + 0.005, unit + 0.005, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.64);
    pdf.text(shipment.publicCode, 26.5, qrCodeY, { align: "center" });

    for (const block of center) {
      pdf.setFont("helvetica", block.bold ? "bold" : "normal"); pdf.setFontSize(block.size);
      pdf.text(block.lines, 47, block.baseline, { lineHeightFactor: 1.15 });
      if (block.ruleY !== null) { pdf.setDrawColor(198, 201, 204); pdf.setLineWidth(0.23); pdf.line(47, block.ruleY, 148, block.ruleY); }
    }

    meta.forEach(block => {
      pdf.setFont("helvetica", block.bold ? "bold" : "normal"); pdf.setFontSize(block.size);
      pdf.text(block.lines, 156, block.baseline, { lineHeightFactor: 1.15 });
    });
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(13.44);
    pdf.text("FLOR MÍA", 196, y + height - 4.5, { align: "right" });
    y += height + 6;
  }
  return pdf;
}
