import { locationActivity } from "../../modules/locations/domain/locations";
import { argentinaDateKey, argentinaMonthKey, argentinaParts } from "../../modules/locations/domain/time";
import { Icon } from "./icons";

const paymentOptions = [
  ["cash", "Efectivo"],
  ["debit", "Débito"],
  ["credit", "Crédito"],
  ["alias", "Alias / transferencia"],
];

const toggle = (values, value) => values.includes(value)
  ? values.filter((item) => item !== value)
  : [...values, value];

function Choice({ checked, label, onChange, count }) {
  return (
    <label className="fm-metrics-choice">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
      {count != null ? <small>{count}</small> : null}
    </label>
  );
}

function MultiSection({ title, icon, allLabel, values, options, onChange, children }) {
  return (
    <details className="fm-metrics-filter-group">
      <summary><Icon name={icon} /><span>{title}</span><small>{values.length ? `${values.length} seleccionados` : allLabel}</small><Icon name="ChevronDown" /></summary>
      <div className="fm-metrics-filter-group__body">
        <Choice checked={!values.length} label={allLabel} onChange={() => onChange([])} />
        {options?.map((option) => (
          <Choice
            key={option.id}
            checked={values.includes(option.id)}
            label={option.label}
            count={option.count}
            onChange={() => onChange(toggle(values, option.id))}
          />
        ))}
        {children}
      </div>
    </details>
  );
}

export default function MetricsFiltersPanel({
  state,
  onChange,
  locations,
  sellers,
  categories,
  products,
  discounts,
  busy,
}) {
  const today = argentinaDateKey();
  const currentMonth = argentinaMonthKey();
  const currentYear = argentinaParts().year;
  const activeLocations = locations.filter((location) => locationActivity(location).active);
  const inactiveLocations = locations.filter((location) => !locationActivity(location).active);
  const set = (key, value) => onChange({ ...state, [key]: value });

  return (
    <div className="fm-metrics-filters" aria-busy={busy || undefined}>
      <div className="fm-metrics-period">
        <div className="fm-metrics-period__heading"><Icon name="CalendarRange" /><span><strong>Período</strong><small>America/Argentina/Buenos_Aires</small></span></div>
        <div className="fm-metrics-segmented" role="group" aria-label="Tipo de período">
          {[["day", "Día"], ["month", "Mes"], ["year", "Año"], ["custom", "Rango"]].map(([id, label]) => (
            <button key={id} type="button" className={state.periodType === id ? "is-active" : ""} aria-pressed={state.periodType === id} onClick={() => set("periodType", id)}>{label}</button>
          ))}
        </div>
        <div className="fm-metrics-period__inputs">
          {state.periodType === "day" ? <label><span>Fecha</span><input type="date" max={today} value={state.day} onChange={(event) => set("day", event.target.value)} /></label> : null}
          {state.periodType === "month" ? <label><span>Mes</span><input type="month" max={currentMonth} value={state.month} onChange={(event) => set("month", event.target.value)} /></label> : null}
          {state.periodType === "year" ? <label><span>Año</span><input type="number" min="2020" max={currentYear} value={state.year} onChange={(event) => set("year", event.target.value)} /></label> : null}
          {state.periodType === "custom" ? <>
            <label><span>Desde</span><input type="date" max={state.to || today} value={state.from} onChange={(event) => set("from", event.target.value)} /></label>
            <label><span>Hasta</span><input type="date" min={state.from} max={today} value={state.to} onChange={(event) => set("to", event.target.value)} /></label>
          </> : null}
        </div>
      </div>

      <div className="fm-metrics-filter-grid">
        <MultiSection title="Ubicaciones" icon="MapPin" allLabel="Todas las ubicaciones" values={state.locationIds} onChange={(value) => set("locationIds", value)}>
          <p className="fm-metrics-group-label">Activa</p>
          {activeLocations.map((location) => <Choice key={location.id} checked={state.locationIds.includes(location.id)} label={location.name} onChange={() => set("locationIds", toggle(state.locationIds, location.id))} />)}
          <p className="fm-metrics-group-label">Inactiva</p>
          {inactiveLocations.length ? inactiveLocations.map((location) => <Choice key={location.id} checked={state.locationIds.includes(location.id)} label={location.name} onChange={() => set("locationIds", toggle(state.locationIds, location.id))} />) : <span className="fm-metrics-filter-empty">Sin ubicaciones inactivas</span>}
        </MultiSection>

        <MultiSection
          title="Vendedores"
          icon="UsersRound"
          allLabel="Todos los vendedores"
          values={state.sellerIds}
          onChange={(value) => set("sellerIds", value)}
          options={sellers.map((seller) => ({ id: seller.id, label: seller.name }))}
        />

        <MultiSection title="Productos" icon="Boxes" allLabel="Todos los productos" values={[...state.categoryIds, ...state.productIds]} onChange={() => onChange({ ...state, categoryIds: [], productIds: [] })}>
          {categories.map((category) => {
            const categoryProducts = products.filter((product) => product.categoryId === category.id);
            if (!categoryProducts.length) return null;
            return (
              <details key={category.id} className="fm-metrics-product-group">
                <summary><span>{category.name}</span><small>{categoryProducts.length}</small><Icon name="ChevronDown" /></summary>
                <div>
                  <Choice checked={state.categoryIds.includes(category.id)} label={`Todos · ${category.name}`} onChange={() => set("categoryIds", toggle(state.categoryIds, category.id))} />
                  {categoryProducts.map((product) => <Choice key={product.id} checked={state.productIds.includes(product.id)} label={product.name} onChange={() => set("productIds", toggle(state.productIds, product.id))} />)}
                </div>
              </details>
            );
          })}
        </MultiSection>

        <MultiSection title="Descuentos" icon="Percent" allLabel="Todos los descuentos" values={state.discountIds} onChange={(value) => set("discountIds", value)}>
          <Choice checked={state.discountIds.includes("__none")} label="Sin descuento" onChange={() => set("discountIds", toggle(state.discountIds, "__none"))} />
          {discounts.map((discount) => <Choice key={discount.id} checked={state.discountIds.includes(discount.id)} label={discount.name || "Descuento"} onChange={() => set("discountIds", toggle(state.discountIds, discount.id))} />)}
        </MultiSection>

        <MultiSection
          title="Formas de pago"
          icon="CircleDollarSign"
          allLabel="Todas las formas de pago"
          values={state.paymentMethods}
          onChange={(value) => set("paymentMethods", value)}
          options={paymentOptions.map(([id, label]) => ({ id, label }))}
        />
      </div>
    </div>
  );
}
