import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { commerceError } from "./commerceDomain.mjs";
import { assertValidCuit } from "../arca/cuit.mjs";
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from "../../../../src/gestion/customers/customerDomain.js";

export const WEB_CHANNEL_ID = "ecommerce";
export const originStockPath = (origin, productId) =>
  `${origin.type === "warehouse" ? "warehouseStock" : "locationStock"}/${origin.id}/items/${productId}`;
const clean = (value, max = 150) =>
  String(value || "")
    .trim()
    .slice(0, max);
export function checkedOrigin(value = {}) {
  const origin = { type: value.type, id: clean(value.id, 150) };
  if (
    !["location", "warehouse"].includes(origin.type) ||
    !/^[A-Za-z0-9_-]{1,150}$/.test(origin.id)
  )
    throw commerceError(
      "ecommerce-origin-invalid",
      "Elegí un origen físico válido.",
      400,
    );
  return origin;
}
export async function loadWebChannel({
  env = process.env,
  getDocument = adminGetDocument,
} = {}) {
  const snapshot = await getDocument(`channels/${WEB_CHANNEL_ID}`, { env });
  if (!snapshot) return null; // Existing deployments remain readable until configured.
  const channel = { ...snapshot.data, id: WEB_CHANNEL_ID };
  if (channel.active !== true)
    throw commerceError(
      "ecommerce-channel-inactive",
      "El canal web no está habilitado.",
      409,
    );
  return channel;
}
export async function resolveChannelOrigin(
  channel,
  requested,
  { env = process.env, getDocument = adminGetDocument } = {},
) {
  const origin = checkedOrigin(requested || channel.defaultOrigin);
  if (
    !(channel.authorizedOrigins || []).some(
      (entry) => entry.id === origin.id && entry.type === origin.type,
    )
  )
    throw commerceError(
      "ecommerce-origin-not-authorized",
      "El origen no está autorizado para este canal.",
      403,
    );
  const snapshot = await getDocument(
    `${origin.type === "warehouse" ? "warehouses" : "locations"}/${origin.id}`,
    { env },
  );
  if (
    !snapshot?.data ||
    snapshot.data.active === false ||
    snapshot.data.deleted === true
  )
    throw commerceError(
      "ecommerce-location-unavailable",
      "El origen físico no está disponible.",
      409,
    );
  return {
    ...origin,
    name: snapshot.data.name,
    address: snapshot.data.address || "",
  };
}
export function normalizeBilling(raw = {}) {
  if (!raw.mode || raw.mode === "consumer_final")
    return { mode: "consumer_final", cuit: "" };
  if (raw.mode !== "fiscal")
    throw commerceError(
      "ecommerce-billing-invalid",
      "Elegí una opción de facturación válida.",
      400,
    );
  const cuit=assertValidCuit(raw.cuit,"CUIT del receptor"), name=clean(raw.name,200), address=clean(raw.address,300);
  if(!name || !address) throw commerceError("ecommerce-billing-invalid","Completá nombre o razón social y domicilio fiscal.",400);
  return {
    mode: "fiscal",
    cuit, name, address,
  };
}
export function channelShipping(raw = {}, channel) {
  const method = raw.method || "pickup",
    notes = clean(raw.notes, 500);
  if (method === "pickup") {
    if (channel.pickup?.enabled !== true || !clean(channel.pickup.address))
      throw commerceError(
        "ecommerce-pickup-not-configured",
        "El punto de retiro no está configurado.",
        409,
      );
    return {
      method,
      amount: 0,
      status: "configured",
      address: null,
      city: null,
      postalCode: null,
      notes,
      pickup: channel.pickup,
    };
  }
  if (method !== "delivery" || channel.delivery?.enabled !== true)
    throw commerceError(
      "ecommerce-delivery-not-configured",
      "El envío no está configurado.",
      409,
    );
  const address = Object.fromEntries(
    [
      "street",
      "number",
      "floor",
      "apartment",
      "city",
      "province",
      "postalCode",
      "instructions",
      "receiverName",
      "receiverPhone",
    ].map((key) => [
      key,
      clean(raw.address?.[key], key === "instructions" ? 500 : 150),
    ]),
  );
  if (
    ![
      address.street,
      address.number,
      address.city,
      address.province,
      address.postalCode,
    ].every(Boolean)
  )
    throw commerceError(
      "ecommerce-address-incomplete",
      "Completá calle, altura, localidad, provincia y código postal.",
      400,
    );
  if (address.receiverName && !isValidCustomerPhone(address.receiverPhone))
    throw commerceError(
      "ecommerce-customer-phone-invalid",
      "Ingresá el teléfono del receptor.",
      400,
    );
  if (address.receiverPhone)
    address.receiverPhone = normalizeCustomerPhone(address.receiverPhone);
  const rate = (channel.delivery.rates || []).find(
    (entry) =>
      entry.active !== false &&
      entry.id === raw.rateId &&
      entry.province.toLocaleLowerCase("es") ===
        address.province.toLocaleLowerCase("es") &&
      entry.postalCodes.includes(address.postalCode.toUpperCase()),
  );
  if (!rate || !Number.isSafeInteger(rate.amount) || rate.amount < 0)
    throw commerceError(
      "ecommerce-delivery-coverage",
      "No hay una tarifa habilitada para ese destino.",
      409,
    );
  if (rate.amount > 0 && ![0, 10.5, 21, 27].includes(rate.arcaVatRate))
    throw commerceError(
      "ecommerce-shipping-vat-required",
      "Falta configurar el IVA de la tarifa de envío.",
      409,
    );
  return {
    method,
    amount: rate.amount,
    arcaVatRate: rate.arcaVatRate ?? null,
    rateId: rate.id,
    rateName: rate.name,
    status: "configured",
    address,
    city: address.city,
    postalCode: address.postalCode,
    notes,
  };
}
