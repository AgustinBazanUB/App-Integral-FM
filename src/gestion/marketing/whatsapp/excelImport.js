
import { recipientFromExcel } from "./campaignDomain.js";

const normalizeHeader = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase("es-AR")
  .replace(/[^a-z0-9]+/g, " ");

const headerAliases = {
  phone: ["telefono", "teléfono", "tel", "celular", "movil", "móvil", "whatsapp", "phone"],
  name: ["nombre", "nombre y apellido", "cliente", "name"],
  zone: ["zona", "localidad", "barrio", "zone"],
  category: ["categoria", "categoría", "segmento", "tipo cliente", "category", "segment"],
  notes: ["observaciones", "observacion", "observación", "notas", "notes"],
};

export function detectExcelMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const result = { phone: "", name: "", zone: "", category: "", notes: "" };
  for (const [field, aliases] of Object.entries(headerAliases)) {
    const aliasSet = new Set(aliases.map(normalizeHeader));
    const index = normalized.findIndex((header) => aliasSet.has(header));
    if (index >= 0) result[field] = String(headers[index]);
  }
  return result;
}

export async function readCampaignExcel(file) {
  if (!file) throw new Error("Seleccioná un archivo .xlsx.");
  if (!String(file.name || "").toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("El importador admite archivos .xlsx. El formato .xls binario no está habilitado.");
  }
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  if (!rows?.length) throw new Error("El archivo está vacío.");
  const headers = rows[0].map((value, index) => String(value || `Columna ${index + 1}`).trim());
  return {
    fileName: file.name,
    headers,
    rows: rows.slice(1).filter((row) => row.some((value) => value != null && String(value).trim() !== "")),
    mapping: detectExcelMapping(headers),
  };
}

export function mapExcelRows(sheet, mapping) {
  if (!sheet?.headers?.length) return [];
  if (!mapping?.phone) throw new Error("Indicá qué columna contiene el teléfono.");
  const headerIndex = new Map(sheet.headers.map((header, index) => [header, index]));
  const value = (row, field) => {
    const header = mapping[field];
    return header && headerIndex.has(header) ? row[headerIndex.get(header)] : "";
  };
  return sheet.rows.map((row) => recipientFromExcel({
    phone: value(row, "phone"),
    name: value(row, "name"),
    zone: value(row, "zone"),
    category: value(row, "category"),
    notes: value(row, "notes"),
  }));
}
