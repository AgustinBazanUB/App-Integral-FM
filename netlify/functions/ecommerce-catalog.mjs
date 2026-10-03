import { loadEcommerceCatalog } from "./_lib/ecommerce/commerceService.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

export default async function handler(request) {
  if (request.method !== "GET") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }
  try {
    const catalog = await loadEcommerceCatalog({ env: process.env });
    return json({ ok: true, catalog });
  } catch (error) {
    const safe = publicEcommerceError(error);
    return json({ ok: false, code: safe.code, message: safe.message }, safe.status);
  }
}
