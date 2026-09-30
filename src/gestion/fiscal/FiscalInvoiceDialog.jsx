import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, FormField, Modal, Select, Toast } from "../../design-system";
import { formatCuit, isValidCuit, normalizeCuit } from "../../shared/fiscal/cuit.js";
import { resolveArcaFiscalReceiver } from "../services/arcaService";
import { createReceiverRequestGuard } from "./receiverRequestGuard.js";

function addressLabel(address) {
  if (!address) return "No informado";
  return [
    address.address,
    address.locality,
    address.province,
    address.postalCode ? `CP ${address.postalCode}` : null,
  ].filter(Boolean).join(" · ") || "No informado";
}

function errorLabel(error) {
  const category = String(error?.category || "").trim();
  if (category === "TEMPORARY_UPSTREAM_ERROR") return "ARCA no está disponible temporalmente.";
  if (category === "CONFIGURATION_ERROR") return error?.message || "La configuración ARCA requiere revisión.";
  if (category === "CREDENTIAL_ERROR") return "Las credenciales ARCA requieren revisión.";
  if (category === "PERMISSION_ERROR") return "No tenés permisos para esta operación.";
  if (category === "VALIDATION_ERROR") return error?.message || "Revisá los datos fiscales ingresados.";
  return "No se pudo resolver el receptor fiscal.";
}

export default function FiscalInvoiceDialog({
  open,
  onClose,
  onResolved,
  saleTotal,
  sourceType = "admin_quick_sale",
  resolveReceiver = resolveArcaFiscalReceiver,
}) {
  const [mode, setMode] = useState("consumer_final");
  const [cuit, setCuit] = useState("");
  const [state, setState] = useState({ busy: false, error: null, resolution: null });
  const requestGuard = useRef(null);
  if (!requestGuard.current) requestGuard.current = createReceiverRequestGuard();

  useEffect(() => {
    requestGuard.current.invalidate();
    if (!open) return;
    setMode("consumer_final");
    setCuit("");
    setState({ busy: false, error: null, resolution: null });
    return () => { requestGuard.current.invalidate(); };
  }, [open, saleTotal, sourceType]);

  const normalizedCuit = useMemo(() => normalizeCuit(cuit), [cuit]);
  const cuitLooksValid = isValidCuit(normalizedCuit);

  const resolve = async () => {
    if (mode === "cuit" && !cuitLooksValid) {
      setState({
        busy: false,
        resolution: null,
        error: { code: "arca-cuit-invalid", category: "VALIDATION_ERROR", message: "La CUIT ingresada es inválida." },
      });
      return;
    }
    setState({ busy: true, error: null, resolution: null });
    const version = requestGuard.current.begin();
    try {
      const resolution = await resolveReceiver({ mode, cuit: normalizedCuit, saleTotal, concept: 1 });
      if (!requestGuard.current.isCurrent(version)) return;
      setState({ busy: false, error: null, resolution });
    } catch (error) {
      if (!requestGuard.current.isCurrent(version)) return;
      setState({ busy: false, error, resolution: null });
    }
  };

  const confirm = () => {
    if (!state.resolution?.receiver) return;
    onResolved?.(state.resolution.receiver, { ...state.resolution, sourceType });
    onClose?.();
  };

  const review = state.resolution?.review || null;

  return (
    <Modal
      open={open}
      onClose={state.busy ? undefined : onClose}
      title="Datos fiscales del receptor"
      description="Resolvé y revisá el receptor. Este paso no solicita CAE ni autoriza una factura."
      footer={(
        <div className="fm-dialog-actions">
          <Button variant="secondary" onClick={onClose} disabled={state.busy}>Cancelar</Button>
          <Button onClick={confirm} disabled={!state.resolution?.receiver || state.busy}>Confirmar receptor</Button>
        </div>
      )}
    >
      <div className="fm-form-grid">
        <FormField label="Tipo de receptor" required>
          <Select value={mode} disabled={state.busy} onChange={(event) => {
            requestGuard.current.invalidate();
            setMode(event.target.value);
            setState({ busy: false, error: null, resolution: null });
          }}>
            <option value="consumer_final">Consumidor Final</option>
            <option value="cuit">Facturar con CUIT</option>
          </Select>
        </FormField>

        {mode === "cuit" ? (
          <FormField
            label="CUIT"
            required
            error={cuit && !cuitLooksValid ? "Revisá los 11 dígitos y el dígito verificador." : ""}
            hint="Se valida antes de consultar el padrón ARCA."
          >
            <input
              inputMode="numeric"
              autoComplete="off"
              disabled={state.busy}
              value={cuit}
              onChange={(event) => {
                requestGuard.current.invalidate();
                setCuit(event.target.value.replace(/\D/g, "").slice(0, 11));
                setState((current) => ({ ...current, error: null, resolution: null }));
              }}
              placeholder="20-12345678-6"
            />
          </FormField>
        ) : (
          <div>
            <strong>Consumidor Final</strong>
            <p>El backend valida el total de la venta contra el umbral configurado antes de devolver un receptor anónimo.</p>
          </div>
        )}
      </div>

      <div className="fm-dialog-actions">
        <Button
          variant="secondary"
          onClick={resolve}
          loading={state.busy}
          disabled={state.busy || (mode === "cuit" && !cuitLooksValid)}
        >
          {mode === "cuit" ? "Consultar CUIT en ARCA" : "Preparar Consumidor Final"}
        </Button>
      </div>

      {state.error ? <Toast tone="error">{errorLabel(state.error)}</Toast> : null}

      {review ? (
        <div className="fm-settings-list" aria-live="polite">
          <div><div><strong>Receptor</strong><span>{review.displayName || "Sin nombre informado"}</span></div><Badge tone="success">Revisar</Badge></div>
          <div><div><strong>CUIT</strong><span>{review.cuit ? formatCuit(review.cuit) : "No aplica"}</span></div><Badge tone="neutral">{review.cuit ? "Validada" : "Consumidor Final"}</Badge></div>
          <div><div><strong>Condición IVA</strong><span>{review.vatCondition?.description || "No resuelta"}</span></div><Badge tone={review.vatCondition ? "success" : "warning"}>{review.vatCondition ? "Resuelta" : "Revisar"}</Badge></div>
          <div><div><strong>Estado</strong><span>{review.keyStatus || "No aplica"}</span></div><Badge tone={review.keyStatus === "ACTIVO" || !review.keyStatus ? "success" : "warning"}>{review.keyStatus || "N/A"}</Badge></div>
          <div><div><strong>Domicilio fiscal</strong><span>{addressLabel(review.fiscalAddress)}</span></div><Badge tone="neutral">Dato ARCA</Badge></div>
        </div>
      ) : null}
    </Modal>
  );
}
