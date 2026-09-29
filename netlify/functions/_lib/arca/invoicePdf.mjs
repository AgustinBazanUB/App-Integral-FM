import { buildArcaQrPayload, qrMatrix } from "./invoiceQr.mjs";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

function cleanText(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\u0009\u000A\u000D\u0020-\u00FF]/g, "?");
}

function pdfString(value) {
  return cleanText(value).replace(/([\\()])/g, "\\$1").replace(/\r?\n/g, " ");
}

function money(value) {
  return Number(value || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ymd(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "";
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function dmy(value) {
  const key = /^\d{8}$/.test(String(value || ""))
    ? `${String(value).slice(0, 4)}-${String(value).slice(4, 6)}-${String(value).slice(6, 8)}`
    : String(value || "");
  const date = key ? new Date(`${key}T12:00:00Z`) : null;
  return date && !Number.isNaN(date.valueOf())
    ? `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`
    : key;
}

function wrap(value, max = 72) {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= max) line = candidate;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function commandText(x, y, size, value, bold = false) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfString(value)}) Tj ET\n`;
}

function commandLine(x1, y1, x2, y2, width = 0.7) {
  return `${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
}

function commandRect(x, y, width, height, fill = false) {
  return `${x} ${y} ${width} ${height} re ${fill ? "f" : "S"}\n`;
}

function latin1Buffer(value) {
  return Buffer.from(cleanText(value), "latin1");
}

function assemblePdf(pageStreams) {
  const objects = new Map();
  const pageRefs = pageStreams.map((_, index) => 5 + index * 2);
  objects.set(1, Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`, "ascii"));
  objects.set(3, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "ascii"));
  objects.set(4, Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "ascii"));

  pageStreams.forEach((stream, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    const content = latin1Buffer(stream);
    objects.set(pageObject, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`, "ascii"));
    objects.set(contentObject, Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "ascii"),
      content,
      Buffer.from("\nendstream", "ascii"),
    ]));
  });

  const maxObject = Math.max(...objects.keys());
  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = Array(maxObject + 1).fill(0);
  let offset = chunks[0].length;
  for (let id = 1; id <= maxObject; id += 1) {
    const body = objects.get(id);
    if (!body) throw new Error(`Objeto PDF faltante: ${id}`);
    offsets[id] = offset;
    const chunk = Buffer.concat([Buffer.from(`${id} 0 obj\n`, "ascii"), body, Buffer.from("\nendobj\n", "ascii")]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xrefOffset = offset;
  let xref = `xref\n0 ${maxObject + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObject; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, "ascii"));
  return Buffer.concat(chunks);
}

function issuerVatLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "responsable_inscripto") return "IVA Responsable Inscripto";
  return String(value || "").replaceAll("_", " ");
}

function receiverVatLabel(id) {
  return ({
    1: "IVA Responsable Inscripto",
    4: "IVA Sujeto Exento",
    5: "Consumidor Final",
    6: "Responsable Monotributo",
    7: "Sujeto No Categorizado",
    13: "Monotributista Social",
    15: "IVA No Alcanzado",
    16: "Monotributista Trabajador Independiente Promovido",
  })[Number(id)] || `Condición ${id || "-"}`;
}

function requiredIssuer(env = {}) {
  const issuer = {
    legalName: String(env.ARCA_ISSUER_LEGAL_NAME || "").trim(),
    fiscalAddress: String(env.ARCA_ISSUER_FISCAL_ADDRESS || "").trim(),
    grossIncome: String(env.ARCA_ISSUER_GROSS_INCOME || "").trim(),
    activityStart: String(env.ARCA_ISSUER_ACTIVITY_START || "").trim(),
    vatCondition: String(env.ARCA_ISSUER_VAT_CONDITION || "").trim(),
  };
  const missing = Object.entries(issuer).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) {
    const error = new Error(`Faltan datos del emisor para generar un comprobante PDF completo: ${missing.join(", ")}.`);
    error.code = "arca-pdf-issuer-data-missing";
    error.status = 409;
    error.missing = missing;
    throw error;
  }
  return issuer;
}

export function inspectInvoicePdfReadiness(env = {}) {
  try {
    requiredIssuer(env);
    return { ready: true, missing: [] };
  } catch (error) {
    return { ready: false, missing: Array.isArray(error.missing) ? error.missing : [] };
  }
}

export function buildInvoicePdf({ invoice, env = {} } = {}) {
  if (!invoice || invoice.status !== "authorized") {
    const error = new Error("Sólo se puede generar el PDF de una factura autorizada.");
    error.code = "arca-pdf-invoice-not-authorized";
    error.status = 409;
    throw error;
  }
  if (invoice.verification?.matched !== true) {
    const error = new Error("La factura debe estar verificada contra ARCA antes de generar el PDF.");
    error.code = "arca-pdf-invoice-not-verified";
    error.status = 409;
    throw error;
  }

  const issuer = requiredIssuer(env);
  const auth = invoice.authorization || {};
  const sale = invoice.saleSnapshot || {};
  const receiver = invoice.receiverSnapshot || {};
  const fiscal = auth.fiscal || {};
  const issueDate = ymd(auth.authorizedAt || auth.plannedAt || sale.saleCreatedAt || invoice.createdAt);
  const qr = buildArcaQrPayload({
    issueDate,
    issuerCuit: invoice.issuerCuit || env.ARCA_ISSUER_CUIT,
    pointOfSale: auth.pointOfSale,
    voucherType: auth.voucherType,
    voucherNumber: auth.voucherNumber,
    total: fiscal.total ?? sale.total,
    receiverDocumentType: auth.receiverDocument?.documentType ?? receiver.documentType,
    receiverDocumentNumber: auth.receiverDocument?.documentNumber ?? receiver.documentNumber,
    cae: auth.cae,
  });
  const matrix = qrMatrix(qr.url);
  const pages = [];
  let stream = "";
  let y = 790;
  const pushPage = () => {
    pages.push(stream);
    stream = "";
    y = 790;
  };
  const text = (x, value, size = 9, bold = false) => {
    stream += commandText(x, y, size, value, bold);
  };
  const next = (amount = 16) => {
    y -= amount;
  };

  const voucherClass = String(auth.voucherClass || "").toUpperCase();
  stream += commandRect(35, 55, 525, 745);
  stream += commandLine(35, 690, 560, 690);
  text(50, issuer.legalName, 16, true);
  stream += commandText(275, 755, 34, voucherClass || "-", true);
  stream += commandText(390, 775, 13, `FACTURA ${voucherClass}`, true);
  stream += commandText(390, 756, 10, `PV ${String(auth.pointOfSale || "").padStart(5, "0")}  Nro ${String(auth.voucherNumber || "").padStart(8, "0")}`, true);
  stream += commandText(390, 738, 9, `Fecha: ${dmy(issueDate)}`);
  y = 720;
  text(50, `CUIT: ${invoice.issuerCuit || env.ARCA_ISSUER_CUIT}`);
  next();
  for (const line of wrap(`Domicilio fiscal: ${issuer.fiscalAddress}`, 55)) {
    text(50, line);
    next();
  }
  text(50, `Condición IVA: ${issuerVatLabel(issuer.vatCondition)}`);
  next();
  text(50, `Ingresos Brutos: ${issuer.grossIncome}`);
  next();
  text(50, `Inicio de actividades: ${issuer.activityStart}`);
  next(20);

  stream += commandLine(35, y + 5, 560, y + 5);
  next(8);
  text(50, "RECEPTOR", 10, true);
  next();
  const customerName = sale.customer?.name || (Number(receiver.vatConditionId) === 5 ? "CONSUMIDOR FINAL" : "NR");
  text(50, `Nombre / Razón social: ${customerName}`);
  next();
  text(50, `Condición IVA: ${receiverVatLabel(receiver.vatConditionId || auth.receiverVatConditionId)}`);
  next();
  const docType = auth.receiverDocument?.documentType ?? receiver.documentType;
  const docNumber = auth.receiverDocument?.documentNumber ?? receiver.documentNumber;
  text(50, `Documento: ${docType || "-"} · ${docNumber || "0"}`);
  next();
  text(50, `Venta origen: ${sale.saleCode || invoice.sourceId || "-"}`);
  next(22);

  stream += commandLine(35, y + 7, 560, y + 7);
  text(50, "Cant.", 9, true);
  stream += commandText(95, y, 9, "Descripción", true);
  stream += commandText(360, y, 9, "P. Unit.", true);
  stream += commandText(470, y, 9, "Subtotal", true);
  next(17);
  stream += commandLine(35, y + 7, 560, y + 7);

  const items = Array.isArray(sale.items) ? sale.items : [];
  for (const item of items) {
    if (y < 235) {
      stream += commandText(50, 80, 8, "Continúa en la página siguiente.");
      pushPage();
      stream += commandRect(35, 55, 525, 745);
      stream += commandText(50, 780, 11, `${issuer.legalName} · Factura ${voucherClass} ${auth.pointOfSale}-${auth.voucherNumber}`, true);
      y = 748;
      text(50, "Cant.", 9, true);
      stream += commandText(95, y, 9, "Descripción", true);
      stream += commandText(360, y, 9, "P. Unit.", true);
      stream += commandText(470, y, 9, "Subtotal", true);
      next(17);
      stream += commandLine(35, y + 7, 560, y + 7);
    }
    const descriptionLines = wrap(item.name || item.productName || "Producto", 45).slice(0, 2);
    stream += commandText(50, y, 9, String(item.qty || 0));
    stream += commandText(95, y, 9, descriptionLines[0]);
    stream += commandText(360, y, 9, `$ ${money(item.unitPrice)}`);
    stream += commandText(470, y, 9, `$ ${money(item.subtotal)}`);
    if (descriptionLines[1]) {
      next(12);
      stream += commandText(95, y, 8, descriptionLines[1]);
    }
    next(17);
  }

  if (y < 315) {
    pushPage();
    stream += commandRect(35, 55, 525, 745);
    stream += commandText(50, 780, 11, `${issuer.legalName} · Factura ${voucherClass} ${auth.pointOfSale}-${auth.voucherNumber}`, true);
    y = 735;
  }
  stream += commandLine(330, y + 8, 550, y + 8);
  next(5);
  stream += commandText(350, y, 9, "Subtotal:", true);
  stream += commandText(470, y, 9, `$ ${money(sale.subtotal ?? sale.totalBeforeDiscounts ?? sale.total)}`);
  next(16);
  if (Number(sale.discountTotal || 0) > 0) {
    stream += commandText(350, y, 9, "Descuentos:");
    stream += commandText(470, y, 9, `- $ ${money(sale.discountTotal)}`);
    next(16);
  }
  stream += commandText(350, y, 9, "Neto gravado:");
  stream += commandText(470, y, 9, `$ ${money(fiscal.net)}`);
  next(16);
  stream += commandText(350, y, 9, "IVA:");
  stream += commandText(470, y, 9, `$ ${money(fiscal.vat)}`);
  next(18);
  stream += commandText(350, y, 11, "TOTAL:", true);
  stream += commandText(470, y, 11, `$ ${money(fiscal.total ?? sale.total)}`, true);

  const qrModule = 2.05;
  const qrX = 55;
  const qrY = 65;
  stream += "0 g\n";
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (!matrix[row][col]) continue;
      const x = qrX + col * qrModule;
      const yy = qrY + (matrix.length - 1 - row) * qrModule;
      stream += `${x.toFixed(2)} ${yy.toFixed(2)} ${qrModule.toFixed(2)} ${qrModule.toFixed(2)} re f\n`;
    }
  }
  stream += commandText(205, 168, 10, "Comprobante autorizado por ARCA", true);
  stream += commandText(205, 148, 9, `CAE: ${auth.cae || "-"}`);
  stream += commandText(205, 131, 9, `Vencimiento CAE: ${dmy(auth.caeExpiration)}`);
  stream += commandText(205, 114, 8, `Verificación: ${invoice.verification?.matched === true ? "coincide con FECompConsultar" : "pendiente"}`);
  stream += commandText(205, 91, 7, "El código QR permite verificar los datos fiscales del comprobante.");
  stream += commandText(205, 74, 7, invoice.fiscalEnvironment === "production" ? "Documento fiscal electrónico" : "HOMOLOGACIÓN - SIN VALIDEZ FISCAL", true);

  pushPage();
  const output = assemblePdf(pages);
  const filename = `Factura_${voucherClass || "ARCA"}_${String(auth.pointOfSale || "").padStart(5, "0")}-${String(auth.voucherNumber || "").padStart(8, "0")}.pdf`;
  return { pdf: output, filename, qrUrl: qr.url };
}
