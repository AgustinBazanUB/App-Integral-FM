const allowedEvents = new Set([
  "view_item_list",
  "select_item",
  "view_item",
  "search",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
]);

export function trackEvent(eventName, payload = {}) {
  if (!allowedEvents.has(eventName)) return;

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: eventName, ...payload });
  }

  window.dispatchEvent(
    new CustomEvent("flor-mia:analytics", {
      detail: { event: eventName, ...payload },
    }),
  );
}
