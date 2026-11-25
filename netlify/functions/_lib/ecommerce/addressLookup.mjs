import { addressKey, argentinePostalCode, parseAddressSearch, provinceKey } from "../../../../src/shared/ecommerceDelivery.mjs";
import { postalCodeForLocality } from "./andreani.mjs";
import { commerceError } from "./commerceDomain.mjs";

const CABA = "Ciudad Autónoma de Buenos Aires";
const USIG = "https://servicios.usig.buenosaires.gob.ar/normalizar/";
const CABA_POSTAL = "https://ws.usig.buenosaires.gob.ar/datos_utiles";
const GEOREF = "https://apis.datos.gob.ar/georef/api/v2.0/direcciones";

async function providerJson(endpoint, params, fetchImpl) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params);
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Servicio de direcciones no disponible.");
  return response.json();
}

function candidate({ street, number, city, municipality, province, lat, lng, provider }, search) {
  if (number == null || String(number) !== search.number || !street || !city || !province) return null;
  if (lat == null || lng == null || lat === "" || lng === ""
    || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  if (search.province && provinceKey(province) !== provinceKey(search.province)) return null;
  if (search.city) {
    const hint = addressKey(search.city);
    const keys = [addressKey(city), addressKey(municipality), provinceKey(province)];
    if (!keys.some((key) => key === hint || key.startsWith(hint + " "))) return null;
  }
  return { street, number: String(number), city, municipality: municipality || "", province, lat: Number(lat), lng: Number(lng), provider };
}

async function searchUsig(query, search, fetchImpl) {
  const results = await providerJson(USIG, { direccion: query, geocodificar: "TRUE", maxOptions: "21" }, fetchImpl);
  if (!Array.isArray(results?.direccionesNormalizadas)) return [];
  return results.direccionesNormalizadas.filter((row) => row.tipo === "calle_altura").map((row) => {
    const capital = row.cod_partido === "caba";
    return candidate({
      street: row.nombre_calle,
      number: row.altura,
      city: capital ? CABA : row.nombre_localidad || row.nombre_partido,
      municipality: capital ? "" : row.nombre_partido,
      province: capital ? "CABA" : "Buenos Aires",
      lat: row.coordenadas?.y,
      lng: row.coordenadas?.x,
      provider: "usig",
    }, search);
  }).filter(Boolean);
}

async function searchGeoref(search, fetchImpl) {
  const results = await providerJson(GEOREF, {
    direccion: search.line, max: "20",
    ...(search.city ? { localidad_censal: search.city } : {}),
    ...(search.province ? { provincia: search.province } : {}),
  }, fetchImpl);
  return (results?.direcciones || []).map((row) => {
    const capital = row.provincia?.id === "02";
    return candidate({
      street: row.calle?.nombre,
      number: row.altura?.valor,
      city: capital ? CABA : row.localidad?.nombre || row.localidad_censal?.nombre,
      municipality: capital ? "" : row.departamento?.nombre,
      province: capital ? "CABA" : row.provincia?.nombre,
      lat: row.ubicacion?.lat,
      lng: row.ubicacion?.lon,
      provider: "georef",
    }, search);
  }).filter(Boolean);
}

function regionPriority(province) {
  const key = provinceKey(province);
  if (key === "caba") return 0;
  return key === "buenos aires" ? 1 : 2;
}

function distanceFromCapital({ lat, lng }) {
  return Math.hypot(lat + 34.6037, (lng + 58.3816) * 0.82);
}

export async function lookupAddresses(query, { fetchImpl = fetch } = {}) {
  const search = parseAddressSearch(query);
  if (!search) throw commerceError("ecommerce-address-query-invalid", "Ingresá calle y altura.", 400);
  const region = provinceKey(search.province);
  const providers = [searchGeoref(search, fetchImpl)];
  if (!region || region === "caba" || region === "buenos aires") providers.unshift(searchUsig(query, search, fetchImpl));
  const results = await Promise.allSettled(providers);
  if (results.every((result) => result.status === "rejected")) {
    throw commerceError("ecommerce-address-lookup-failed", "No pudimos buscar direcciones. Reintentá.", 503);
  }
  const matches = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const exactStreet = addressKey(search.street).replace(/^calle /, "");
  const seen = new Set();
  const ranked = matches.filter((address) => {
    const key = [address.street, address.number, address.city, address.municipality, address.province].map(addressKey).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) =>
    regionPriority(a.province) - regionPriority(b.province)
    || Number(addressKey(b.street) === exactStreet) - Number(addressKey(a.street) === exactStreet)
    || distanceFromCapital(a) - distanceFromCapital(b));
  // A common street name in AMBA shouldn't push every other province off the list.
  const metropolitan = ranked.filter((address) => regionPriority(address.province) < 2);
  const other = ranked.filter((address) => regionPriority(address.province) === 2);
  return [...metropolitan.slice(0, other.length ? 8 : 12), ...other].slice(0, 12);
}

export async function confirmAddress(candidate, { env = process.env, fetchImpl = fetch } = {}) {
  const { street, number, city, municipality, province, provider } = candidate;
  let postalCode = "";
  let neighborhood = "";
  try {
    if (provinceKey(province) === "caba") {
      const data = await providerJson(CABA_POSTAL, { calle: street, altura: number }, fetchImpl);
      postalCode = argentinePostalCode(data.codigo_postal || data.codigo_postal_argentino);
      neighborhood = data.barrio || "";
    } else {
      postalCode = await postalCodeForLocality(candidate, { env, fetchImpl });
    }
  } catch {
    throw commerceError("ecommerce-postal-lookup-failed", "No pudimos consultar el código postal. Reintentá.", 503);
  }
  if (!postalCode) {
    throw commerceError("ecommerce-postal-unconfirmed", "No pudimos confirmar el código postal para esa dirección. Probá buscar con otra localidad o elegí retiro.", 409);
  }
  return { street, number, city, municipality, province, postalCode, neighborhood, provider };
}
