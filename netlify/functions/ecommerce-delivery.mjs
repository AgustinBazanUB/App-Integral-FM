import { lookupAddresses } from "./_lib/ecommerce/addressLookup.mjs";
import { commerceError } from "./_lib/ecommerce/commerceDomain.mjs";
import { loadDeliveryQuoteCart } from "./_lib/ecommerce/commerceService.mjs";
import { confirmSelectedAddress, deliveryAddressEnabled, publicAddressOption, quoteSelectedDelivery } from "./_lib/ecommerce/deliveryQuote.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
import { limitCommerceRequest, publicCommerceBody } from "./_lib/ecommerce/publicRequests.mjs";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export default async function handler(request, context = {}) {
  if (request.method !== "POST") return json({ ok: false, code: "method-not-allowed" }, 405);
  try {
    if (!deliveryAddressEnabled()) {
      throw commerceError("ecommerce-delivery-lookup-unconfigured", "La consulta de envíos todavía no está habilitada.", 503);
    }
    const body = await publicCommerceBody(request);
    if (!["search", "address", "quote"].includes(body?.mode)) {
      throw commerceError("ecommerce-delivery-request-invalid", "La consulta de envío no es válida.", 400);
    }
    await limitCommerceRequest(request, context, { scope: "delivery" });
    const now = new Date();
    if (body.mode === "search") {
      const matches = await lookupAddresses(body.query);
      return json({ ok: true, options: matches.map((address) => publicAddressOption(address, { now })) });
    }
    if (body.mode === "address") {
      return json({ ok: true, address: await confirmSelectedAddress(body.selectionToken, { now }) });
    }
    const cart = await loadDeliveryQuoteCart(body.items, { now, checkoutReservation: body.checkoutReservation });
    const result = await quoteSelectedDelivery({ ...cart, selectionToken: body.selectionToken, now });
    return json({ ok: true, ...result });
  } catch (error) {
    const safe = publicEcommerceError(error);
    return json({ ok: false, code: safe.code, message: safe.message }, safe.status);
  }
}
