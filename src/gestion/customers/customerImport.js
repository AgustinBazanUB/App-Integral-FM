import {
  cleanCustomerName,
  cleanZoneName,
  isValidCustomerPhone,
  normalizeCustomerPhone,
  normalizedSearchText,
} from "./customerDomain.js";

export const FLORMIA_CONTACT_IMPORT_HEADERS = ["Telefono", "Nombre y Apellido", "Zona"];

function cleanCell(value) {
  return String(value ?? "").trim();
}

function headerKey(value) {
  return cleanCell(value).replace(/^\uFEFF/, "");
}

function sameHeader(row = []) {
  return FLORMIA_CONTACT_IMPORT_HEADERS.every((expected, index) => headerKey(row[index]) === expected)
    && row.slice(FLORMIA_CONTACT_IMPORT_HEADERS.length).every((value) => !cleanCell(value));
}

function configuredZone(zoneName, zones = []) {
  const wanted = normalizedSearchText(zoneName);
  return zones.find((zone) => zone?.id && normalizedSearchText(zone.name) === wanted) || null;
}

function mergeZone(existing, incoming) {
  const values = [];
  for (const value of `${existing || ""} | ${incoming || ""}`.split("|")) {
    const clean = cleanZoneName(value);
    if (clean && !values.some((item) => normalizedSearchText(item) === normalizedSearchText(clean))) values.push(clean);
  }
  return values.join(" | ");
}

export function parseFlorMiaContactImport(rows, zones = []) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("El Excel está vacío.");
  }
  if (!sameHeader(rows[0])) {
    throw new Error("El Excel debe tener exactamente las columnas: Telefono, Nombre y Apellido, Zona.");
  }

  const byPhone = new Map();
  const invalidRows = [];
  let duplicates = 0;
  let withoutName = 0;
  const dataRows = rows.slice(1).filter((row) => Array.isArray(row) && row.some((value) => cleanCell(value)));

  dataRows.forEach((row, index) => {
    const sourceRow = index + 2;
    const phone = cleanCell(row[0]);
    const name = cleanCustomerName(row[1]);
    const zone = cleanZoneName(row[2]);
    const phoneNormalized = normalizeCustomerPhone(phone);
    const errors = [];
    if (!phone || !isValidCustomerPhone(phoneNormalized)) errors.push("Teléfono inválido");
    if (!zone) errors.push("Zona vacía");
    if (errors.length) {
      invalidRows.push({ row: sourceRow, phone, name, zone, errors });
      return;
    }

    const existing = byPhone.get(phoneNormalized);
    if (existing) {
      duplicates += 1;
      existing.zone = mergeZone(existing.zone, zone);
      if (!existing.name && name) existing.name = name;
      existing.sourceRows.push(sourceRow);
      const zoneMatch = configuredZone(existing.zone, zones);
      existing.zoneId = zoneMatch?.id || "";
      existing.zoneName = zoneMatch?.name || existing.zone;
      existing.customZone = zoneMatch ? "" : existing.zone;
      return;
    }

    if (!name) withoutName += 1;
    const zoneMatch = configuredZone(zone, zones);
    byPhone.set(phoneNormalized, {
      phone,
      phoneNormalized,
      name,
      zone,
      zoneId: zoneMatch?.id || "",
      zoneName: zoneMatch?.name || zone,
      customZone: zoneMatch ? "" : zone,
      sourceRows: [sourceRow],
      existingCustomer: null,
    });
  });

  const validRows = [...byPhone.values()];
  return {
    headers: [...FLORMIA_CONTACT_IMPORT_HEADERS],
    rows: validRows,
    invalidRows,
    summary: {
      total: dataRows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      duplicates,
      withoutName,
      existing: 0,
      readyToImport: validRows.length,
    },
  };
}

export async function markExistingImportedCustomers(parsed, findCustomerByPhone, concurrency = 8) {
  const rows = parsed.rows.map((row) => ({ ...row }));
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      const row = rows[index];
      row.existingCustomer = await findCustomerByPhone(row.phone);
    }
  }
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, rows.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const existing = rows.filter((row) => row.existingCustomer).length;
  return {
    ...parsed,
    rows,
    summary: {
      ...parsed.summary,
      existing,
      readyToImport: rows.length - existing,
    },
  };
}
