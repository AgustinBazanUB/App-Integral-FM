import { useEffect, useRef, useState } from "react";
import { Button, FormField, Modal, Toast } from "../../design-system";
import { isValidCuit } from "../../../netlify/functions/_lib/arca/cuit.mjs";
import { lookupArcaBillingReceiver } from "../services/arcaService";
import { formatMoney } from "../formatters";

export const consumerFinalBillingReceiver = () => ({
  vatConditionId: 5,
  documentType: 99,
  documentNumber: "0",
  anonymousConsumerFinal: true,
  concept: 1,
});

export default function ArcaBillingDialog({
  open,
  total,
  busy = false,
  online = true,
  error = "",
  onClose,
  onConfirm,
  onContinue,
  continueLabel = "Continuar sin factura",
}) {
  const [mode, setMode] = useState("consumer");
  const [document, setDocument] = useState("");
  const [lookup, setLookup] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const lookupVersion = useRef(0);
  useEffect(() => {
    lookupVersion.current += 1;
    if (open) {
      setMode("consumer");
      setDocument("");
      setLookup({ busy: false, result: null, error: "" });
    }
  }, [open]);
  const changeDocument = (value) => {
    lookupVersion.current += 1;
    setDocument(
      value.replace(/\D/g, "").slice(0, mode === "consumer" ? 8 : 11),
    );
    setLookup({ busy: false, result: null, error: "" });
  };
  const query = async () => {
    const version = ++lookupVersion.current;
    setLookup({ busy: true, result: null, error: "" });
    try {
      const result = await lookupArcaBillingReceiver(document);
      if (version === lookupVersion.current)
        setLookup({ busy: false, result, error: "" });
    } catch (error) {
      if (version === lookupVersion.current)
        setLookup({ busy: false, result: null, error: error.message });
    }
  };
  const ready =
    online &&
    !busy &&
    !lookup.busy &&
    (mode === "consumer"
      ? !document || /^\d{7,8}$/.test(document)
      : Boolean(lookup.result));
  const confirm = () => {
    const receiver =
      mode === "consumer"
        ? document
          ? {
              ...consumerFinalBillingReceiver(),
              documentType: 96,
              documentNumber: document,
              anonymousConsumerFinal: false,
            }
          : consumerFinalBillingReceiver()
        : { ...lookup.result.receiver, resolveFromRegistry: true };
    onConfirm(receiver);
  };
  return (
    <Modal
      open={open}
      title="Generar factura"
      description="Elegí el receptor. La factura se emite con CAE al confirmar la venta."
      onClose={() => !busy && !lookup.busy && onClose()}
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy || lookup.busy}
            onClick={onContinue}
          >
            {continueLabel}
          </Button>
          <Button disabled={!ready} loading={busy} onClick={confirm}>
            {busy ? "Generando factura…" : "Generar factura y guardar venta"}
          </Button>
        </>
      }
    >
      <p className="fm-billing-total">
        Total <strong>{formatMoney(total)}</strong>
      </p>
      <FormField label="Condición fiscal del cliente">
        <select
          disabled={busy || lookup.busy}
          value={mode}
          onChange={(event) => {
            lookupVersion.current += 1;
            setMode(event.target.value);
            setDocument("");
            setLookup({ busy: false, result: null, error: "" });
          }}
        >
          <option value="consumer">Consumidor final</option>
          <option value="1">Responsable inscripto</option>
          <option value="6">Monotributista</option>
          <option value="4">Exento</option>
          <option value="cuit">Otra condición / consultar CUIT o CUIL</option>
        </select>
      </FormField>
      <FormField
        label={
          mode === "consumer" ? "DNI (opcional)" : "CUIT/CUIL del receptor"
        }
        required={mode !== "consumer"}
        hint={
          mode === "consumer"
            ? "Podés dejarlo vacío para consumidor final sin identificar."
            : "CUIT obligatorio. La consulta en ARCA determina el tipo de factura."
        }
      >
        <input
          disabled={busy}
          inputMode="numeric"
          aria-required={mode !== "consumer"}
          value={document}
          onChange={(event) => changeDocument(event.target.value)}
        />
      </FormField>
      {mode !== "consumer" ? (
        <Button
          variant="secondary"
          loading={lookup.busy}
          disabled={busy || !online || !isValidCuit(document)}
          onClick={query}
        >
          Consultar CUIT
        </Button>
      ) : null}
      {mode !== "consumer" &&
      document.length === 11 &&
      !isValidCuit(document) ? (
        <p className="fm-form-error" role="alert">
          El dígito verificador del CUIT no es válido.
        </p>
      ) : null}
      {lookup.result ? (
        <p role="status">
          <strong>{lookup.result.name}</strong>
          <br />
          {lookup.result.condition.description} · Factura{" "}
          {[1, 6, 13, 16].includes(lookup.result.condition.id) ? "A" : "B"}
        </p>
      ) : null}
      {lookup.result &&
      mode !== "cuit" &&
      Number(mode) !== lookup.result.condition.id ? (
        <Toast tone="warning">
          ARCA informa una condición diferente a la seleccionada. Se usará la
          condición y el tipo de factura que corresponden al cliente.
        </Toast>
      ) : null}
      {lookup.error ? <Toast tone="error">{lookup.error}</Toast> : null}
      {error ? <Toast tone="error">{error}</Toast> : null}
      {!online ? (
        <Toast tone="warning">
          Necesitás conexión para emitir una factura con CAE.
        </Toast>
      ) : null}
    </Modal>
  );
}
