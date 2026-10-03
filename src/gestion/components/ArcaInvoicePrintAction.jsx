import { useEffect, useState } from "react";
import { Button } from "../../design-system";
import {
  arcaInvoicePrintStatus,
  isArcaInvoicePrintable,
} from "../services/arcaInvoicePrint";
import {
  fetchArcaInvoicePdf,
  getArcaInvoiceForSale,
} from "../services/arcaService";

export default function ArcaInvoicePrintAction({
  saleId,
  sourceType,
  invoiceId = null,
  invoice: initialInvoice = null,
}) {
  const [invoiceState, setInvoiceState] = useState({
    busy: Boolean(saleId && sourceType && !initialInvoice?.pdf),
    invoice: initialInvoice?.pdf ? initialInvoice : null,
    error: "",
  });
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const resolvedInvoiceId = invoiceId || initialInvoice?.id || null;

  useEffect(() => {
    let active = true;
    if (initialInvoice?.pdf && typeof initialInvoice.pdf.ready === "boolean") {
      setInvoiceState({ busy: false, invoice: initialInvoice, error: "" });
      return () => { active = false; };
    }
    if (!saleId || !sourceType) {
      setInvoiceState({ busy: false, invoice: null, error: "No se pudo identificar la venta." });
      return () => { active = false; };
    }

    setInvoiceState({ busy: true, invoice: null, error: "" });
    getArcaInvoiceForSale({ saleId, sourceType, invoiceId: resolvedInvoiceId })
      .then((invoice) => {
        if (active) setInvoiceState({ busy: false, invoice, error: "" });
      })
      .catch((error) => {
        if (active) setInvoiceState({
          busy: false,
          invoice: null,
          error: error?.message || "No se pudo consultar la factura asociada.",
        });
      });

    return () => { active = false; };
  }, [saleId, sourceType, resolvedInvoiceId, initialInvoice?.id, initialInvoice?.pdf?.ready]);

  const openPdf = async () => {
    if (printing || !isArcaInvoicePrintable(invoiceState.invoice)) return;
    setPrinting(true);
    setPrintError("");
    const printWindow = window.open("about:blank", "_blank");
    if (printWindow) {
      printWindow.opener = null;
      printWindow.document.title = "Preparando factura";
      printWindow.document.body.textContent = "Preparando el PDF seguro para imprimir…";
    }

    try {
      const { blob, filename } = await fetchArcaInvoicePdf({
        saleId,
        sourceType,
        invoiceId: resolvedInvoiceId || invoiceState.invoice?.id,
        disposition: "inline",
      });
      const pdfUrl = URL.createObjectURL(blob);
      if (printWindow && !printWindow.closed) {
        printWindow.location.replace(pdfUrl);
      } else {
        const link = document.createElement("a");
        link.href = pdfUrl;
        link.download = filename || "Factura_ARCA.pdf";
        link.rel = "noopener";
        document.body.append(link);
        link.click();
        link.remove();
        setPrintError("El navegador bloqueó la pestaña nueva; descargamos el PDF para que puedas abrirlo e imprimirlo.");
      }
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 5 * 60 * 1000);
    } catch (error) {
      if (printWindow && !printWindow.closed) printWindow.close();
      setPrintError(error?.message || "No se pudo abrir el PDF de la factura.");
    } finally {
      setPrinting(false);
    }
  };

  if (invoiceState.busy) {
    return <p className="fm-arca-print-note" role="status">Consultando si la factura está lista para imprimir…</p>;
  }
  if (invoiceState.error) {
    return <p className="fm-arca-print-note" role="status">{invoiceState.error}</p>;
  }
  if (!invoiceState.invoice) return null;

  const printable = isArcaInvoicePrintable(invoiceState.invoice);
  return (
    <div className="fm-arca-print-action" aria-live="polite">
      {printable ? (
        <>
          <Button variant="secondary" icon="Printer" loading={printing} onClick={openPdf}>
            Imprimir factura
          </Button>
          <small>Se abrirá el PDF seguro en una pestaña nueva para imprimirlo o guardarlo.</small>
        </>
      ) : (
        <p className="fm-arca-print-note" role="status">{arcaInvoicePrintStatus(invoiceState.invoice)}</p>
      )}
      {printError ? <p className="fm-arca-print-error" role="alert">{printError}</p> : null}
    </div>
  );
}
