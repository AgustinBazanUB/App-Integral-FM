import { adminGetDocument, adminListDocuments } from "../firestoreAdminRest.mjs";
import { commerceError } from "./commerceDomain.mjs";
import { assertValidCuit } from "../arca/cuit.mjs";
import { isLocationActiveNow } from "../../../../src/modules/locations/domain/locations.js";
import { availableStockAfterReservations } from "../../../../src/shared/stockReservations.mjs";
import {
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from "../../../../src/gestion/customers/customerDomain.js";

export const WEB_CHANNEL_ID = "ecommerce";
export const ALL_ACTIVE_STOCK = "all_active";
export const SELECTED_STOCK = "selected";
export const originKey = (origin) => origin && `${origin.type}:${origin.id}`;
export const originDocumentPath = (origin) =>
  `${origin.type === "warehouse" ? "warehouses" : "locations"}/${origin.id}`;
export const originStockPath = (origin, productId) =>
  `${origin.type === "warehouse" ? "warehouseStock" : "locationStock"}/${origin.id}/items/${productId}`;
export const stockCollectionPath = (origin) =>
  `${origin.type === "warehouse" ? "warehouseStock" : "locationStock"}/${origin.id}/items`;

export function isActiveWebStock(stock) {
  return Boolean(stock && stock.active !== false && stock.deleted !== true && stock.productDeleted !== true);
}

export function webStockAvailability(stock, now, excludeOrderId) {
  return isActiveWebStock(stock) ? availableStockAfterReservations(stock, now, excludeOrderId) : 0;
}

export function webPricingStock(channel, stocks) {
  // An automatic stock pool may change without changing the price of a product.
  return channel?.stockScope === ALL_ACTIVE_STOCK
    ? { priceMode: "default" }
    : stocks.find(isActiveWebStock) || { priceMode: "default" };
}
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

export function isActiveStockOrigin(type, source, now = new Date()) {
  if (!source || source.deleted === true) return false;
  return type === "warehouse" ? source.active !== false : isLocationActiveNow(source, now);
}

export function physicalStockOrigins(locations, warehouses, now = new Date()) {
  return [
    ...locations.filter((row) => isActiveStockOrigin("location", row, now))
      .map((row) => ({ ...row, type: "location", locationType: row.type || "store" })),
    ...warehouses.filter((row) => isActiveStockOrigin("warehouse", row, now))
      .map((row) => ({ ...row, type: "warehouse" })),
  ];
}

export function channelIncludesOrigin(channel, origin) {
  const key = originKey(origin);
  return channel.stockScope === ALL_ACTIVE_STOCK
    ? !(channel.excludedOrigins || []).some((row) => originKey(row) === key)
    : (channel.authorizedOrigins || []).some((row) => originKey(row) === key);
}

function namedOrigin(origin, source) {
  return {
    ...origin,
    name: source.name || origin.id,
    address: source.address || "",
  };
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
  { env = process.env, getDocument = adminGetDocument, now = new Date() } = {},
) {
  const origin = checkedOrigin(requested || channel.defaultOrigin);
  if (!channelIncludesOrigin(channel, origin))
    throw commerceError(
      "ecommerce-origin-not-authorized",
      "El origen no está autorizado para este canal.",
      403,
    );
  const snapshot = await getDocument(originDocumentPath(origin), { env });
  if (!isActiveStockOrigin(origin.type, snapshot?.data, now))
    throw commerceError(
      "ecommerce-location-unavailable",
      "El origen físico no está disponible.",
      409,
    );
  return namedOrigin(origin, snapshot.data);
}

export async function resolveChannelOrigins(channel, {
  env = process.env, getDocument = adminGetDocument, listDocuments = adminListDocuments, now = new Date(),
} = {}) {
  let origins;
  if (channel.stockScope === ALL_ACTIVE_STOCK) {
    const [locations, warehouses] = await Promise.all([
      listDocuments("locations", { env }),
      listDocuments("warehouses", { env }),
    ]);
    origins = physicalStockOrigins(locations, warehouses, now)
      .map((row) => namedOrigin(checkedOrigin(row), row))
      .filter((row) => channelIncludesOrigin(channel, row));
  } else {
    const selected = [...new Map((channel.authorizedOrigins || []).map((row) => [originKey(row), row])).values()];
    origins = (await Promise.all(selected.map(async (row) => {
      const origin = checkedOrigin(row);
      const source = (await getDocument(originDocumentPath(origin), { env }))?.data;
      return isActiveStockOrigin(origin.type, source, now) ? namedOrigin(origin, source) : null;
    }))).filter(Boolean);
  }
  const priority = originKey(channel.defaultOrigin);
  return origins.sort((left, right) =>
    Number(originKey(right) === priority) - Number(originKey(left) === priority)
    || originKey(left).localeCompare(originKey(right)));
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
    ...(raw.requestedClass === "A" ? { requestedClass: "A" } : {}),
  };
}

export function deliveryAddressDetails(raw = {}) {
  const { floor, apartment, instructions, receiverName, receiverPhone } = raw || {};
  const phone = clean(receiverPhone, 60);
  if (phone && !isValidCustomerPhone(phone)) {
    throw commerceError("ecommerce-customer-phone-invalid", "Ingresá un teléfono válido para quien recibe.", 400);
  }
  return {
    floor: clean(floor, 150), apartment: clean(apartment, 150), instructions: clean(instructions, 500),
    receiverName: clean(receiverName, 150), receiverPhone: phone ? normalizeCustomerPhone(phone) : "",
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
  const address = {
    ...Object.fromEntries(["street", "number", "city", "province", "postalCode"]
      .map((key) => [key, clean(raw.address?.[key], 150)])),
    ...deliveryAddressDetails(raw.address),
  };
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
