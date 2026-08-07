import { useEffect, useMemo, useState } from "react";
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
  availableDiscounts,
  selectedDiscountIds,
  manualAllowed,
  onClose,
  onSelectSaved,
  onAddManual,
}) {
  const [manualType, setManualType] = useState("fixed");
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setManualType("fixed");
    setManualValue("");
    setError("");
  }, [open]);

  const parsedValue = Number(manualValue);
  const manualValid = useMemo(() => {
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) return false;
    if (manualType === "percent" && parsedValue > 100) return false;
    return true;
  }, [manualType, parsedValue]);

  const applyManual = () => {
    if (!manualAllowed) {
      setError("Tu perfil no tiene permiso para aplicar descuentos manuales.");
      return;
    }
    if (!manualValid) {
      setError(manualType === "percent"
        ? "Ingresá un porcentaje entero entre 1 y 100."
        : "Ingresá un monto entero mayor a cero.");
      return;
    }
    onAddManual({
      discountId: "manual",
      name: manualType === "percent" ? `Descuento manual · ${parsedValue} %` : "Descuento manual",
      type: manualType,
      value: parsedValue,
      source: "manual",
    });
    setManualValue("");
    setError("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Agregar descuento"
      description="Elegí un descuento habilitado o cargá uno manual."
      className="fm-seller-discount-modal"
    >
      <div className="fm-discount-dialog">
        <section>
          <div className="fm-discount-dialog__heading">
            <div>
              <span className="fm-overline">Descuentos disponibles</span>
              <p>Configurados por el administrador para esta ubicación.</p>
            </div>
            <Icon name="Percent" />
          </div>
          <div className="fm-discount-options">
            {(availableDiscounts || []).map((discount) => {
              const selected = selectedDiscountIds.includes(discount.id);
              return (
                <button
                  key={discount.id}
                  type="button"
                  className={selected ? "is-selected" : ""}
                  aria-pressed={selected}
                  onClick={() => onSelectSaved(discount)}
                >
                  <span>{discount.name}</span>
                  <strong>{discountValue(discount)}</strong>
                  <small>{selected ? "Aplicado" : discount.type === "percent" ? "Porcentaje" : "Monto fijo"}</small>
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
            <button type="button" className={manualType === "fixed" ? "is-selected" : ""} aria-pressed={manualType === "fixed"} disabled={!manualAllowed} onClick={() => { setManualType("fixed"); setError(""); }}>Monto fijo</button>
            <button type="button" className={manualType === "percent" ? "is-selected" : ""} aria-pressed={manualType === "percent"} disabled={!manualAllowed} onClick={() => { setManualType("percent"); setError(""); }}>Porcentaje</button>
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
                disabled={!manualAllowed}
                value={manualValue}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "seller-manual-discount-error" : undefined}
                onChange={(event) => { setManualValue(event.target.value); setError(""); }}
                placeholder={manualType === "percent" ? "15" : "5000"}
              />
              <span aria-hidden="true">{manualType === "percent" ? "%" : "$"}</span>
            </div>
          </label>
          {error ? <p className="fm-form-error" id="seller-manual-discount-error" role="alert">{error}</p> : null}
          <Button icon="Percent" disabled={!manualAllowed || !manualValid} onClick={applyManual}>Aplicar descuento</Button>
        </section>
      </div>
    </Modal>
  );
}
