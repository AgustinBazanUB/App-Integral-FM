import { addressKey, argentinePostalCode, DELIVERY_ZONES, provinceKey } from "../../../../src/shared/ecommerceDelivery.mjs";
import { commerceError } from "./commerceDomain.mjs";

// The metropolitan area is independent of the shop's delivery coverage.
// https://www.argentina.gob.ar/dami/centro/amba
const metropolitanMunicipalities = new Set([
  "Almirante Brown", "Avellaneda", "Berazategui", "Berisso", "Brandsen",
  "Campana", "Cañuelas", "Ensenada", "Escobar", "Esteban Echeverría",
  "Exaltación de la Cruz", "Ezeiza", "Florencio Varela", "General Las Heras",
  "General Rodríguez", "General San Martín", "Hurlingham", "Ituzaingó",
  "José C. Paz", "La Matanza", "La Plata", "Lanús", "Lomas de Zamora",
  "Luján", "Malvinas Argentinas", "Marcos Paz", "Merlo", "Moreno", "Morón",
  "Pilar", "Presidente Perón", "Quilmes", "San Fernando", "San Isidro",
  "San Miguel", "San Vicente", "Tigre", "Tres de Febrero", "Vicente López", "Zárate",
  "San Martín",
].map(addressKey));

const VAT_RATES = new Set([0, 10.5, 21, 27]);
const badRate = (message) => commerceError("ecommerce-management-blocked", message, 400);

export function normalizeDeliveryConfig(raw = {}) {
  if (raw.rates != null && !Array.isArray(raw.rates)) throw badRate("Configurá tarifas de envío válidas.");
  const rates = (raw.rates || []).map((rate) => {
    const zone = rate.zone || "";
    if (zone && !Object.hasOwn(DELIVERY_ZONES, zone)) throw badRate("Elegí una zona de envío válida.");
    const province = zone ? (zone === "caba" ? "CABA" : "Buenos Aires") : String(rate.province || "").trim().slice(0, 100);
    const name = zone ? DELIVERY_ZONES[zone] : String(rate.name || province).trim().slice(0, 100);
    const id = String(rate.id || "").trim();
    const postalCodes = [...new Set((Array.isArray(rate.postalCodes) ? rate.postalCodes : [])
      .map((code) => String(code).trim().toUpperCase()).filter(Boolean))];
    const areas = [...new Set((Array.isArray(rate.areas) ? rate.areas : [])
      .map((area) => String(area).trim().slice(0, 100)).filter(Boolean))];
    if (!/^[A-Za-z0-9_-]{1,150}$/.test(id) || !province || !name
      || !Number.isSafeInteger(rate.amount) || rate.amount < 0 || postalCodes.length > 200 || areas.length > 100) {
      throw badRate("Cada tarifa necesita zona e importe entero en ARS.");
    }
    if (zone !== "caba" && !postalCodes.length && !(zone && areas.length)) {
      throw badRate("Completá al menos una localidad, partido o código postal para cada cordón.");
    }
    if (postalCodes.some((code) => !argentinePostalCode(code))) throw badRate("Revisá los códigos postales de la tarifa.");
    if (rate.amount > 0 && !VAT_RATES.has(rate.arcaVatRate)) throw badRate("Configurá el IVA de cada tarifa con importe.");
    return {
      id, name, province, postalCodes, amount: rate.amount, arcaVatRate: rate.arcaVatRate ?? null,
      active: rate.active !== false,
      ...(zone ? { zone, areas } : {}),
    };
  });
  const andreaniEnabled = raw.andreani?.enabled === true;
  if (andreaniEnabled && !VAT_RATES.has(raw.andreani.arcaVatRate)) {
    throw badRate("Configurá el IVA del envío por Andreani.");
  }
  const zones = rates.filter((rate) => rate.active && rate.zone).map((rate) => rate.zone);
  if (rates.length > 30 || new Set(rates.map((rate) => rate.id)).size !== rates.length || new Set(zones).size !== zones.length
    || (raw.enabled && !rates.some((rate) => rate.active) && !andreaniEnabled)) {
    throw badRate("Configurá tarifas distintas antes de habilitar envíos.");
  }
  return {
    enabled: raw.enabled === true,
    rates,
    ...(andreaniEnabled ? { andreani: { enabled: true, arcaVatRate: raw.andreani.arcaVatRate } } : {}),
  };
}

export function isAmbaAddress(address) {
  const province = provinceKey(address.province);
  return province === "caba"
    || (province === "buenos aires" && metropolitanMunicipalities.has(addressKey(address.municipality).replace(/^gral /, "general ")));
}

function matchScore(rate, address) {
  if (rate.active === false || provinceKey(rate.province) !== provinceKey(address.province)) return 0;
  if (rate.zone === "caba") return provinceKey(address.province) === "caba" ? 5 : 0;
  const postal = argentinePostalCode(address.postalCode);
  if (postal && (rate.postalCodes || []).some((code) => argentinePostalCode(code) === postal)) return rate.zone ? 4 : 1;
  const areas = (rate.areas || []).map(addressKey);
  if (rate.zone && areas.includes(addressKey(address.city))) return 3;
  return rate.zone && areas.includes(addressKey(address.municipality)) ? 2 : 0;
}

export function localDeliveryRate(delivery, address) {
  const insideAmba = isAmbaAddress(address);
  if (!insideAmba) return null;
  const entries = (delivery.rates || []).map((rate) => ({ rate, score: matchScore(rate, address) }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score);
  if (entries.length > 1 && entries[0].score === entries[1].score) {
    throw commerceError("ecommerce-delivery-zone-ambiguous", "Hay más de una tarifa para esta dirección. Consultanos o elegí retiro.", 409);
  }
  return entries[0]?.rate || null;
}
