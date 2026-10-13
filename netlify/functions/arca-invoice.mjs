import { safeFiscalError } from "../../src/shared/fiscalRecovery.mjs";
import { can } from "../../src/gestion/permissions.js";
import { lookupBillingReceiver } from "./_lib/arca/receiverLookup.mjs";
import { validateInvoiceDraft } from "./_lib/arca/invoiceDraft.mjs";
import { requireFirebaseActiveProfile } from "./_lib/firebaseAuth.mjs";
import { adminGetDocument, adminRunTransaction } from "./_lib/firestoreAdminRest.mjs";
import { arcaEnvironment, productionAutoAuthorizeSources } from "./_lib/arca/config.mjs";
import { authorizeInvoice, reconcileInvoice, verifyAuthorizedInvoice } from "./_lib/arca/authorizer.mjs";
import {
  canRequestInvoiceForSale,
  completePendingInvoice,
  ensurePendingInvoice,
  syncInvoiceToSale,
} from "./_lib/arca/invoicePersistence.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  return { ...safeFiscalError(error), ...(error.publicMessage ? {message:error.message} : {}) };
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }

  try {
    const session = await requireFirebaseActiveProfile(request);
    const environment = arcaEnvironment(process.env).id;
    if (
      environment === "production"
      && String(process.env.ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE || "").trim().toLowerCase() !== "true"
    ) {
      return json({
        ok: false,
        code: "arca-production-invoice-prepare-disabled",
        message: "La preparación de facturas productivas está bloqueada por configuración.",
      }, 409);
    }

    const body = await request.json().catch(() => ({}));
    const sourceType = String(body?.sourceType || "").trim();
    const sourceId = String(body?.sourceId || "").trim();
    if (body.mode === "validate-draft") {
      if (!can(session.profile, "quick-sales", "requestTicket") || !can(session.profile, "quick-sales", "create")) return json({ok:false,code:"permission-denied",message:"No tenés permiso para generar facturas."},403);
      return json({ok:true,draft:await validateInvoiceDraft({sourceType,items:body.items,total:body.total,discountTotal:body.discountTotal,receiver:body.receiver,env:process.env})});
    }

    if (!sourceType || !sourceId) {
      return json({
        ok: false,
        code: "missing-source",
        message: "Falta identificar la venta a facturar.",
      }, 400);
    }

    const saleDocument = await adminGetDocument(`sales/${sourceId}`, { env: process.env });
    const sale = saleDocument?.data || null;
    if (!sale) {
      return json({ ok: false, code: "arca-sale-not-found", message: "La venta no existe." }, 404);
    }
    if (sale.status !== "active" || sale.fiscalCancellation) return json({ok:false,code:"arca-sale-not-active",message:"La venta está anulada o tiene una anulación en curso."},409);

    if (!canRequestInvoiceForSale({ sourceType, sale, session }) || !can(session.profile, "quick-sales", "requestTicket")) {
      return json({
        ok: false,
        code: "permission-denied",
        message: "No tenés permiso para preparar la factura de esta venta.",
      }, 403);
    }
    // Allow issuing an invoice for an existing active sale, without recording it again.
    await adminRunTransaction(async transaction=>{
      const current=await transaction.getDocument(`sales/${sourceId}`);
      if(!current?.data || current.data.status!=="active" || current.data.fiscalCancellation) throw Object.assign(new Error("La venta ya no está disponible para facturar."),{code:"arca-sale-not-active",status:409,publicMessage:true});
      if(!canRequestInvoiceForSale({sourceType,sale:current.data,session})) throw Object.assign(new Error("No tenés permiso sobre esta venta."),{code:"auth-permission-denied",status:403,publicMessage:true});
      if (!current.data.fiscalInvoiceId && !current.data.fiscalInvoice) await transaction.commitDocuments([{type:"update",path:`sales/${sourceId}`,currentUpdateTime:current.updateTime,data:sourceType==="seller_sale"?{ticketRequested:true,ticketStatus:"pending"}:{invoiceStatus:"pending"}}]);
    });

    let receiver = body?.receiver && typeof body.receiver === "object"
      ? {
          vatConditionId: Number(body.receiver.vatConditionId || 0),
          documentType: Number(body.receiver.documentType || 0),
          documentNumber: String(body.receiver.documentNumber || "").replace(/\D/g, ""),
          anonymousConsumerFinal: body.receiver.anonymousConsumerFinal === true,
          concept: Number(body.receiver.concept || 1),
        }
      : null;

    // Resolve again server-side: the browser cannot choose a tax condition for a CUIT.
    if ([80, 86].includes(receiver?.documentType) && (environment === "production" || body.receiver.resolveFromRegistry === true)) {
      receiver = (await lookupBillingReceiver(receiver.documentNumber)).receiver;
    }

    const result = await ensurePendingInvoice({
      sourceType,
      sourceId,
      requestedBy: session.uid,
      requestedByName: session.profile?.name || session.email || null,
      receiver,
      env: process.env,
    });
    if(!result.created && result.invoice?.status==='pending') {
      await completePendingInvoice({invoiceId:result.invoiceId,receiver,env:process.env});
      result.invoice=(await adminGetDocument(`invoices/${result.invoiceId}`)).data;
    }

    if (["reconciling","authorizing"].includes(result.invoice?.status) && result.invoice?.authorization?.voucherNumber) {
      await reconcileInvoice({invoiceId:result.invoiceId,env:process.env});
      result.invoice=(await adminGetDocument(`invoices/${result.invoiceId}`)).data;
    }
    await syncInvoiceToSale({
      invoiceId: result.invoiceId,
      env: process.env,
    });

    let autoAuthorization = null;
    const autoSources = productionAutoAuthorizeSources(process.env);
    const autoProduction = (
      environment === "production"
      && String(process.env.ARCA_AUTO_AUTHORIZE_PRODUCTION || "").trim().toLowerCase() === "true"
      && String(process.env.ARCA_ALLOW_PRODUCTION_CAE || "").trim().toLowerCase() === "true"
      && autoSources.includes(sourceType)
      && ["pending", "authorized"].includes(result.invoice?.status)
      && result.invoice?.fiscalReadiness?.ready === true
    );

    if (autoProduction) {
      const issuerVatCondition = String(process.env.ARCA_ISSUER_VAT_CONDITION || "").trim();
      if (!issuerVatCondition) {
        const error = new Error("Falta configurar la condición IVA del emisor.");
        error.code = "arca-issuer-vat-condition-missing";
        error.status = 409;
        throw error;
      }

      const authorization = await authorizeInvoice({
        invoiceId: result.invoiceId,
        issuerVatCondition,
        receiver: { requestedBy: session.uid },
        allowCaeRequest: true,
        automaticRequest: true,
        env: process.env,
      });

      let verification = null;
      if (authorization?.status === "authorized") {
        try {
          verification = await verifyAuthorizedInvoice({
            invoiceId: result.invoiceId,
            env: process.env,
          });
        } catch (verificationError) {
          verification = {
            verified: false,
            matched: false,
            error: safeError(verificationError),
          };
        }
      }

      await syncInvoiceToSale({
        invoiceId: result.invoiceId,
        env: process.env,
      });

      autoAuthorization = {
        attempted: true,
        status: authorization?.status || "unknown",
        blocked: authorization?.blocked === true,
        reason: authorization?.reason || null,
        verification,
        authorization: authorization?.invoice?.authorization
          ? {
              voucherClass: authorization.invoice.authorization.voucherClass || null,
              pointOfSale: authorization.invoice.authorization.pointOfSale || null,
              voucherType: authorization.invoice.authorization.voucherType || null,
              voucherNumber: authorization.invoice.authorization.voucherNumber || null,
              caeExpiration: authorization.invoice.authorization.caeExpiration || null,
            }
          : null,
      };
    }

    return json({
      ok: true,
      created: result.created,
      invoice: {
        id: result.invoiceId,
        status: autoAuthorization?.status || result.invoice?.status || "pending",
        fiscalReadiness: result.invoice?.fiscalReadiness || null,
        sourceType: result.invoice?.sourceType || sourceType,
        sourceId: result.invoice?.sourceId || sourceId,
        autoAuthorization,
      },
    });
  } catch (error) {
    const status = Number(error?.status || 0) || 500;
    return json({ ok: false, ...safeError(error) }, status);
  }
}
