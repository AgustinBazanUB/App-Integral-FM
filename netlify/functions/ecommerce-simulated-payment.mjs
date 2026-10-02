import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { confirmEcommercePayment } from "./_lib/ecommerce/paymentService.mjs";
import { prepareEcommerceInvoiceFiscal } from "./_lib/ecommerce/fiscalService.mjs";
import {
  ecommerceSimulatedPaymentEnabled,
  isLocalEcommerceRuntime,
} from "./_lib/ecommerce/paymentContract.mjs";
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
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }

  let paymentResult = null;
  try {
    const session = await requireFirebaseAdmin(request);
    const body = await request.json().catch(() => ({}));
    if (body?.mode === "status") {
      return json({
        ok: true,
        capability: {
          enabled: ecommerceSimulatedPaymentEnabled(process.env),
          localRuntime: isLocalEcommerceRuntime(process.env),
          adminRequired: true,
          productionCae: false,
        },
      });
    }

    const orderId = String(body?.orderId || "").trim();
    const idempotencyKey = String(body?.idempotencyKey || "").trim();
    const reference = `simulation:${orderId}:${idempotencyKey}`;
    paymentResult = await confirmEcommercePayment({
      orderId,
      idempotencyKey,
      provider: "simulation",
      status: "approved",
      reference,
      actor: {
        uid: session.uid,
        name: session.profile?.name || session.email || "Administrador",
        role: session.profile?.role || "admin",
        isAdmin: true,
      },
      env: process.env,
    });

    const fiscal = await prepareEcommerceInvoiceFiscal({
      orderId,
      idempotencyKey,
      receiverCuit: body?.receiverCuit || "",
      requestedBy: session.uid,
      requestedByName: session.profile?.name || session.email || null,
      env: process.env,
    });

    return json({
      ok: true,
      payment: {
        provider: paymentResult.paymentProvider,
        status: paymentResult.paymentStatus,
        idempotent: paymentResult.idempotent,
        saleId: paymentResult.saleId,
      },
      order: {
        id: paymentResult.order.id,
        status: paymentResult.order.status,
        paymentStatus: paymentResult.order.paymentStatus,
        saleId: paymentResult.order.saleId,
        total: paymentResult.order.total,
      },
      invoice: {
        id: fiscal.invoiceId,
        created: fiscal.invoiceCreated,
        status: fiscal.invoiceStatus,
        environment: fiscal.fiscalEnvironment,
      },
      receiver: {
        source: fiscal.receiver.source,
        vatConditionId: fiscal.receiver.vatConditionId,
        documentType: fiscal.receiver.documentType,
        anonymousConsumerFinal: fiscal.receiver.anonymousConsumerFinal,
      },
      fiscal: fiscal.fiscal,
    });
  } catch (error) {
    const safe = publicEcommerceError(error);
    return json({
      ok: false,
      code: safe.code,
      message: safe.message,
      phase: paymentResult ? "invoice" : "payment",
      ...(paymentResult ? {
        payment: {
          provider: paymentResult.paymentProvider,
          status: paymentResult.paymentStatus,
          idempotent: paymentResult.idempotent,
          saleId: paymentResult.saleId,
        },
        orderId: paymentResult.order?.id || null,
      } : {}),
    }, safe.status);
  }
}
