import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  FormField,
  Modal,
  Toast,
} from "../../design-system";
import {
  buildCustomerDraft,
  isValidCustomerPhone,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { Icon } from "../components/icons";
import { findCustomerByPhone } from "../services/customerService";

const EMPTY_FORM = {
  phone: "",
  zoneId: "",
  customZone: "",
  name: "",
};

export default function CustomerDialog({
  open,
  zones = [],
  online = true,
  initialCustomer = null,
  onClose,
  onSelect,
}) {
  const lookupSequence = useRef(0);
  const [form, setForm] = useState(EMPTY_FORM);
  const [foundCustomer, setFoundCustomer] = useState(null);
  const [lookupState, setLookupState] = useState({ busy: false, checked: false, message: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    lookupSequence.current += 1;
    if (initialCustomer) {
      setForm({
        phone: initialCustomer.phone || initialCustomer.phoneNormalized || "",
        zoneId: initialCustomer.zoneId || (initialCustomer.customZone ? "__custom" : ""),
        customZone: initialCustomer.customZone || "",
        name: initialCustomer.name || "",
      });
      setFoundCustomer(initialCustomer.persisted ? initialCustomer : null);
      setLookupState({ busy: false, checked: Boolean(initialCustomer.persisted), message: "" });
    } else {
      setForm(EMPTY_FORM);
      setFoundCustomer(null);
      setLookupState({ busy: false, checked: false, message: "" });
    }
    setError("");
  }, [open, initialCustomer]);

  const resetLookup = (phone) => {
    setForm((current) => ({ ...current, phone }));
    setFoundCustomer(null);
    setLookupState({ busy: false, checked: false, message: "" });
    setError("");
  };

  const lookup = async () => {
    const normalized = normalizeCustomerPhone(form.phone);
    if (!isValidCustomerPhone(normalized)) {
      setError("Ingresá un teléfono válido.");
      return { status: "invalid", customer: null };
    }
    if (!online) {
      setLookupState({ busy: false, checked: true, message: "Sin conexión: el teléfono se resolverá al sincronizar la venta." });
      return { status: "offline", customer: null };
    }
    const request = ++lookupSequence.current;
    setLookupState({ busy: true, checked: false, message: "Buscando cliente…" });
    setError("");
    try {
      const customer = await findCustomerByPhone(form.phone);
      if (request !== lookupSequence.current) return { status: "stale", customer: null };
      if (customer) {
        setFoundCustomer({ ...customer, persisted: true });
        setForm({
          phone: customer.phone || form.phone,
          zoneId: customer.zoneId || (customer.customZone ? "__custom" : ""),
          customZone: customer.customZone || "",
          name: customer.name || "",
        });
        setLookupState({ busy: false, checked: true, message: "Cliente encontrado" });
        return { status: "found", customer };
      }
      setFoundCustomer(null);
      setLookupState({ busy: false, checked: true, message: "Teléfono nuevo" });
      return { status: "new", customer: null };
    } catch (lookupError) {
      setLookupState({ busy: false, checked: false, message: "" });
      setError(lookupError.message);
      return { status: "error", customer: null };
    }
  };

  const confirm = async () => {
    setError("");
    let existing = foundCustomer;
    if (!lookupState.checked && online) {
      const result = await lookup();
      if (result.status === "error" || result.status === "invalid" || result.status === "stale") return;
      existing = result.customer;
      if (existing) {
        onSelect({ ...existing, persisted: true });
        onClose();
        return;
      }
    }
    if (existing) {
      onSelect({ ...existing, persisted: true });
      onClose();
      return;
    }
    try {
      const zone = zones.find((item) => item.id === form.zoneId);
      const draft = buildCustomerDraft({
        phone: form.phone,
        name: form.name,
        zoneId: zone?.id || "",
        zoneName: zone?.name || "",
        customZone: form.zoneId === "__custom" ? form.customZone : "",
      });
      onSelect({ ...draft, persisted: false });
      onClose();
    } catch (validationError) {
      setError(validationError.message);
    }
  };

  const existingZone = foundCustomer?.zoneName || foundCustomer?.customZone || "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar cliente"
      description="Identificá al cliente sin frenar la venta. El nombre es opcional."
      footer={
        <div className="fm-dialog-actions fm-customer-dialog__actions">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button icon="UserPlus" loading={lookupState.busy} onClick={confirm}>
            {foundCustomer ? "Usar cliente" : "Agregar"}
          </Button>
        </div>
      }
    >
      <div className="fm-customer-dialog">
        <div className={`fm-field ${error && !isValidCustomerPhone(form.phone) ? "fm-field--error" : ""}`}>
          <label htmlFor="seller-customer-phone">Teléfono <span aria-hidden="true">*</span></label>
          <div className="fm-customer-phone-field">
            <input
              id="seller-customer-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              aria-describedby="seller-customer-phone-hint"
              value={form.phone}
              onChange={(event) => resetLookup(event.target.value)}
              onBlur={() => {
                if (!lookupState.checked && !lookupState.busy && isValidCustomerPhone(form.phone)) lookup();
              }}
            />
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={lookup} disabled={lookupState.busy}>
              <Icon name="Search" />Buscar
            </button>
          </div>
          <p id="seller-customer-phone-hint" className="fm-field__hint">Es el identificador principal. Espacios, guiones y paréntesis no generan duplicados.</p>
        </div>

        {lookupState.message ? (
          <div className={`fm-customer-lookup ${foundCustomer ? "is-found" : ""}`} role="status">
            {foundCustomer ? <Icon name="UserRoundCheck" /> : <Icon name={online ? "Search" : "WifiOff"} />}
            <span>
              <strong>{lookupState.message}</strong>
              {foundCustomer ? <small>{foundCustomer.phone || foundCustomer.phoneNormalized}{existingZone ? ` · ${existingZone}` : ""}{foundCustomer.name ? ` · ${foundCustomer.name}` : ""}</small> : null}
            </span>
            {foundCustomer ? <Badge tone="success">Existente</Badge> : null}
          </div>
        ) : null}

        {foundCustomer ? (
          <div className="fm-customer-existing-note">
            <Icon name="ShieldCheck" />
            <p>Se usarán los datos ya guardados. Esta venta no modifica automáticamente el nombre ni la zona del cliente.</p>
          </div>
        ) : (
          <>
            <FormField label="Zona" required>
              <select value={form.zoneId} onChange={(event) => setForm((current) => ({ ...current, zoneId: event.target.value }))}>
                <option value="">Elegir zona</option>
                {zones.filter((zone) => zone.active !== false).map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                <option value="__custom">Nueva zona / Otra zona</option>
              </select>
            </FormField>
            {form.zoneId === "__custom" ? (
              <FormField label="Nueva zona" required hint="Se guarda sólo en este cliente; no se agrega automáticamente a la lista global.">
                <input value={form.customZone} onChange={(event) => setForm((current) => ({ ...current, customZone: event.target.value }))} />
              </FormField>
            ) : null}
            <FormField label="Nombre (opcional)">
              <input autoComplete="name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </FormField>
          </>
        )}

        {error ? <Toast tone="error">{error}</Toast> : null}
      </div>
    </Modal>
  );
}
