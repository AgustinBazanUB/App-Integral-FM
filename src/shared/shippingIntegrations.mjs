// Contracts only. These adapters never call external services or dispatch orders.
export const SHIPPING_INTEGRATION_CONTRACTS = Object.freeze({
  trackingReady: { event: "shipping.tracking_ready", required: ["shipmentId", "createdAt"], credentialPolicy: "Issue a fresh scoped customer credential in the trusted backend; never persist bearer URLs in an outbox." },
  ecommerce: { input: ["existingSaleId", "idempotencyKey", "customerSnapshot", "destination"], stockPolicy: "Reconcile the existing sale stock commitment before requesting a shipment; never deduct ecommerce stock twice." },
  uber: { input: ["shipmentId", "authorizedLeg", "pickupAddress", "destinationAddress", "idempotencyKey"], output: ["providerReference", "status", "quotedCost"] },
  whatsapp: { input: ["shipmentId", "authorizedRecipient", "revocableTrackingUrl", "idempotencyKey"], output: ["senderReference", "status"] },
  maps: { input: ["writtenAddress", "country", "userConfirmedMarker"], output: ["lat", "lng", "provinceOrCaba", "municipality", "locality", "neighborhood", "providerReference"], policy: "No inferred coordinates, region or ETA. Require configured provider and user verification." },
});
const disabled = name => async () => { throw Object.assign(new Error(`La integración ${name} está deshabilitada.`), { code: "shipping/integration-disabled" }); };
export const shippingAdapters = Object.freeze({
  ecommerce: Object.freeze({ enabled: false, requestShipment: disabled("Ecommerce") }),
  uber: Object.freeze({ enabled: false, dispatch: disabled("Uber API") }),
  whatsapp: Object.freeze({ enabled: false, sendTracking: disabled("WhatsApp Sender") }),
});
export function createShippingGeocoder(provider = null) {
  return { configured: Boolean(provider?.search), search: async writtenAddress => {
    if (!provider?.search) return { configured: false, candidates: [], message: "Geocodificación sin proveedor configurado. Verificá el marcador manualmente." };
    if (!String(writtenAddress || "").trim()) return { configured: true, candidates: [] };
    const candidates = await provider.search(String(writtenAddress).trim());
    return { configured: true, candidates: candidates.filter(point => typeof point.lat === "number" && typeof point.lng === "number" && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180).map(point => ({ ...point, verified: false })) };
  } };
}
