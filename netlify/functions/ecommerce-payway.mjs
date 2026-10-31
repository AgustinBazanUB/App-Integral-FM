import { processPaywayPayment } from "./_lib/ecommerce/paywayService.mjs";
import { paywayConfig, paywayPublicConfig } from "./_lib/ecommerce/paywayGateway.mjs";
import { publicCommerceBody, limitCommerceRequest } from "./_lib/ecommerce/publicRequests.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
} });
export default async function handler(request, context = {}) {
  if (request.method === "GET") return json({ ok: true, payway: paywayPublicConfig() });
  if (request.method !== "POST") return json({ ok: false }, 405);
  try {
    paywayConfig(); // Verify isolation before the rate limiter's first write.
    const body = await publicCommerceBody(request);
    await limitCommerceRequest(request, context);
    return json({ ok: true, ...await processPaywayPayment({ body }) });
  } catch (error) { const safe = publicEcommerceError(error); return json({ ok: false, ...safe }, safe.status); }
}
