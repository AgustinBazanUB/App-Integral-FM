import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, FormField, Modal } from "../../design-system";
import { invoiceDeliveryLabel, normalizeInvoiceEmail } from "../../shared/invoiceDelivery.mjs";
import { getArcaInvoiceForSale, sendArcaInvoiceEmail } from "../services/arcaService";

export default function ArcaInvoiceEmailDialog({ open, onClose, saleId, sourceType, invoiceId, invoice }) {
  const formId = useId();
  const [to, setTo] = useState("");
  const [configuration, setConfiguration] = useState({ busy: true, ready: false });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const request = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    if (request.current?.accepted) request.current = null;
    setError(""); setReceipt(null);
    setConfiguration({ busy: true, ready: false });
    getArcaInvoiceForSale({ saleId, sourceType, invoiceId })
      .then((metadata) => { if (active) setConfiguration({ busy: false, ...metadata?.email }); })
      .catch((failure) => { if (active) { setConfiguration({ busy: false, ready: false }); setError(failure.message || "No se pudo consultar la conexión de correo."); } });
    return () => { active = false; };
  }, [open, saleId, sourceType, invoiceId]);

  const send = async (event) => {
    event.preventDefault();
    if (sending || !configuration.ready || receipt) return;
    setError("");
    let recipient;
    try { recipient = normalizeInvoiceEmail(to); }
    catch (failure) { setError(failure.message); return; }
    if (!request.current || request.current.to !== recipient) request.current = { to: recipient, id: crypto.randomUUID() };
    setSending(true);
    try {
      const result = await sendArcaInvoiceEmail({ saleId, sourceType, invoiceId, to: recipient, requestId: request.current.id });
      request.current.accepted = true;
      setReceipt(result);
    } catch (failure) { setError(failure.message || "No se pudo confirmar el envío del correo."); }
    finally { setSending(false); }
  };

  if (!open) return null;
  // The invoice actions can live inside the seller receipt modal. Mount this
  // dialog beside that overlay so the parent's inert state cannot block it.
  return createPortal(<div className="fm-management-body fm-arca-email-host">
    <Modal open={open} onClose={sending ? undefined : onClose} title="Enviar factura por mail"
      description={`${invoiceDeliveryLabel(invoice)} · PDF adjunto con CAE y código QR`}
      footer={<div className="fm-dialog-actions">
        <Button variant="secondary" disabled={sending} onClick={onClose}>{receipt ? "Cerrar" : "Cancelar"}</Button>
        {!receipt ? <Button type="submit" form={formId} icon="Mail" loading={sending} disabled={configuration.busy || !configuration.ready}>Enviar factura</Button> : null}
      </div>}
    >
      <form id={formId} onSubmit={send} className="fm-arca-email-form">
        <FormField label="Correo del cliente" required>
          <input type="email" autoComplete="email" placeholder="cliente@correo.com" value={to}
            maxLength={254} required disabled={sending || Boolean(receipt)} onChange={(event) => setTo(event.target.value)} />
        </FormField>
        {configuration.busy ? <p role="status">Consultando la conexión de correo…</p> : configuration.ready
          ? <p>La factura se enviará desde <strong>{configuration.from}</strong>.</p>
          : <p role="status">Falta conectar la cuenta de correo de Flor Mía. Podés descargar o imprimir la factura mientras tanto.</p>}
        {receipt ? <p className="fm-arca-email-success" role="status">El servicio de correo aceptó el envío a <strong>{receipt.to}</strong>. Si no aparece, revisá también la carpeta de spam.</p> : null}
        {error ? <p className="fm-arca-print-error" role="alert">{error}</p> : null}
      </form>
    </Modal>
  </div>, document.body);
}
