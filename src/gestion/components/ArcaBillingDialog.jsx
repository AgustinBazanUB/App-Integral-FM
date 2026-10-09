import { useEffect, useRef, useState } from "react";
import { Button, FormField, Modal, Toast } from "../../design-system";
import { isValidCuit } from "../../../netlify/functions/_lib/arca/cuit.mjs";
import { lookupArcaBillingReceiver } from "../services/arcaService";
import { formatMoney } from "../formatters";

export const consumerFinalBillingReceiver = () => ({ vatConditionId: 5, documentType: 99, documentNumber: "0", anonymousConsumerFinal: true, concept: 1 });

export default function ArcaBillingDialog({ open, total, busy = false, online = true, error = "", onClose, onConfirm, onContinue }) {
  const [mode, setMode] = useState("consumer");
  const [document, setDocument] = useState("");
  const [lookup, setLookup] = useState({ busy: false, result: null, error: "" });
  const lookupVersion = useRef(0);
  useEffect(() => {
    lookupVersion.current += 1;
    if (open) { setMode("consumer"); setDocument(""); setLookup({ busy: false, result: null, error: "" }); }
  }, [open]);
  const changeDocument = value => {
    lookupVersion.current += 1;
    setDocument(value.replace(/\D/g, "").slice(0, mode === "cuit" ? 11 : 8));
    setLookup({ busy: false, result: null, error: "" });
  };
  const query = async () => {
    const version = ++lookupVersion.current;
    setLookup({ busy: true, result: null, error: "" });
    try {
      const result = await lookupArcaBillingReceiver(document);
      if (version === lookupVersion.current) setLookup({ busy: false, result, error: "" });
    } catch (error) {
      if (version === lookupVersion.current) setLookup({ busy: false, result: null, error: error.message });
    }
  };
  const ready = online && !busy && !lookup.busy && (mode === "consumer" ? (!document || /^\d{7,8}$/.test(document)) : Boolean(lookup.result));
  const confirm = () => {
    const receiver = mode === "consumer"
      ? (document ? { ...consumerFinalBillingReceiver(), documentType: 96, documentNumber: document, anonymousConsumerFinal: false } : consumerFinalBillingReceiver())
      : { ...lookup.result.receiver, resolveFromRegistry: true };
    onConfirm(receiver);
  };
  return <Modal open={open} title="Cargar factura" description="Consultá el receptor y generá el comprobante fiscal de esta venta." onClose={() => !busy && onClose()} footer={<><Button variant="secondary" disabled={busy || lookup.busy} onClick={onContinue}>Solo continuar</Button><Button disabled={!ready} loading={busy} onClick={confirm}>Generar factura y continuar</Button></>}>
    <p className="fm-billing-total">Total <strong>{formatMoney(total)}</strong></p>
    <FormField label="Receptor"><select disabled={busy} value={mode} onChange={event => { lookupVersion.current += 1; setMode(event.target.value); setDocument(""); setLookup({ busy: false, result: null, error: "" }); }}><option value="consumer">Consumidor final</option><option value="cuit">Consultar CUIT/CUIL en ARCA</option></select></FormField>
    <FormField label={mode === "consumer" ? "DNI (opcional)" : "CUIT/CUIL del receptor"} hint={mode === "consumer" ? "Podés dejarlo vacío para consumidor final sin identificar." : "La condición IVA se consulta en ARCA y determina el tipo de factura."}><input disabled={busy} inputMode="numeric" value={document} onChange={event => changeDocument(event.target.value)} /></FormField>
    {mode === "cuit" ? <Button variant="secondary" loading={lookup.busy} disabled={busy || !online || !isValidCuit(document)} onClick={query}>Consultar CUIT</Button> : null}
    {mode === "cuit" && document.length === 11 && !isValidCuit(document) ? <p className="fm-form-error" role="alert">El dígito verificador del CUIT no es válido.</p> : null}
    {lookup.result ? <p role="status"><strong>{lookup.result.name}</strong><br />{lookup.result.condition.description} · Factura {[1, 6, 13, 16].includes(lookup.result.condition.id) ? "A" : "B"}</p> : null}
    {lookup.error ? <Toast tone="error">{lookup.error}</Toast> : null}
    {error ? <Toast tone="error">{error}</Toast> : null}
    {!online ? <Toast tone="warning">Necesitás conexión para emitir una factura con CAE.</Toast> : null}
  </Modal>;
}
