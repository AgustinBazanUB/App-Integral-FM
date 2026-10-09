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
  if (normalized === "responsable_inscripto") return "Responsable Inscripto";
  return String(value || "").replaceAll("_", " ");
}

function receiverVatLabel(id) {
  return ({
    1: "Responsable Inscripto",
    4: "IVA Sujeto Exento",
    5: "Consumidor Final",
    6: "Responsable Monotributo",
    7: "Sujeto No Categorizado",
    13: "Monotributista Social",
    15: "IVA No Alcanzado",
    16: "Monotributista Trabajador Independiente Promovido",
  })[Number(id)] || `Condición ${id || "-"}`;
}

function receiverDocumentLabel(type, number) {
  const docType = Number(type || 0);
  const docNumber = String(number || "").replace(/\D/g, "");
  if (docType === 80) return `CUIT · ${docNumber || "-"}`;
  if (docType === 86) return `CUIL · ${docNumber || "-"}`;
  if (docType === 96) return `DNI · ${docNumber || "-"}`;
  if (docType === 99) return "Consumidor Final";
  return `${docType || "Documento"} · ${docNumber || "-"}`;
}

function requiredIssuer(env = {}) {
  const issuer = {
    legalName: String(env.ARCA_ISSUER_LEGAL_NAME || "").trim(),
    fiscalAddress: String(env.ARCA_ISSUER_FISCAL_ADDRESS || "").trim(),
    commercialAddress: String(
      env.ARCA_ISSUER_COMMERCIAL_ADDRESS || env.ARCA_ISSUER_FISCAL_ADDRESS || "",
    ).trim(),
    grossIncome: String(env.ARCA_ISSUER_GROSS_INCOME || "").trim(),
    activityStart: String(env.ARCA_ISSUER_ACTIVITY_START || "").trim(),
    vatCondition: String(env.ARCA_ISSUER_VAT_CONDITION || "").trim(),
  };
  const missing = Object.entries(issuer)
    .filter(([key, value]) => key !== "fiscalAddress" && !value)
    .map(([key]) => key);
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
  const voucherClass = String(auth.voucherClass || "").toUpperCase();
  const voucherCode = String(auth.voucherType || "").padStart(2, "0");
  const issuerCuit = String(invoice.issuerCuit || env.ARCA_ISSUER_CUIT || "").replace(/\D/g, "");
  const displayedCuit = issuerCuit.length === 11
    ? `${issuerCuit.slice(0, 2)}-${issuerCuit.slice(2, 10)}-${issuerCuit.slice(10)}`
    : issuerCuit;
  const pages = [];
  let stream = "";
  const pushPage = () => {
    pages.push(stream);
    stream = "";
  };

  // Match the supplied paper invoice's three-part composition: boxed issuer,
  // open transaction detail, and a separate authorization/QR footer.
  stream += commandRect(30, 694, 535, 116);
  stream += commandRect(263, 740, 69, 70);
  stream += commandText(285, 770, 34, voucherClass || "-", true);
  stream += commandText(275, 750, 9, `Código ${voucherCode}`);
  stream += commandText(39, 790, 8, "Razón social:", true);
  stream += commandText(101, 790, 8, issuer.legalName);
  if (issuer.fiscalAddress) {
    stream += commandText(39, 773, 8, "Dirección fiscal:", true);
    stream += commandText(111, 773, 8, issuer.fiscalAddress);
  }
  stream += commandText(39, 755, 8, "Dirección comercial:", true);
  const addressLines = wrap(issuer.commercialAddress, 28);
  if (addressLines.length > 3) {
    const error = new Error("El domicilio comercial excede el espacio disponible en el encabezado del PDF.");
    error.code = "arca-pdf-issuer-address-too-long";
    error.status = 409;
    throw error;
  }
  addressLines.forEach((line, index) => {
    stream += commandText(index ? 39 : 130, 755 - index * 13, 8, line);
  });
  stream += commandText(39, 705, 8, "Condición de IVA:", true);
  stream += commandText(117, 705, 8, issuerVatLabel(issuer.vatCondition));
  stream += commandText(394, 790, 12, "FACTURA", true);
  stream += commandText(394, 774, 8, `PV: ${String(auth.pointOfSale || "").padStart(5, "0")} - N° ${String(auth.voucherNumber || "").padStart(8, "0")}`, true);
  stream += commandText(394, 757, 8, `Fecha Emisión: ${dmy(issueDate)}`, true);
  stream += commandText(394, 740, 8, `CUIT: ${displayedCuit}`, true);
  stream += commandText(394, 723, 8, `Ingresos Brutos: ${issuer.grossIncome}`, true);
  stream += commandText(394, 706, 8, `Inicio de Actividades: ${issuer.activityStart}`, true);

  const customerName = receiver.name || sale.customer?.name || (Number(receiver.vatConditionId) === 5 ? "A CONSUMIDOR FINAL" : "NR");
  const docType = auth.receiverDocument?.documentType ?? receiver.documentType;
  const docNumber = auth.receiverDocument?.documentNumber ?? receiver.documentNumber;
  stream += commandText(39, 673, 8, "Razón social:", true);
  stream += commandText(110, 673, 8, customerName);
  stream += commandText(39, 655, 8, "Cond. de IVA:", true);
  stream += commandText(110, 655, 8, receiverVatLabel(receiver.vatConditionId || auth.receiverVatConditionId));
  stream += commandText(39, 637, 8, "Documento:", true);
  stream += commandText(110, 637, 8, receiverDocumentLabel(docType, docNumber));
  stream += commandText(307, 673, 8, "Venta origen:", true);
  stream += commandText(374, 673, 8, sale.saleCode || invoice.sourceId || "-");
  if (sale.payment?.label || sale.payment?.method) {
    stream += commandText(307, 655, 8, "Cond. de venta:", true);
    stream += commandText(385, 655, 8, sale.payment.label || sale.payment.method);
  }
  if (sale.locationName) {
    stream += commandText(307, 637, 8, "Ubicación:", true);
    stream += commandText(361, 637, 8, sale.locationName);
  }

  stream += commandText(39, 500, 9, "Cantidad", true);
  stream += commandText(100, 500, 9, "Detalle", true);
  stream += commandText(362, 500, 9, "P. Unitario", true);
  stream += commandText(477, 500, 9, "Subtotal", true);
  stream += commandLine(35, 489, 560, 489);
  let y = 470;

  const items = Array.isArray(sale.items) ? sale.items : [];
  const fiscalProducts = Array.isArray(invoice.productFiscalSnapshot) ? invoice.productFiscalSnapshot : [];
  const vatRateByProduct = new Map(fiscalProducts.map((product) => [String(product.productId || ""), product.arcaVatRate]));
  for (const item of items) {
    const rate = vatRateByProduct.get(String(item.productId || ""));
    const rateLabel = rate == null || !Number.isFinite(Number(rate))
      ? ""
      : ` (IVA ${Number(rate).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%)`;
    const descriptionLines = wrap(`${item.name || item.productName || "Producto"}${rateLabel}`, 43);
    if (y - (descriptionLines.length - 1) * 12 < 320) {
      stream += commandText(39, 275, 8, "Continúa en la página siguiente.");
      pushPage();
      stream += commandText(39, 790, 10, `${issuer.legalName} · Factura ${voucherClass} ${auth.pointOfSale}-${auth.voucherNumber}`, true);
      stream += commandLine(35, 776, 560, 776);
      stream += commandText(39, 755, 9, "Cantidad", true);
      stream += commandText(100, 755, 9, "Detalle", true);
      stream += commandText(362, 755, 9, "P. Unitario", true);
      stream += commandText(477, 755, 9, "Subtotal", true);
      stream += commandLine(35, 744, 560, 744);
      y = 725;
    }
    stream += commandText(58, y, 9, String(item.qty || 0));
    descriptionLines.forEach((line, index) => {
      stream += commandText(100, y - index * 12, index ? 8 : 9, line);
    });
    stream += commandText(362, y, 9, `$ ${money(item.unitPrice)}`);
    stream += commandText(477, y, 9, `$ ${money(item.subtotal)}`);
    y -= 22 + (descriptionLines.length - 1) * 12;
  }

  const appliedDiscounts = Array.isArray(sale.discounts)
    ? sale.discounts.filter((discount) => Number(discount?.amountApplied || 0) > 0)
    : [];
  for (const discount of appliedDiscounts) {
    const labelLines = wrap(`Descuento: ${discount.name || "Descuento aplicado"}`, 43);
    if (y - (labelLines.length - 1) * 12 < 320) {
      pushPage();
      stream += commandText(39, 790, 10, `${issuer.legalName} · Factura ${voucherClass} ${auth.pointOfSale}-${auth.voucherNumber}`, true);
      stream += commandLine(35, 776, 560, 776);
      y = 725;
    }
    labelLines.forEach((line, index) => {
      stream += commandText(100, y - index * 12, index ? 8 : 9, line);
    });
    stream += commandText(477, y, 9, `- $ ${money(discount.amountApplied)}`);
    y -= 22 + (labelLines.length - 1) * 12;
  }

  if (y < 320) {
    pushPage();
    stream += commandText(39, 790, 10, `${issuer.legalName} · Factura ${voucherClass} ${auth.pointOfSale}-${auth.voucherNumber}`, true);
    stream += commandLine(35, 776, 560, 776);
    y = 700;
  }
  y = Math.min(y - 32, 405);
  stream += commandText(354, y, 9, "Sub-Total:", true);
  stream += commandText(477, y, 9, `$ ${money(sale.subtotal ?? sale.totalBeforeDiscounts ?? sale.total)}`);
  y -= 19;
  if (Number(sale.discountTotal || 0) > 0) {
    stream += commandText(354, y, 9, "Descuentos:");
    stream += commandText(477, y, 9, `- $ ${money(sale.discountTotal)}`);
    y -= 19;
  }
  stream += commandText(354, y, 9, "Neto gravado:");
  stream += commandText(477, y, 9, `$ ${money(fiscal.net)}`);
  y -= 19;
  stream += commandText(354, y, 9, "IVA:");
  stream += commandText(477, y, 9, `$ ${money(fiscal.vat)}`);
  y -= 25;
  stream += commandText(354, y, 11, "Total:", true);
  stream += commandText(477, y, 11, `$ ${money(fiscal.total ?? sale.total)}`, true);

  if (voucherClass === "B") {
    stream += commandText(39, 239, 8, "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)", true);
    stream += commandText(39, 223, 8, `IVA Contenido: $ ${money(fiscal.vat)}`);
    stream += commandText(39, 208, 8, `Otros Impuestos Nacionales Indirectos: $ ${money(fiscal.tributes || 0)}`);
  }

  stream += commandRect(30, 55, 535, 105);
  const qrModule = 1.15;
  const qrX = 47;
  const qrY = 73;
  stream += "0 g\n";
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (!matrix[row][col]) continue;
      const x = qrX + col * qrModule;
      const yy = qrY + (matrix.length - 1 - row) * qrModule;
      stream += `${x.toFixed(2)} ${yy.toFixed(2)} ${qrModule.toFixed(2)} ${qrModule.toFixed(2)} re f\n`;
    }
  }
  stream += commandText(133, 130, 10, `CAE N°: ${auth.cae || "-"}`, true);
  stream += commandText(133, 109, 10, `VTO. CAE: ${dmy(auth.caeExpiration)}`, true);
  stream += commandText(133, 73, 7, `Hoja: ${pages.length + 1} de ${pages.length + 1}`);
  stream += commandText(508, 73, 8, "ORIGINAL");
  if (invoice.fiscalEnvironment !== "production") {
    stream += commandText(235, 93, 8, "HOMOLOGACIÓN - SIN VALIDEZ FISCAL", true);
  }

  pushPage();
  const output = assemblePdf(pages);
  const filename = `Factura_${voucherClass || "ARCA"}_${String(auth.pointOfSale || "").padStart(5, "0")}-${String(auth.voucherNumber || "").padStart(8, "0")}.pdf`;
  return { pdf: output, filename, qrUrl: qr.url };
}
