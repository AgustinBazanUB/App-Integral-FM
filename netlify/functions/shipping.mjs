import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { createShippingSale, createCourierSession, activateCourierQr, readCourierSession, shippingOperation, listShippingResources, limitShippingPublic } from "./_lib/shipping.mjs";
import { shippingFeed, markShippingNotificationRead } from "./_lib/shippingFeed.mjs";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
export default async function handler(request, context = {}) {
  if (request.method !== "POST") return json({ ok: false }, 405);
  let body;
  try {
    if (process.env.SHIPPING_ENABLED === "false") return json({ ok: false, message: "El módulo de envíos está deshabilitado." }, 503);
    const raw = await request.text();
    if (raw.length > 120000) return json({ ok: false, message: "Solicitud demasiado grande." }, 413);
    try { body = JSON.parse(raw); } catch { return json({ ok: false, message: "El formato de la solicitud no es válido." }, 400); }
    if (!body || Array.isArray(body) || typeof body !== "object") return json({ ok: false }, 400);
    const authenticated = Boolean(request.headers.get("authorization"));
    const session = authenticated ? await requireFirebaseActiveProfile(request) : null;
    if (!session) await limitShippingPublic(context.ip || request.headers.get("x-nf-client-connection-ip") || "unknown");
    let result;
    if (body.mode === "create_sale") {
      if (!session) return json({ ok: false }, 401);
      result = await createShippingSale({ sale: body.sale || {}, session, requestId: body.requestId, administrative: body.administrative === true });
    } else if (body.mode === "create_courier_session") {
      if (!session) return json({ ok: false }, 401);
      result = await createCourierSession({ body, session });
    } else if (body.mode === "activate_courier_qr") {
      if (session) return json({ ok: false }, 400);
      result = await activateCourierQr({ body });
    } else if (body.mode === "courier_session_detail") {
      if (!session) return json({ ok: false }, 401);
      result = await readCourierSession({ sessionId: body.sessionId, session });
    } else if (body.mode === "resources") {
      if (!session) return json({ ok: false }, 401);
      result = await listShippingResources(session);
    } else if (body.mode === "feed" || body.mode === "notifications") {
      if (!session) return json({ ok: false }, 401);
      result = await shippingFeed({ session, kind: body.mode === "notifications" ? "notifications" : "shipments", assigned: body.assigned === true });
    } else if (body.mode === "read_notification") {
      if (!session) return json({ ok: false }, 401);
      result = await markShippingNotificationRead({ session, alertId: body.alertId });
    } else result = await shippingOperation({ body, session });
    return json({ ok: true, result });
  } catch (error) {
    // Keep server diagnostics useful without logging request bodies, tokens, or configuration values.
    console.error("[shipping] request failed", {
      mode: typeof body?.mode === "string" ? body.mode : "unknown",
      code: typeof error?.code === "string" ? error.code : "unknown",
      status: Number(error?.status) || 0,
    });
    return json({ ok: false, code: error.publicMessage ? error.code : "shipping/unavailable", message: error.publicMessage ? error.message : "No se pudo completar la operación de envíos. Verificá la conexión y la configuración del servidor." }, Number(error.status) || 500);
  }
}
