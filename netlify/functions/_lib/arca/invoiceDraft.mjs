import { adminGetDocument } from "../firestoreAdminRest.mjs";
import { arcaEnvironment, productionAutoAuthorizeSources } from "./config.mjs";
import { lookupBillingReceiver } from "./receiverLookup.mjs";
import { buildAuthorizationPlan } from "./authorizationPlan.mjs";

const problem = (message, code) =>
  Object.assign(new Error(message), { code, status: 409, publicMessage: true });
export async function validateInvoiceDraft({
  sourceType,
  items,
  total,
  discountTotal = 0,
  receiver,
  env = process.env,
  getDocument = adminGetDocument,
  lookupReceiver = lookupBillingReceiver,
}) {
  const environment = arcaEnvironment(env).id;
  if (!["seller_sale", "admin_quick_sale"].includes(sourceType))
    throw problem("Origen de facturación inválido.", "arca-source-invalid");
  if (
    environment === "production" &&
    (![
      "ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE",
      "ARCA_ALLOW_PRODUCTION_CAE",
      "ARCA_AUTO_AUTHORIZE_PRODUCTION",
    ].every((key) => String(env[key]).toLowerCase() === "true") ||
      !productionAutoAuthorizeSources(env).includes(sourceType))
  ) {
    throw problem(
      "La emisión automática de facturas no está habilitada en esta versión. Usá el preview fiscal actualizado.",
      "arca-auto-invoice-unavailable",
    );
  }
  if (
    environment === "homologation" &&
    String(env.ARCA_ALLOW_CAE_HOMOLOGATION).toLowerCase() !== "true"
  )
    throw problem(
      "La emisión de prueba no está habilitada en esta versión. Usá el preview fiscal actualizado.",
      "arca-cae-disabled",
    );
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw problem(
      "Agregá productos antes de generar la factura.",
      "arca-items-invalid",
    );
  const cleaned = items.map((item) => {
    const productId = String(item.productId || item.id || "");
    const qty = Number(item.qty),
      unitPrice = Number(item.unitPrice ?? item.price);
    if (
      !/^[A-Za-z0-9_-]+$/.test(productId) ||
      !Number.isInteger(qty) ||
      qty <= 0 ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    )
      throw problem("Revisá los productos de la venta.", "arca-items-invalid");
    return { productId, qty, unitPrice, subtotal: qty * unitPrice };
  });
  let resolved = receiver;
  if ([80, 86].includes(Number(receiver?.documentType)))
    resolved = (await lookupReceiver(receiver.documentNumber, { env }))
      .receiver;
  const productFiscalSnapshot = await Promise.all(
    [...new Set(cleaned.map((item) => item.productId))].map(
      async (productId) => {
        const product = await getDocument(`products/${productId}`, { env });
        const raw =
          product?.data?.arcaVatRate ?? env.ARCA_DEFAULT_PRODUCT_VAT_RATE;
        if (
          !product?.data ||
          raw == null ||
          raw === "" ||
          ![0, 10.5, 21, 27].includes(Number(raw))
        )
          throw problem(
            "Un producto tiene datos fiscales incompletos. Revisalo antes de guardar la venta.",
            "arca-fiscal-readiness-incomplete",
          );
        return { productId, arcaVatRate: Number(raw) };
      },
    ),
  );
  const plan = buildAuthorizationPlan({
    invoice: {
      status: "pending",
      fiscalReadiness: { ready: true },
      productFiscalSnapshot,
      saleSnapshot: {
        items: cleaned,
        total: Number(total),
        discountTotal: Number(discountTotal),
      },
    },
    issuerVatCondition: env.ARCA_ISSUER_VAT_CONDITION,
    receiverVatConditionId: resolved?.vatConditionId,
    documentType: resolved?.documentType,
    documentNumber: resolved?.documentNumber,
    anonymousConsumerFinal: resolved?.anonymousConsumerFinal,
    consumerFinalIdThreshold: Number(env.ARCA_CONSUMER_FINAL_ID_THRESHOLD),
  });
  if (plan.blockers.length)
    throw problem(
      "Para este importe, identificá al consumidor final con DNI o CUIT.",
      "arca-consumer-final-identification-required",
    );
  return { ready: true, receiver: resolved, voucherClass: plan.voucherClass };
}
