import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DELIVERY_ZONES, provinceKey } from "../../../../src/shared/ecommerceDelivery.mjs";
import { andreaniPackage, quoteAndreani } from "./andreani.mjs";
import { confirmAddress } from "./addressLookup.mjs";
import { commerceError } from "./commerceDomain.mjs";
import { isAmbaAddress, localDeliveryRate } from "./deliveryRates.mjs";

export function deliveryAddressEnabled(env = process.env) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(env.ECOMMERCE_DELIVERY_TOKEN_KEY || "");
}

function signature(payload, env) {
  if (!deliveryAddressEnabled(env)) {
    throw commerceError("ecommerce-delivery-lookup-unconfigured", "La consulta de envíos todavía no está habilitada.", 503);
  }
  return createHmac("sha256", env.ECOMMERCE_DELIVERY_TOKEN_KEY).update(payload).digest();
}

function encodeToken(kind, data, expiry, env) {
  const payload = Buffer.from(JSON.stringify({ kind, ...data, expiresAt: expiry })).toString("base64url");
  return payload + "." + signature(payload, env).toString("base64url");
}

function decodeToken(token, kind, env) {
  const invalid = () => commerceError("ecommerce-delivery-token-invalid", "Volvé a seleccionar la dirección para confirmar el envío.", 409);
  if (typeof token !== "string" || !/^[\w-]{1,6500}\.[\w-]{43}$/.test(token)) throw invalid();
  const [payload, mac] = token.split(".");
  const expected = signature(payload, env);
  const seen = Buffer.from(mac, "base64url");
  if (seen.length !== expected.length || !timingSafeEqual(seen, expected)) throw invalid();
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decoded.kind === kind && Number.isSafeInteger(decoded.expiresAt)) return decoded;
  } catch {}
  throw invalid();
}

export function publicAddressOption(address, { env = process.env, now = new Date() } = {}) {
  return {
    label: address.street + " " + address.number,
    area: [...new Set([address.city, address.municipality, address.province].filter(Boolean))].join(", "),
    selectionToken: encodeToken("address", { address }, now.getTime() + 30 * 60000, env),
  };
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  }
  return value;
}

function quoteContext({ delivery, items, settings, promotions, carrier, env }) {
  const cart = [...items].sort((a, b) => a.productId.localeCompare(b.productId)).map((item) => [
    item.productId, item.quantity, item.unitPrice, item.arcaVatRate,
    promotions[item.productId]?.active === true && promotions[item.productId]?.freeShippingAmba === true,
    carrier === "andreani" ? settings[item.productId]?.parcel || null : null,
  ]);
  const contract = carrier === "andreani"
    ? [env.ANDREANI_CONTRACT, env.ANDREANI_CUSTOMER, env.ANDREANI_ORIGIN_BRANCH, env.ANDREANI_ENVIRONMENT]
    : null;
  return createHash("sha256").update(JSON.stringify(ordered({ delivery, cart, contract }))).digest("hex");
}

export async function calculateDeliveryRate({
  delivery, address, items, settings = {}, promotions = {}, env = process.env, quoteCarrier = quoteAndreani,
}) {
  if (delivery?.enabled !== true) throw commerceError("ecommerce-delivery-not-configured", "El envío todavía no está habilitado.", 409);
  const rate = localDeliveryRate(delivery, address);
  if (rate) {
    const amount = rate.amount;
    if (!Number.isSafeInteger(amount) || amount < 0) throw commerceError("ecommerce-delivery-coverage", "No hay una tarifa habilitada para esa dirección.", 409);
    const promotion = items.map((item) => promotions[item.productId])
      .find((entry) => entry?.active === true && entry.freeShippingAmba === true);
    const free = Boolean(promotion);
    return {
      carrier: "local", rateId: rate.id, name: DELIVERY_ZONES[rate.zone] || rate.name,
      amount: free ? 0 : amount, arcaVatRate: free ? null : rate.arcaVatRate ?? null,
      promotion: promotion?.name || null,
    };
  }
  if (isAmbaAddress(address)) {
    throw commerceError("ecommerce-delivery-amba-unpriced", "Todavía no hay tarifa para esta zona del AMBA. Consultanos o elegí retiro.", 409);
  }
  if (delivery.andreani?.enabled !== true) {
    throw commerceError("ecommerce-andreani-not-configured", "Todavía no hay cotización de Andreani para fuera del AMBA. Consultanos o elegí retiro.", 409);
  }
  const amount = await quoteCarrier(address.postalCode, andreaniPackage(items, settings), { env });
  return {
    carrier: "andreani", rateId: "andreani", name: "Andreani · Fuera del AMBA",
    amount, arcaVatRate: delivery.andreani.arcaVatRate, promotion: null,
  };
}

export async function confirmSelectedAddress(selectionToken, {
  env = process.env, now = new Date(), confirm = confirmAddress,
} = {}) {
  const selection = decodeToken(selectionToken, "address", env);
  if (selection.expiresAt <= now.getTime()) {
    throw commerceError("ecommerce-delivery-selection-expired", "Volvé a buscar la dirección para confirmarla.", 409);
  }
  return confirm(selection.address, { env });
}

export async function quoteSelectedDelivery({
  selectionToken, delivery, items, settings = {}, promotions = {}, env = process.env, now = new Date(),
  confirm = confirmAddress, quoteCarrier = quoteAndreani,
}) {
  const address = await confirmSelectedAddress(selectionToken, { env, now, confirm });
  let rate;
  try {
    rate = await calculateDeliveryRate({ delivery, address, items, settings, promotions, env, quoteCarrier });
    if (rate.amount > 0 && ![0, 10.5, 21, 27].includes(rate.arcaVatRate)) {
      throw commerceError("ecommerce-shipping-vat-required", "Falta configurar el IVA de la tarifa de envío.", 409);
    }
  } catch (error) {
    if (!error?.code?.startsWith("ecommerce-")) throw error;
    return { address, quote: null, status: { code: error.code, message: error.message } };
  }
  const expiresAt = now.getTime() + 10 * 60000;
  const context = quoteContext({ delivery, items, settings, promotions, carrier: rate.carrier, env });
  const quoteToken = encodeToken("quote", { address, rate, context }, expiresAt, env);
  return { address, quote: { ...rate, expiresAt, quoteToken }, status: null };
}

export function readDeliveryQuote(token, env = process.env) {
  return decodeToken(token, "quote", env);
}

export function assertCurrentDeliveryQuote(quote, {
  delivery, items, settings = {}, promotions = {}, env = process.env, now = new Date(),
}) {
  const context = quoteContext({ delivery, items, settings, promotions, carrier: quote.rate.carrier, env });
  if (quote.expiresAt <= now.getTime() || context !== quote.context) {
    throw commerceError("ecommerce-delivery-quote-stale", "La cotización cambió o venció. Revisá el envío antes de pagar.", 409);
  }
}

export function quotedShipping(quote, deliveryDetails, notes) {
  const { address, rate } = quote;
  return {
    method: "delivery", status: "configured", amount: rate.amount, arcaVatRate: rate.arcaVatRate,
    rateId: rate.rateId, rateName: rate.name, carrier: rate.carrier, shippingPromotion: rate.promotion,
    address: { ...address, ...deliveryDetails }, city: address.city, postalCode: address.postalCode, notes,
  };
}
