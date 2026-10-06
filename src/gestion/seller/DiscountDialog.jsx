import { useEffect, useState } from "react";
import { Button, Modal } from "../../design-system";
import { formatMoney } from "../formatters";
import { Icon } from "../components/icons";

function discountValue(discount) {
  return discount.type === "percent"
    ? `${Number(discount.value || 0)} %`
    : formatMoney(discount.value);
}

export default function DiscountDialog({
  open,
  availableDiscounts = [],
  selectedDiscountIds = [],
  initialManualDiscounts = [],
  suggestedDiscountId = "",
  manualAllowed,
  onClose,
  onApply,
}) {
  const [draftIds, setDraftIds] = useState([]);
  const [draftManual, setDraftManual] = useState([]);
  const [manualType, setManualType] = useState("fixed");
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftIds([...new Set([...selectedDiscountIds, ...(suggestedDiscountId ? [suggestedDiscountId] : [])])]);
    setDraftManual([...initialManualDiscounts]);
    setManualType("fixed");
    setManualValue("");
    setError("");
  }, [open]);

  const parsedValue = Number(manualValue);
  const manualValid = Number.isInteger(parsedValue) && parsedValue > 0 && (manualType !== "percent" || parsedValue <= 100);

  const apply = () => {
    if (draftIds.some(id => !availableDiscounts.some(discount => discount.id === id))) {
      setError("[DESCUENTO-NO-DISPONIBLE] Uno de los descuentos elegidos dejó de estar disponible. Volvé a abrir este panel para revisar las opciones.");
      return;
    }
    const hasManualValue = manualValue !== "";
    if (hasManualValue && !manualAllowed) {
      setError("[DESCUENTO-MANUAL-PERMISO] Tu perfil no tiene permiso para aplicar descuentos manuales.");
      return;
    }
    if (hasManualValue && !manualValid) {
      setError(manualType === "percent"
        ? "[DESCUENTO-PORCENTAJE] Ingresá un porcentaje entero entre 1 y 100."
        : "[DESCUENTO-MONTO] Ingresá un monto entero mayor a cero.");
      return;
    }
    if (!draftIds.length && !draftManual.length && !hasManualValue && !selectedDiscountIds.length && !initialManualDiscounts.length) {
      setError("[DESCUENTO-FALTANTE] Elegí un descuento de la lista o ingresá un valor manual antes de confirmar.");
      return;
    }
    const manual = hasManualValue ? [...draftManual, {
      discountId: "manual",
      name: manualType === "percent" ? `Descuento manual · ${parsedValue} %` : "Descuento manual",
      type: manualType,
      value: parsedValue,
      source: "manual",
    }] : draftManual;
    onApply({ savedIds: draftIds, manual });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar descuento"
      description="Seleccioná los descuentos y confirmá abajo. El total cambia recién al confirmar."
      className="fm-seller-discount-modal"
    >
      <div className="fm-discount-dialog">
        <section>
          <div className="fm-discount-dialog__heading">
            <div>
              <span className="fm-overline">Descuentos disponibles</span>
              <p>Configurados por el administrador para esta venta.</p>
            </div>
            <Icon name="Percent" />
          </div>
          <div className="fm-discount-options">
            {(availableDiscounts || []).map((discount) => {
              const selected = draftIds.includes(discount.id);
              return (
                <button
                  key={discount.id}
                  type="button"
                  className={selected ? "is-selected" : ""}
                  aria-pressed={selected}
                  onClick={() => { setDraftIds(ids => ids.includes(discount.id) ? ids.filter(id => id !== discount.id) : [...ids, discount.id]); setError(""); }}
                >
                  <span>{discount.name}</span>
                  <strong>{discountValue(discount)}</strong>
                  <small>{selected ? "Seleccionado · falta confirmar" : discount.type === "percent" ? "Porcentaje" : "Monto fijo"}</small>
                </button>
              );
            })}
            {!(availableDiscounts || []).length ? (
              <p className="fm-discount-dialog__empty">No hay descuentos guardados disponibles para esta venta.</p>
            ) : null}
          </div>
        </section>

        <section className="fm-manual-discount">
          <div className="fm-discount-dialog__heading">
            <div>
              <span className="fm-overline">Descuento manual</span>
              <p>{manualAllowed ? "Elegí el tipo e ingresá solamente el valor." : "No habilitado para este perfil."}</p>
            </div>
          </div>
          <div className="fm-manual-discount__types" role="group" aria-label="Tipo de descuento manual">
            <button type="button" className={manualType === "fixed" ? "is-selected" : ""} aria-pressed={manualType === "fixed"} onClick={() => { if (!manualAllowed) { setError("[DESCUENTO-MANUAL-PERMISO] Tu perfil no tiene permiso para aplicar descuentos manuales."); return; } setManualType("fixed"); setError(""); }}>Monto fijo</button>
            <button type="button" className={manualType === "percent" ? "is-selected" : ""} aria-pressed={manualType === "percent"} onClick={() => { if (!manualAllowed) { setError("[DESCUENTO-MANUAL-PERMISO] Tu perfil no tiene permiso para aplicar descuentos manuales."); return; } setManualType("percent"); setError(""); }}>Porcentaje</button>
          </div>
          <label className="fm-field">
            <span>Valor</span>
            <div className="fm-manual-discount__value">
              <input
                type="number"
                min="1"
                max={manualType === "percent" ? "100" : undefined}
                step="1"
                inputMode="numeric"
                readOnly={!manualAllowed}
                value={manualValue}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "seller-manual-discount-error" : undefined}
                onChange={(event) => { setManualValue(event.target.value); setError(""); }}
                placeholder={manualType === "percent" ? "15" : "5000"}
              />
              <span aria-hidden="true">{manualType === "percent" ? "%" : "$"}</span>
            </div>
          </label>
          {draftManual.map((discount, index) => <div className="fm-seller-applied-discount" key={index}><span>{discount.name} · {discountValue(discount)}</span><button type="button" aria-label={`Quitar descuento manual ${index + 1}`} onClick={() => setDraftManual(current => current.filter((_, position) => position !== index))}><Icon name="X" /></button></div>)}
        </section>
        <div className="fm-dialog-actions"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button icon="Check" onClick={apply}>Confirmar descuentos</Button></div>
        {error ? <p className="fm-form-error" id="seller-manual-discount-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
