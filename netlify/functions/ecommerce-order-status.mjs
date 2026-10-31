import { createHash, timingSafeEqual } from "node:crypto";
import { adminGetDocument } from "./_lib/firestoreAdminRest.mjs";
import { publicEcommerceError } from "./_lib/ecommerce/publicError.mjs";
import {
  publicCommerceBody,
  limitCommerceRequest,
} from "./_lib/ecommerce/publicRequests.mjs";
import { commerceError } from "./_lib/ecommerce/commerceDomain.mjs";
import { buildInvoicePdf } from "./_lib/arca/invoicePdf.mjs";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
export default async function handler(request, context = {}) {
  if (request.method !== "POST") return json({ ok: false }, 405);
  try {
    const body = await publicCommerceBody(request);
    await limitCommerceRequest(request, context);
    if (
      !/^ecommerce_order_[A-Za-z0-9_-]{8,96}$/.test(body.orderId || "") ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(body.accessToken || "")
    )
      throw commerceError(
        "ecommerce-order-access-denied",
        "El acceso al pedido no es válido.",
        403,
      );
    const order = (await adminGetDocument(`orders/${body.orderId}`))?.data;
    const digest = createHash("sha256").update(body.accessToken).digest("hex");
    if (
      !order?.accessHash ||
      order.accessHash.length !== digest.length ||
      !timingSafeEqual(Buffer.from(digest), Buffer.from(order.accessHash))
    )
      throw commerceError(
        "ecommerce-order-access-denied",
        "El acceso al pedido no es válido.",
        403,
      );
    const shipment = order.shipmentId
      ? (await adminGetDocument(`shipments/${order.shipmentId}`))?.data
      : null;
    const invoice = order.invoiceId
      ? (await adminGetDocument(`invoices/${order.invoiceId}`))?.data
      : null;
    const documentAvailable =
      invoice?.sourceId === order.saleId &&
      invoice.status === "authorized" &&
      invoice.verification?.matched === true;
    if (body.mode === "document") {
      if (!documentAvailable)
        throw commerceError(
          "ecommerce-document-pending",
          "El comprobante todavía no está disponible.",
          409,
        );
      const document = buildInvoicePdf({ invoice, env: process.env });
      return new Response(document.pdf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${document.filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return json({
      ok: true,
      order: {
        id: body.orderId,
        code: order.orderCode,
        status: order.status,
        reservationExpired:
          order.reservationStatus === "active" &&
          new Date(order.reservationExpiresAt) <= new Date(),
        paymentStatus: order.paymentStatus,
        simulated: order.simulated === true,
        total: order.total,
        invoiceStatus: invoice?.status || order.invoiceStatus,
        documentAvailable,
        fulfillmentStatus: shipment?.status || null,
        deliveryMethod: order.shipping.method,
        pickupCode: order.pickupCode || null,
        updatedAt: shipment?.updatedAt || order.updatedAt,
      },
    });
  } catch (error) {
    const safe = publicEcommerceError(error);
    return json({ ok: false, ...safe }, safe.status);
  }
}
