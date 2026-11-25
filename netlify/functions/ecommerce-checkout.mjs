import { createEcommerceOrder, releaseEcommerceCheckout, reserveEcommerceCheckout } from "./_lib/ecommerce/commerceService.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
import { publicCommerceBody, limitCommerceRequest } from "./_lib/ecommerce/publicRequests.mjs";
import { previewPaywayBilling, validatePaywayInvoiceA } from "./_lib/ecommerce/paywayFiscalService.mjs";
import { paywayConfig } from "./_lib/ecommerce/paywayGateway.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export default async function handler(request, context = {}) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }
  try {
    const body = await publicCommerceBody(request);
    if (body?.mode === "billing-preview") {
      paywayConfig();
      await limitCommerceRequest(request, context, { scope: "billing-preview" });
      return json({ ok: true, billing: await previewPaywayBilling(body.cuit) });
    }
    if (body?.mode === "reserve" || body?.mode === "release") {
      await limitCommerceRequest(request, context, { scope: "checkout-reservation" });
      const action = body.mode === "reserve" ? reserveEcommerceCheckout : releaseEcommerceCheckout;
      return json({ ok: true, ...await action({ body }) });
    }
    if (body?.billing?.requestedClass === "A") paywayConfig();
    await limitCommerceRequest(request, context);
    await validatePaywayInvoiceA(body?.billing);
    const result = await createEcommerceOrder({ body, env: process.env });
    return json({
      ok: true,
      created: result.created,
      idempotent: result.idempotent,
      order: {
        id: result.order.id,
        status: result.order.status,
        paymentStatus: result.order.paymentStatus,
        invoiceStatus: result.order.invoiceStatus,
        subtotal: result.order.subtotal,
        discountTotal: result.order.discountTotal,
        shippingAmount: result.order.shippingAmount,
        total: result.order.total,
        sourceType: result.order.sourceType,
        saleId: result.order.saleId || null,
      },
    });
  } catch (error) {
    const safe = publicEcommerceError(error);
    return json({ ok: false, code: safe.code, message: safe.message }, safe.status);
  }
}
