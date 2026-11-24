import { Button, FormField, Select } from "../../design-system";
import { DELIVERY_ZONES } from "../../shared/ecommerceDelivery.mjs";

export function editDeliverySettings(delivery = {}) {
  return {
    ...delivery,
    enabled: delivery.enabled === true,
    rates: (delivery.rates || []).map((rate) => ({
      ...rate,
      postalText: (rate.postalCodes || []).join(", "),
      areaText: (rate.areas || []).join(", "),
    })),
    andreani: {
      enabled: delivery.andreani?.enabled === true,
      arcaVatRate: delivery.andreani?.arcaVatRate ?? "",
    },
  };
}

const list = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
const optionalNumber = (value) => value === "" || value == null ? null : Number(value);

export function deliverySettingsPayload(delivery) {
  return {
    enabled: delivery.enabled,
    rates: delivery.rates.map(({ postalText, areaText, ...rate }) => ({
      ...rate,
      postalCodes: list(postalText),
      areas: list(areaText),
      amount: optionalNumber(rate.amount),
      arcaVatRate: optionalNumber(rate.arcaVatRate),
    })),
    andreani: { ...delivery.andreani, arcaVatRate: optionalNumber(delivery.andreani.arcaVatRate) },
  };
}

function VatSelect({ value, onChange }) {
  return (
    <Select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      <option value="">Seleccioná IVA</option>
      {[0, 10.5, 21, 27].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
    </Select>
  );
}

export default function EcommerceDeliverySettings({ delivery, onChange }) {
  const rates = delivery.rates;
  function changeRate(index, key, value) {
    onChange({ ...delivery, rates: rates.map((rate, position) => position === index ? { ...rate, [key]: value } : rate) });
  }
  function addRate() {
    const zone = Object.keys(DELIVERY_ZONES).find((value) => !rates.some((rate) => rate.zone === value)) || "";
    onChange({
      ...delivery,
      rates: [...rates, {
        id: "rate_" + crypto.randomUUID(), zone, province: "", active: true,
        amount: "", arcaVatRate: "", postalText: "", areaText: "",
      }],
    });
  }
  const changeAndreani = (settings) => onChange({ ...delivery, andreani: { ...delivery.andreani, ...settings } });

  return (
    <div className="fm-ecommerce-product-config-list">
      <label>
        <input type="checkbox" checked={delivery.enabled} onChange={(event) => onChange({ ...delivery, enabled: event.target.checked })} />
        {" "}Habilitar envío a domicilio
      </label>
      <h3>Tarifas de entrega en el AMBA</h3>
      {rates.map((rate, index) => (
        <fieldset key={rate.id} className="fm-form-grid">
          <legend>{DELIVERY_ZONES[rate.zone] || rate.name || rate.province || "Tarifa por código postal"}</legend>
          <FormField label="Zona">
            <Select value={rate.zone || ""} onChange={(event) => changeRate(index, "zone", event.target.value)}>
              <option value="">Por código postal</option>
              {Object.entries(DELIVERY_ZONES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </Select>
          </FormField>
          {!rate.zone && <FormField label="Provincia">
            <input value={rate.province || ""} onChange={(event) => changeRate(index, "province", event.target.value)} />
          </FormField>}
          {rate.zone && rate.zone !== "caba" && <FormField label="Localidades o partidos">
            <input value={rate.areaText} onChange={(event) => changeRate(index, "areaText", event.target.value)} placeholder="Separados por coma" />
          </FormField>}
          {rate.zone !== "caba" && <FormField label="Códigos postales" hint="Separados por coma. Un código postal tiene prioridad sobre un partido.">
            <input value={rate.postalText} onChange={(event) => changeRate(index, "postalText", event.target.value)} />
          </FormField>}
          <FormField label="Importe (ARS)">
            <input type="number" min="0" step="1" value={rate.amount} onChange={(event) => changeRate(index, "amount", event.target.value)} />
          </FormField>
          <FormField label="IVA de envío">
            <VatSelect value={rate.arcaVatRate} onChange={(value) => changeRate(index, "arcaVatRate", value)} />
          </FormField>
          <label>
            <input type="checkbox" checked={rate.active !== false} onChange={(event) => changeRate(index, "active", event.target.checked)} />
            {" "}Tarifa habilitada
          </label>
          <Button variant="secondary" onClick={() => onChange({ ...delivery, rates: rates.filter((_, position) => position !== index) })}>Quitar tarifa</Button>
        </fieldset>
      ))}
      <div><Button variant="secondary" onClick={addRate}>Agregar zona</Button></div>
      <fieldset>
        <legend>Envíos fuera del AMBA</legend>
        <label>
          <input type="checkbox" checked={delivery.andreani.enabled} onChange={(event) => changeAndreani({ enabled: event.target.checked })} />
          {" "}Cotizar con Andreani
        </label>
        {delivery.andreani.enabled && <FormField label="IVA de envío por Andreani">
          <VatSelect value={delivery.andreani.arcaVatRate} onChange={(value) => changeAndreani({ arcaVatRate: value })} />
        </FormField>}
      </fieldset>
    </div>
  );
}
