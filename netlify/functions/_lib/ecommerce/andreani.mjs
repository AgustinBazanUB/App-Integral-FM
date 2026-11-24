import { addressKey, argentinePostalCode, provinceKey } from "../../../../src/shared/ecommerceDelivery.mjs";
import { commerceError } from "./commerceDomain.mjs";

function andreaniOrigin(env) {
  const live = env.ANDREANI_ENVIRONMENT === "production"
    && env.FIREBASE_PROJECT_ID === "app-integral-fm"
    && env.CONTEXT === "production";
  return live ? "https://apis.andreani.com" : "https://apisqa.andreani.com";
}

export async function postalCodeForLocality(address, { env = process.env, fetchImpl = fetch } = {}) {
  const url = new URL("/v1/localidades", andreaniOrigin(env));
  url.searchParams.set("localidad", address.city);
  const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw commerceError("ecommerce-postal-lookup-failed", "No pudimos consultar el código postal. Reintentá.", 503);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw commerceError("ecommerce-postal-lookup-failed", "No pudimos consultar el código postal. Reintentá.", 503);
  const matching = rows.filter((row) =>
    provinceKey(row.provincia) === provinceKey(address.province)
    && addressKey(row.localidad) === addressKey(address.city)
    && (!row.partido || !address.municipality || addressKey(row.partido) === addressKey(address.municipality)));
  const codes = new Set(matching.flatMap((row) => row.codigosPostales || []).map(argentinePostalCode).filter(Boolean));
  return codes.size === 1 ? [...codes][0] : "";
}

export function andreaniPackage(cart, settings) {
  let grams = 0;
  let volume = 0;
  let declaredValue = 0;
  for (const item of cart) {
    const parcel = settings[item.productId]?.parcel;
    if (!Number.isSafeInteger(parcel?.grams) || parcel.grams <= 0
      || !Number.isSafeInteger(parcel?.volumeCm3) || parcel.volumeCm3 <= 0) {
      throw commerceError("ecommerce-andreani-package-needed", "Hay productos del carrito sin medidas de envío. Consultanos o elegí retiro.", 409);
    }
    grams += parcel.grams * item.quantity;
    volume += parcel.volumeCm3 * item.quantity;
    declaredValue += item.subtotal / (1 + item.arcaVatRate / 100);
  }
  return { kilos: grams / 1000, volume, declaredValue: declaredValue.toFixed(2) };
}

export async function quoteAndreani(postalCode, parcel, { env = process.env, fetchImpl = fetch } = {}) {
  const { ANDREANI_USER, ANDREANI_PASSWORD, ANDREANI_CUSTOMER, ANDREANI_CONTRACT, ANDREANI_ORIGIN_BRANCH } = env;
  if (![ANDREANI_USER, ANDREANI_PASSWORD, ANDREANI_CUSTOMER, ANDREANI_CONTRACT].every((value) => String(value || "").trim())) {
    throw commerceError("ecommerce-andreani-not-configured", "La cotización de Andreani todavía no está disponible. Consultanos o elegí retiro.", 503);
  }
  const origin = andreaniOrigin(env);
  const unavailable = () => commerceError("ecommerce-andreani-unavailable", "Andreani no pudo cotizar esta dirección. Reintentá o elegí retiro.", 503);
  try {
    const login = await fetchImpl(new URL("/login", origin), {
      headers: { Authorization: "Basic " + Buffer.from(ANDREANI_USER + ":" + ANDREANI_PASSWORD).toString("base64") },
      redirect: "error",
      signal: AbortSignal.timeout(6500),
    });
    if (!login.ok) throw unavailable();
    const credentials = await login.json().catch(() => ({}));
    const token = login.headers.get("x-authorization-token") || credentials?.token;
    if (typeof token !== "string" || !token) throw unavailable();
    const url = new URL("/v1/tarifas", origin);
    url.search = new URLSearchParams({
      cpDestino: postalCode,
      contrato: ANDREANI_CONTRACT,
      cliente: ANDREANI_CUSTOMER,
      "bultos[0][kilos]": String(parcel.kilos),
      "bultos[0][volumen]": String(parcel.volume),
      "bultos[0][valorDeclarado]": parcel.declaredValue,
      ...(ANDREANI_ORIGIN_BRANCH ? { sucursalOrigen: ANDREANI_ORIGIN_BRANCH } : {}),
    });
    const response = await fetchImpl(url, {
      headers: { "x-authorization-token": token, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) throw unavailable();
    const quote = await response.json();
    const total = quote?.tarifaConIva?.total;
    if (!["string", "number"].includes(typeof total) || !/^\d+(\.\d+)?$/.test(String(total))) throw unavailable();
    const amount = Math.round(Number(total));
    if (!Number.isSafeInteger(amount) || amount < 0) throw unavailable();
    return amount;
  } catch {
    throw unavailable();
  }
}
