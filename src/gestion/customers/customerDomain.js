const digitsOnly = (value) => String(value || "").replace(/\D/g, "");

export function normalizeCustomerPhone(value) {
  let digits = digitsOnly(value);
  if (!digits) return "";

  if (digits.startsWith("0054")) digits = digits.slice(4);
  else if (digits.startsWith("54") && digits.length > 10) digits = digits.slice(2);

  // Formato internacional argentino móvil: +54 9 <código de área> <número>.
  if (digits.startsWith("9") && digits.length === 11) digits = digits.slice(1);

  // Prefijo troncal nacional: 0<código de área>.
  if (digits.startsWith("0") && digits.length > 10) digits = digits.slice(1);

  // Compatibilidad con el antiguo prefijo móvil "15". Se elimina solamente
  // cuando el resultado conserva los 10 dígitos nacionales esperados.
  if (digits.length === 12) {
    const positions = [2, 3, 4];
    const mobilePrefixIndex = positions.find((index) => digits.slice(index, index + 2) === "15");
    if (mobilePrefixIndex != null) {
      digits = `${digits.slice(0, mobilePrefixIndex)}${digits.slice(mobilePrefixIndex + 2)}`;
    }
  }

  return digits;
}

export function isValidCustomerPhone(value) {
  const normalized = normalizeCustomerPhone(value);
  // Clientes argentinos continúan normalizándose a su número nacional. Para
  // importaciones explícitamente internacionales se admite el máximo E.164 (15 dígitos).
  return normalized.length >= 8 && normalized.length <= 15;
}

export function formatPhoneForDisplay(value) {
  const normalized = normalizeCustomerPhone(value);
  if (!normalized) return "";
  if (normalized.length === 10 && normalized.startsWith("11")) {
    return `11-${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, -4)}-${normalized.slice(-4)}`;
}

/**
 * Contrato Web App → extensión para WhatsApp.
 * La UI puede recibir formatos argentinos amigables (+54 9, 0/15 legado o 11XXXXXXXX),
 * pero la integración sólo entrega un móvil argentino inequívoco: 549 + 10 dígitos nacionales.
 * No se adivina otro país silenciosamente.
 */
export function canonicalWhatsAppPhone(value, { country = "AR" } = {}) {
  if (country !== "AR") return "";
  const national = normalizeCustomerPhone(value);
  if (!/^\d{10}$/.test(national)) return "";
  return `549${national}`;
}

export function phoneToWhatsAppInternational(value) {
  return canonicalWhatsAppPhone(value);
}

export function customerWhatsAppUrl(value) {
  const international = phoneToWhatsAppInternational(value);
  return international ? `https://wa.me/${international}` : "";
}

export function cleanCustomerName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name || "";
}

export function cleanZoneName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name || "";
}

export function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-AR");
}

export async function customerDocumentId(phoneNormalized) {
  const normalized = normalizeCustomerPhone(phoneNormalized);
  if (!isValidCustomerPhone(normalized)) throw new Error("Ingresá un teléfono válido.");
  if (!globalThis.crypto?.subtle) {
    throw new Error("Este navegador no permite identificar clientes de forma segura.");
  }
  const bytes = new TextEncoder().encode(`flor-mia:customer:${normalized}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `customer_${hex.slice(0, 40)}`;
}

export function customerDisplayName(customer = {}) {
  return cleanCustomerName(customer.name) || customer.phone || customer.phoneNormalized || "Cliente";
}

export function customerZoneLabel(customer = {}) {
  return cleanZoneName(customer.zoneName || customer.customZone || customer.zone);
}

export function buildCustomerDraft({ phone, name = "", zoneId = "", zoneName = "", customZone = "" } = {}) {
  const phoneNormalized = normalizeCustomerPhone(phone);
  if (!isValidCustomerPhone(phoneNormalized)) throw new Error("Ingresá un teléfono válido.");
  const cleanCustomZone = cleanZoneName(customZone);
  const cleanConfiguredZone = cleanZoneName(zoneName);
  const resolvedZoneName = cleanCustomZone || cleanConfiguredZone;
  if (!resolvedZoneName) throw new Error("Elegí una zona o ingresá una nueva zona.");
  return {
    phone: String(phone || "").trim(),
    phoneNormalized,
    name: cleanCustomerName(name),
    zoneId: cleanCustomZone ? "" : String(zoneId || "").trim(),
    zoneName: resolvedZoneName,
    customZone: cleanCustomZone,
  };
}

export function matchesCustomerSearch(customer, search) {
  const term = normalizedSearchText(search);
  if (!term) return true;
  const phoneTerm = normalizeCustomerPhone(search);
  if (phoneTerm && String(customer.phoneNormalized || "").includes(phoneTerm)) return true;
  return [customer.name, customer.zoneName, customer.customZone, customer.phone]
    .some((value) => normalizedSearchText(value).includes(term));
}
