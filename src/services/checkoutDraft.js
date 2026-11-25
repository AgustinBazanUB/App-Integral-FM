import { checkoutReservationRequest } from "./ecommerceService";

export const DRAFT_KEY = "flor-mia-checkout-draft-v2";
export const CHECKOUT_DRAFT_EVENT = "flor-mia-checkout-draft-updated";

function newRequestId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `web_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function initialDraft() {
  return {
    requestId: newRequestId(),
    accessToken: newRequestId().replaceAll("-", "") + newRequestId().replaceAll("-", ""),
    addressSearch: "", deliverySelection: null, residenceType: "house", floor: "", apartment: "", instructions: "", receiverName: "",
    billingMode: "consumer_final", billingName: "", billingAddress: "",
    fullName: "",
    email: "",
    phone: "",
    deliveryMethod: "pickup",
    notes: "",
    marketingConsent: false,
    fiscalCuit: "",
  };
}

export function readDraft() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
    return {
      ...initialDraft(),
      ...saved,
      requestId: saved.requestId || newRequestId(),
      residenceType: saved.residenceType || (saved.floor || saved.apartment ? "apartment" : "house"),
      addressSearch: saved.addressSearch || [saved.street, saved.number].filter(Boolean).join(" "),
    };
  } catch {
    return initialDraft();
  }
}

export function checkoutCartKey(items) {
  return JSON.stringify(items.map(({ productId, quantity }) => ({ productId, quantity }))
    .sort((left, right) => left.productId.localeCompare(right.productId)));
}

export function activeCheckoutReservation(draft, cartKey, now = Date.now()) {
  return draft.stockHold?.cartKey === cartKey && draft.stockHold.expiresAt > now;
}

function saveDraft(draft) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

export async function reserveCheckoutDraft(draft, items) {
  const cartKey = checkoutCartKey(items);
  if (draft.pendingOrder || draft.checkoutStarted || activeCheckoutReservation(draft, cartKey)) return draft;
  let next = draft;
  if (draft.stockHold || (draft.holdRequestedFor && draft.holdRequestedFor !== cartKey)) {
    await checkoutReservationRequest({ mode: "release", requestId: draft.requestId, accessToken: draft.accessToken });
    const fresh = initialDraft();
    next = { ...draft, requestId: fresh.requestId, accessToken: fresh.accessToken, stockHold: null, holdRequestedFor: null };
  }
  const started = { ...next, holdRequestedFor: cartKey };
  saveDraft(started);
  try {
    const { expiresAt } = await checkoutReservationRequest({
      mode: "reserve", requestId: started.requestId, accessToken: started.accessToken, items: JSON.parse(cartKey),
    });
    const saved = { ...started, stockHold: { cartKey, expiresAt }, holdRequestedFor: null };
    saveDraft(saved);
    return saved;
  } catch (error) {
    if (["ecommerce-reservation-expired", "ecommerce-checkout-edited"].includes(error.code)) {
      const fresh = initialDraft();
      saveDraft({ ...started, requestId: fresh.requestId, accessToken: fresh.accessToken, holdRequestedFor: null });
    }
    throw error;
  }
}
