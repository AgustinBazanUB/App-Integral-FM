import {
  cleanCustomerName,
  customerEnrichment,
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

function importColumns(row = []) {
  const headers = row.map(value => normalizedSearchText(headerKey(value)));
  const expected = FLORMIA_CONTACT_IMPORT_HEADERS.map(normalizedSearchText);
  if (!headers.includes(expected[0]) || new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length || headers.some(value => value && !expected.includes(value))) throw new Error("El Excel necesita Telefono; Nombre y Apellido y Zona son columnas opcionales.");
  return expected.map(header => headers.indexOf(header));
}

function configuredZone(zoneName, zones = []) {
  const wanted = normalizedSearchText(zoneName);
  return zones.find((zone) => zone?.id && normalizedSearchText(zone.name) === wanted) || null;
}

export function parseFlorMiaContactImport(rows, zones = []) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("El Excel está vacío.");
  }
  const columns = importColumns(rows[0]);

  const byPhone = new Map();
  const invalidRows = [];
  let duplicates = 0;

  const dataRows = rows.slice(1).map((row, index) => ({ row, sourceRow: index + 2 })).filter(({ row }) => Array.isArray(row) && row.some((value) => cleanCell(value)));

  dataRows.forEach(({ row, sourceRow }) => {
    const phone = cleanCell(row[columns[0]]);
    const name = cleanCustomerName(row[columns[1]]);
    const zone = cleanZoneName(row[columns[2]]);
    const phoneNormalized = normalizeCustomerPhone(phone);
    const errors = [];
    if (!phone || !isValidCustomerPhone(phoneNormalized)) errors.push("Teléfono inválido");

    if (errors.length) {
      invalidRows.push({ row: sourceRow, phone, name, zone, errors });
      return;
    }

    const existing = byPhone.get(phoneNormalized);
    if (existing) {
      duplicates += 1;
      const zoneMatchIncoming = configuredZone(zone, zones);
      const { patch, conflicts } = customerEnrichment(existing, { name, zoneName: zoneMatchIncoming?.name || zone, zoneId: zoneMatchIncoming?.id || "", customZone: zoneMatchIncoming ? "" : zone });
      Object.assign(existing, patch);
      existing.zone = existing.zoneName || existing.customZone || existing.zone;
      existing.importConflicts.push(...conflicts.map(conflict => ({ ...conflict, row: sourceRow })));

      existing.sourceRows.push(sourceRow);
      const zoneMatch = configuredZone(existing.zone, zones);
      existing.zoneId = zoneMatch?.id || "";
      existing.zoneName = zoneMatch?.name || existing.zone;
      existing.customZone = zoneMatch ? "" : existing.zone;
      return;
    }

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
      importConflicts: [],
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
      withoutName: validRows.filter(row => !row.name).length,
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
      row.enrichment = customerEnrichment(row.existingCustomer || {}, row);
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
      readyToImport: rows.filter(row => !row.existingCustomer || Object.keys(row.enrichment.patch).length).length,
      conflicts: rows.reduce((count, row) => count + (row.importConflicts?.length || 0) + row.enrichment.conflicts.length, 0),
    },
  };
}
