import { useEffect, useRef, useState } from "react";
import DeliveryAddressPicker from "./DeliveryAddressPicker";
import { requestEcommerceDelivery } from "../services/ecommerceService";
import { ARGENTINA_PROVINCES, argentinaProvinceCode, argentinePostalCode } from "../shared/ecommerceDelivery.mjs";

function addressValues(address) {
  const provinceCode = argentinaProvinceCode(address?.province);
  return {
    street: [address?.street, address?.number].filter(Boolean).join(" ").slice(0, 100),
    city: provinceCode === "C" ? "CABA" : address?.city?.slice(0, 50) || "",
    provinceCode,
    postalCode: argentinePostalCode(address?.postalCode),
  };
}

export default function PaywayBillingAddress({ suggestedAddress, allowLookup }) {
  const [mode, setMode] = useState("");
  const [address, setAddress] = useState(null);
  const [manualAddress, setManualAddress] = useState(null);
  const [search, setSearch] = useState({ value: "", selection: null });
  const [lookup, setLookup] = useState({});
  const pending = useRef(null);
  const suggestion = addressValues(suggestedAddress);
  const suggested = Object.values(suggestion).every(Boolean);
  const defaultMode = suggested ? "suggested" : allowLookup ? "search" : "manual";
  const currentMode = mode && (mode !== "suggested" || suggested) ? mode : defaultMode;
  const confirmed = currentMode === "suggested" ? suggestion : address;

  useEffect(() => () => pending.current?.abort(), []);

  function changeInput(value) {
    pending.current?.abort();
    setSearch({ value, selection: null });
    setLookup({});
    setMode("search");
  }

  async function select(option) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSearch({ value: option.label, selection: option });
    setLookup({ loading: true });
    try {
      const result = await requestEcommerceDelivery({
        mode: "address", selectionToken: option.selectionToken,
      }, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const next = addressValues(result.address);
      if (Object.values(next).every(Boolean)) {
        setAddress(next);
        setMode("confirmed");
      } else {
        setManualAddress(next);
        setMode("manual");
      }
      setLookup({});
    } catch (error) {
      if (!controller.signal.aborted) setLookup({ error: error.message });
    }
  }

  function changeMode(next) {
    pending.current?.abort();
    setLookup({});
    if (next === "search") setSearch({ value: "", selection: null });
    setMode(next);
  }

  if (currentMode === "search") {
    return <div className="payway-billing-address">
      <DeliveryAddressPicker label="Calle y altura de facturación"
        value={search.value} selection={search.selection} onInput={changeInput} onSelect={select} error={lookup.error} />
      {lookup.loading && <p role="status">Confirmando domicilio…</p>}
      <button type="button" className="delivery-retry" onClick={() => changeMode("manual")}>Ingresar domicilio manualmente</button>
      {suggested && <button type="button" className="delivery-retry" onClick={() => changeMode("suggested")}>Usar domicilio sugerido</button>}
    </div>;
  }

  if (currentMode !== "manual" && confirmed) {
    const province = ARGENTINA_PROVINCES.find(([code]) => code === confirmed.provinceCode)?.[1];
    const area = [...new Set([confirmed.city, province].filter(Boolean))].join(", ");
    return <div className="payway-billing-address">
      <p><strong>Domicilio de facturación</strong></p>
      <p>{confirmed.street} · {area} · {confirmed.postalCode}</p>
      {Object.entries(confirmed).map(([key, value]) => <input key={key} type="hidden" name={"payer_" + key} value={value} />)}
      <button type="button" className="delivery-retry" onClick={() => {
        setManualAddress(confirmed);
        changeMode(allowLookup ? "search" : "manual");
      }}>Cambiar domicilio de facturación</button>
    </div>;
  }

  const draftAddress = manualAddress || suggestion;
  return <div className="payway-billing-address">
    <div className="form-grid">
      <label className="field-label field-label--full">Calle y altura de facturación
        <input name="payer_street" required maxLength={100} defaultValue={draftAddress.street} />
      </label>
      <label className="field-label">Localidad de facturación
        <input name="payer_city" required maxLength={50} defaultValue={draftAddress.city} />
      </label>
      <label className="field-label">Provincia de facturación
        <select name="payer_provinceCode" required defaultValue={draftAddress.provinceCode}>
          <option value="">Seleccionar provincia</option>
          {ARGENTINA_PROVINCES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
      <label className="field-label">Código postal de facturación
        <input name="payer_postalCode" required maxLength={10} defaultValue={draftAddress.postalCode} />
      </label>
    </div>
    {allowLookup && <button type="button" className="delivery-retry" onClick={() => changeMode("search")}>Buscar domicilio</button>}
    {suggested && <button type="button" className="delivery-retry" onClick={() => changeMode("suggested")}>Usar domicilio sugerido</button>}
  </div>;
}
