import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { locationActivity } from "../../modules/locations/domain/locations";
import { SINGLE_PAYMENT_METHODS } from "../../modules/locations/domain/payments";
import { argentinaDateKey, argentinaMonthKey, argentinaParts } from "../../modules/locations/domain/time";
import { Icon } from "./icons";

const paymentLabels = {
  cash: "Efectivo",
  debit: "Débito",
  credit: "Crédito",
  alias: "Alias / transferencia",
};
const paymentOptions = SINGLE_PAYMENT_METHODS.map((id) => [id, paymentLabels[id] || id]);

const filterKeys = {
  locations: ["locationIds"],
  sellers: ["sellerIds"],
  products: ["categoryIds", "productIds"],
  discounts: ["discountIds"],
  payments: ["paymentMethods"],
};

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

function MultiSection({
  id,
  title,
  icon,
  allLabel,
  values,
  open,
  disabled,
  triggerRef,
  layerRef,
  layerStyle,
  onToggle,
  onApply,
  onCancel,
  children,
}) {
  const bodyId = `fm-metrics-filter-${id}`;
  const selectionLabel = values.length
    ? `${values.length} seleccionado${values.length === 1 ? "" : "s"}`
    : allLabel;
  const layer = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={layerRef}
      id={bodyId}
      className="fm-metrics-filter-group__body fm-metrics-filter-layer"
      role="dialog"
      aria-label={`Filtro ${title}`}
      data-metrics-filter-body={id}
      style={layerStyle || undefined}
    >
      <header className="fm-metrics-filter-layer__header">
        <span><Icon name={icon} /><strong>{title}</strong></span>
        <button type="button" aria-label={`Cerrar filtro ${title}`} onClick={onCancel}><Icon name="X" /></button>
      </header>
      <div className="fm-metrics-filter-group__options">
        {children}
      </div>
      <div className="fm-metrics-filter-group__actions">
        <button type="button" className="fm-button fm-button--text" onClick={onCancel}>Cancelar</button>
        <button type="button" className="fm-button fm-button--primary" onClick={onApply}>Aplicar</button>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`fm-metrics-filter-group ${open ? "is-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="fm-metrics-filter-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        disabled={disabled}
        onClick={onToggle}
      >
        <Icon name={icon} />
        <span>{title}</span>
        <small title={selectionLabel}>{selectionLabel}</small>
        <Icon name="ChevronDown" />
      </button>
      {layer}
    </div>
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
  const [openFilter, setOpenFilter] = useState(null);
  const [draft, setDraft] = useState(state);
  const [layerStyle, setLayerStyle] = useState(null);
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  const triggerRefs = useRef({});

  const restoreTriggerFocus = useCallback((filterId) => {
    if (!filterId) return;
    window.requestAnimationFrame(() => triggerRefs.current[filterId]?.focus?.());
  }, []);

  const closeFilter = useCallback((restoreFocus = true) => {
    const current = openFilter;
    setOpenFilter(null);
    setLayerStyle(null);
    if (restoreFocus) restoreTriggerFocus(current);
  }, [openFilter, restoreTriggerFocus]);

  const updateLayerPosition = useCallback(() => {
    if (!openFilter || typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 768px)").matches) {
      setLayerStyle(null);
      return;
    }
    const trigger = triggerRefs.current[openFilter];
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(360, Math.max(280, window.innerWidth - margin * 2));
    const left = Math.min(
      Math.max(margin, rect.left),
      Math.max(margin, window.innerWidth - width - margin),
    );
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
    const spaceAbove = Math.max(0, rect.top - gap - margin);
    const placeAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(180, Math.min(430, placeAbove ? spaceAbove : spaceBelow));
    const next = {
      width: `${Math.round(width)}px`,
      left: `${Math.round(left)}px`,
      maxHeight: `${Math.round(availableHeight)}px`,
    };
    if (placeAbove) {
      next.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
    } else {
      next.top = `${Math.round(rect.bottom + gap)}px`;
    }
    setLayerStyle(next);
  }, [openFilter]);

  useLayoutEffect(() => {
    if (!openFilter) return undefined;
    updateLayerPosition();
    window.addEventListener("resize", updateLayerPosition);
    window.addEventListener("scroll", updateLayerPosition, true);
    return () => {
      window.removeEventListener("resize", updateLayerPosition);
      window.removeEventListener("scroll", updateLayerPosition, true);
    };
  }, [openFilter, updateLayerPosition]);

  useEffect(() => {
    if (!openFilter) return undefined;
    const frame = window.requestAnimationFrame(() => {
      layerRef.current?.querySelector("input, button, summary, [tabindex]:not([tabindex='-1'])")?.focus?.();
    });
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target) || layerRef.current?.contains(event.target)) return;
      closeFilter(true);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFilter(true);
        return;
      }
      if (event.key !== "Tab" || !layerRef.current?.contains(document.activeElement)) return;
      const focusable = [...layerRef.current.querySelectorAll(
        "button:not(:disabled), input:not(:disabled), summary, [href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilter, closeFilter]);

  const openOrToggleFilter = (filterId) => {
    if (openFilter === filterId) {
      closeFilter(false);
      return;
    }
    setDraft({
      ...state,
      locationIds: [...state.locationIds],
      sellerIds: [...state.sellerIds],
      categoryIds: [...state.categoryIds],
      productIds: [...state.productIds],
      discountIds: [...state.discountIds],
      paymentMethods: [...state.paymentMethods],
    });
    setOpenFilter(filterId);
  };

  const applyFilter = (filterId) => {
    const keys = filterKeys[filterId] || [];
    const next = { ...state };
    keys.forEach((key) => { next[key] = [...draft[key]]; });
    onChange(next);
    closeFilter(true);
  };

  const cancelFilter = () => {
    setDraft(state);
    closeFilter(true);
  };

  const setImmediate = (key, value) => {
    if (openFilter) {
      setOpenFilter(null);
      setLayerStyle(null);
    }
    onChange({ ...state, [key]: value });
  };

  const setDraftField = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const productSelectionCount = state.categoryIds.length + state.productIds.length;
  const commonLayerProps = { layerRef, layerStyle };

  return (
    <div ref={rootRef} className="fm-metrics-filters" aria-busy={busy || undefined}>
      <div className="fm-metrics-period">
        <div className="fm-metrics-period__heading"><Icon name="CalendarRange" /><span><strong>Período</strong><small>America/Argentina/Buenos_Aires</small></span></div>
        <div className="fm-metrics-segmented" role="group" aria-label="Tipo de período">
          {[["day", "Día"], ["month", "Mes"], ["year", "Año"], ["custom", "Rango"]].map(([id, label]) => (
            <button key={id} type="button" className={state.periodType === id ? "is-active" : ""} aria-pressed={state.periodType === id} onClick={() => setImmediate("periodType", id)}>{label}</button>
          ))}
        </div>
        <div className="fm-metrics-period__inputs">
          {state.periodType === "day" ? <label><span>Fecha</span><input type="date" max={today} value={state.day} onChange={(event) => setImmediate("day", event.target.value)} /></label> : null}
          {state.periodType === "month" ? <label><span>Mes</span><input type="month" max={currentMonth} value={state.month} onChange={(event) => setImmediate("month", event.target.value)} /></label> : null}
          {state.periodType === "year" ? <label><span>Año</span><input type="number" min="2020" max={currentYear} value={state.year} onChange={(event) => setImmediate("year", event.target.value)} /></label> : null}
          {state.periodType === "custom" ? <>
            <label><span>Desde</span><input type="date" max={state.to || today} value={state.from} onChange={(event) => setImmediate("from", event.target.value)} /></label>
            <label><span>Hasta</span><input type="date" min={state.from} max={today} value={state.to} onChange={(event) => setImmediate("to", event.target.value)} /></label>
          </> : null}
        </div>
      </div>

      <div className="fm-metrics-filter-grid">
        <MultiSection
          {...commonLayerProps}
          id="locations"
          title="Ubicaciones"
          icon="MapPin"
          allLabel="Todas las ubicaciones"
          values={state.locationIds}
          open={openFilter === "locations"}
          disabled={busy}
          triggerRef={(node) => { triggerRefs.current.locations = node; }}
          onToggle={() => openOrToggleFilter("locations")}
          onApply={() => applyFilter("locations")}
          onCancel={cancelFilter}
        >
          <Choice checked={!draft.locationIds.length} label="Todas las ubicaciones" onChange={() => setDraftField("locationIds", [])} />
          <p className="fm-metrics-group-label">Activa</p>
          {activeLocations.map((location) => <Choice key={location.id} checked={draft.locationIds.includes(location.id)} label={location.name} onChange={() => setDraftField("locationIds", toggle(draft.locationIds, location.id))} />)}
          <p className="fm-metrics-group-label">Inactiva</p>
          {inactiveLocations.length ? inactiveLocations.map((location) => <Choice key={location.id} checked={draft.locationIds.includes(location.id)} label={location.name} onChange={() => setDraftField("locationIds", toggle(draft.locationIds, location.id))} />) : <span className="fm-metrics-filter-empty">Sin ubicaciones inactivas</span>}
        </MultiSection>

        <MultiSection
          {...commonLayerProps}
          id="sellers"
          title="Vendedores"
          icon="UsersRound"
          allLabel="Todos los vendedores"
          values={state.sellerIds}
          open={openFilter === "sellers"}
          disabled={busy}
          triggerRef={(node) => { triggerRefs.current.sellers = node; }}
          onToggle={() => openOrToggleFilter("sellers")}
          onApply={() => applyFilter("sellers")}
          onCancel={cancelFilter}
        >
          <Choice checked={!draft.sellerIds.length} label="Todos los vendedores" onChange={() => setDraftField("sellerIds", [])} />
          {sellers.map((seller) => <Choice key={seller.id} checked={draft.sellerIds.includes(seller.id)} label={seller.name} onChange={() => setDraftField("sellerIds", toggle(draft.sellerIds, seller.id))} />)}
        </MultiSection>

        <MultiSection
          {...commonLayerProps}
          id="products"
          title="Productos"
          icon="Boxes"
          allLabel="Todos los productos"
          values={Array.from({ length: productSelectionCount })}
          open={openFilter === "products"}
          disabled={busy}
          triggerRef={(node) => { triggerRefs.current.products = node; }}
          onToggle={() => openOrToggleFilter("products")}
          onApply={() => applyFilter("products")}
          onCancel={cancelFilter}
        >
          <Choice checked={!draft.categoryIds.length && !draft.productIds.length} label="Todos los productos" onChange={() => setDraft((current) => ({ ...current, categoryIds: [], productIds: [] }))} />
          {categories.map((category) => {
            const categoryProducts = products.filter((product) => product.categoryId === category.id);
            if (!categoryProducts.length) return null;
            return (
              <details key={category.id} className="fm-metrics-product-group">
                <summary><span>{category.name}</span><small>{categoryProducts.length}</small><Icon name="ChevronDown" /></summary>
                <div>
                  <Choice checked={draft.categoryIds.includes(category.id)} label={`Todos · ${category.name}`} onChange={() => setDraftField("categoryIds", toggle(draft.categoryIds, category.id))} />
                  {categoryProducts.map((product) => <Choice key={product.id} checked={draft.productIds.includes(product.id)} label={product.name} onChange={() => setDraftField("productIds", toggle(draft.productIds, product.id))} />)}
                </div>
              </details>
            );
          })}
        </MultiSection>

        <MultiSection
          {...commonLayerProps}
          id="discounts"
          title="Descuentos"
          icon="Percent"
          allLabel="Todos los descuentos"
          values={state.discountIds}
          open={openFilter === "discounts"}
          disabled={busy}
          triggerRef={(node) => { triggerRefs.current.discounts = node; }}
          onToggle={() => openOrToggleFilter("discounts")}
          onApply={() => applyFilter("discounts")}
          onCancel={cancelFilter}
        >
          <Choice checked={!draft.discountIds.length} label="Todos los descuentos" onChange={() => setDraftField("discountIds", [])} />
          <Choice checked={draft.discountIds.includes("__none")} label="Sin descuento" onChange={() => setDraftField("discountIds", toggle(draft.discountIds, "__none"))} />
          {discounts.map((discount) => <Choice key={discount.id} checked={draft.discountIds.includes(discount.id)} label={discount.name || "Descuento"} onChange={() => setDraftField("discountIds", toggle(draft.discountIds, discount.id))} />)}
        </MultiSection>

        <MultiSection
          {...commonLayerProps}
          id="payments"
          title="Forma de pago"
          icon="CircleDollarSign"
          allLabel="Todas las formas de pago"
          values={state.paymentMethods}
          open={openFilter === "payments"}
          disabled={busy}
          triggerRef={(node) => { triggerRefs.current.payments = node; }}
          onToggle={() => openOrToggleFilter("payments")}
          onApply={() => applyFilter("payments")}
          onCancel={cancelFilter}
        >
          <Choice checked={!draft.paymentMethods.length} label="Todas las formas de pago" onChange={() => setDraftField("paymentMethods", [])} />
          {paymentOptions.map(([id, label]) => <Choice key={id} checked={draft.paymentMethods.includes(id)} label={label} onChange={() => setDraftField("paymentMethods", toggle(draft.paymentMethods, id))} />)}
        </MultiSection>
      </div>
    </div>
  );
}