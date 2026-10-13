import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Toast } from "../../design-system";
import ArcaBillingDialog from "./ArcaBillingDialog";
import ArcaInvoicePrintAction from "./ArcaInvoicePrintAction";
import {
  arcaSourceTypeForSale,
  getArcaInvoiceForSale,
  requestPendingArcaInvoice,
} from "../services/arcaService";
import { invoiceDeliveryLabel } from "../../shared/invoiceDelivery.mjs";
import { fiscalPresentation } from "../../shared/fiscalRecovery.mjs";

export default function SaleInvoicePanel({
  sale,
  allowGenerate = false,
  invoiceState = null,
  showDelivery = true,
}) {
  const [state, setState] = useState({
    loading: true,
    invoice: null,
    error: "",
  });
  const [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  const sourceType = arcaSourceTypeForSale(sale);
  useEffect(() => {
    if (invoiceState && revision === 0) {
      setState({
        loading: !invoiceState.ready,
        invoice: invoiceState.invoice,
        error: invoiceState.error,
      });
      return;
    }
    let active = true;
    setState({ loading: true, invoice: null, error: "" });
    getArcaInvoiceForSale({
      saleId: sale.id,
      sourceType,
      invoiceId: sale.fiscalInvoiceId || null,
    })
      .then((invoice) => {
        if (active) setState({ loading: false, invoice, error: "" });
      })
      .catch((error) => {
        if (active)
          setState({
            loading: false,
            invoice: null,
            error: error.code === "arca-invoice-not-found" ? "" : error.message,
          });
      });
    return () => {
      active = false;
    };
  }, [sale.id, sale.fiscalInvoiceId, sourceType, revision, invoiceState]);
  const generate = async (receiver) => {
    if (busy) return;
    setBusy(true);
    setState((current) => ({ ...current, error: "" }));
    try {
      const invoice = await requestPendingArcaInvoice({
        sourceId: sale.id,
        sourceType,
        receiver,
      });
      setOpen(false);
      setRevision((value) => value + 1);
      if (invoice.status !== "authorized")
        setState((current) => ({
          ...current,
          error:
            "La venta está guardada. La factura sigue pendiente; revisá el estado antes de intentar otra emisión.",
        }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setBusy(false);
    }
  };
  const invoice = state.invoice;
  return (
    <section className="fm-sale-invoice-panel" aria-label="Factura de la venta">
      <h3>Factura</h3>
      {state.loading ? (
        <p role="status">Consultando factura…</p>
      ) : invoice ? (
        <>
          <p>
            <strong>
              {invoice.status === "authorized"
                ? invoiceDeliveryLabel(invoice)
                : fiscalPresentation(invoice).label}
            </strong>
            <br />
            {invoice.creditedAt
              ? "Revertida mediante nota de crédito. Se conserva el comprobante original."
              : invoice.pdf?.ready
                ? "Autorizada y verificada en ARCA."
                : invoice.status === "cancelled"
                  ? "Solicitud cancelada sin emitir una factura."
                  : invoice.recovery?.lastError?.message ||
                    "La venta está guardada; el comprobante todavía necesita autorización o verificación."}
          </p>
          {showDelivery ? (
            <ArcaInvoicePrintAction
              saleId={sale.id}
              sourceType={sourceType}
              invoiceId={invoice.id}
              invoice={invoice}
            />
          ) : null}
        </>
      ) : !state.error ? (
        <p>Esta venta no tiene factura emitida.</p>
      ) : null}
      {state.error ? <Toast tone="error">{state.error}</Toast> : null}
      {allowGenerate &&
      sale.status !== "cancelled" &&
      !sale.fiscalCancellation &&
      !state.loading &&
      (!invoice ||
        ["pending", "authorizing", "reconciling"].includes(invoice.status) ||
        (invoice.status === "authorized" && !invoice.pdf?.ready)) ? (
        <Button
          variant="secondary"
          icon="FileText"
          loading={busy}
          onClick={() =>
            invoice?.receiver ? generate(invoice.receiver) : setOpen(true)
          }
        >
          {invoice ? "Actualizar / completar factura" : "Generar factura"}
        </Button>
      ) : null}
      {sale.fiscalCancellation?.creditNoteId || invoice?.creditNoteId ? (
        <div className="fm-sale-credit-note">
          <h3>Nota de crédito</h3>
          <ArcaInvoicePrintAction
            saleId={sale.id}
            sourceType={sourceType}
            invoiceId={
              sale.fiscalCancellation?.creditNoteId || invoice.creditNoteId
            }
          />
        </div>
      ) : null}
      {open
        ? createPortal(
            <div className="fm-management-body">
              <ArcaBillingDialog
                open
                total={sale.total}
                busy={busy}
                error={state.error}
                onClose={() => setOpen(false)}
                onContinue={() => setOpen(false)}
                continueLabel="Cancelar"
                onConfirm={generate}
              />
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
