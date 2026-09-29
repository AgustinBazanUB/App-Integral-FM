import { requireFirebaseAdmin } from "./_lib/firebaseAuth.mjs";
import { authorizeInvoice, reconcileInvoice, recoverPreCaeInvoice, verifyAuthorizedInvoice } from "./_lib/arca/authorizer.mjs";
import { arcaEnvironment } from "./_lib/arca/config.mjs";
import { syncInvoiceToSale } from "./_lib/arca/invoicePersistence.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  },
});

function safeError(error) {
  return {
    code: error?.code || "arca-authorize-error",
    message: String(error?.message || "No se pudo completar la operación fiscal.").slice(0, 300),
  };
}

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ ok: false, code: "method-not-allowed" }, 405);
  }

  try {
    const session = await requireFirebaseAdmin(request);
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || "dry-run").trim().toLowerCase();
    const invoiceId = String(body?.invoiceId || "").trim();

    if (!invoiceId) {
      return json({ ok: false, code: "missing-invoice-id", message: "Falta identificar la solicitud fiscal." }, 400);
    }

    if (mode === "reconcile") {
      const result = await reconcileInvoice({
        invoiceId,
        env: process.env,
      });
      await syncInvoiceToSale({ invoiceId, env: process.env });
      return json({ ok: true, mode, result });
    }

    if (mode === "recover-pre-cae") {
      const result = await recoverPreCaeInvoice({
        invoiceId,
        env: process.env,
      });
      await syncInvoiceToSale({ invoiceId, env: process.env });
      return json({ ok: true, mode, result });
    }

    if (mode === "verify-authorized") {
      const result = await verifyAuthorizedInvoice({
        invoiceId,
        env: process.env,
      });
      await syncInvoiceToSale({ invoiceId, env: process.env });
      return json({ ok: true, mode, result });
    }

    if (!["dry-run", "authorize"].includes(mode)) {
      return json({ ok: false, code: "invalid-mode", message: "Modo fiscal inválido." }, 400);
    }

    if (mode === "authorize") {
      const environment = arcaEnvironment(process.env).id;
      const homologationEnabled = String(process.env.ARCA_ALLOW_CAE_HOMOLOGATION || "")
        .trim()
        .toLowerCase() === "true";
      const productionEnabled = String(process.env.ARCA_ALLOW_PRODUCTION_CAE || "")
        .trim()
        .toLowerCase() === "true";

      if (environment === "homologation" && !homologationEnabled) {
        return json({
          ok: false,
          code: "arca-cae-disabled",
          message: "La solicitud de CAE de homologación está deshabilitada.",
        }, 409);
      }
      if (environment === "production" && !productionEnabled) {
        return json({
          ok: false,
          code: "arca-production-authorization-blocked",
          message: "La solicitud de CAE productivo está deshabilitada.",
        }, 409);
      }
    }

    const issuerVatCondition = String(process.env.ARCA_ISSUER_VAT_CONDITION || "").trim();
    if (!issuerVatCondition) {
      return json({
        ok: false,
        code: "arca-issuer-vat-condition-missing",
        message: "Falta configurar la condición IVA del emisor.",
      }, 409);
    }

    const receiver = body?.receiver && typeof body.receiver === "object"
      ? {
          vatConditionId: Number(body.receiver.vatConditionId || 0),
          documentType: Number(body.receiver.documentType || 0),
          documentNumber: String(body.receiver.documentNumber || "").trim(),
          anonymousConsumerFinal: body.receiver.anonymousConsumerFinal === true,
          concept: Number(body.receiver.concept || 1),
          requestedBy: session.uid,
        }
      : { requestedBy: session.uid };

    const result = await authorizeInvoice({
      invoiceId,
      issuerVatCondition,
      receiver,
      allowCaeRequest: mode === "authorize",
      env: process.env,
    });

    if (
      mode === "authorize"
      && arcaEnvironment(process.env).id === "production"
      && result?.status === "authorized"
    ) {
      try {
        const verification = await verifyAuthorizedInvoice({
          invoiceId,
          env: process.env,
        });
        await syncInvoiceToSale({ invoiceId, env: process.env });
        return json({
          ok: true,
          mode,
          result: {
            ...result,
            postAuthorizationVerification: verification,
          },
        });
      } catch (verificationError) {
        return json({
          ok: true,
          mode,
          result: {
            ...result,
            postAuthorizationVerification: {
              verified: false,
              matched: false,
              error: safeError(verificationError),
            },
          },
        });
      }
    }

    if (mode === "authorize") {
      await syncInvoiceToSale({ invoiceId, env: process.env });
    }
    return json({ ok: true, mode, result });
  } catch (error) {
    return json(
      { ok: false, ...safeError(error) },
      Number(error?.status || 0) || 500,
    );
  }
}
