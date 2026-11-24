import { useEffect, useId, useState } from "react";
import { MapPin } from "lucide-react";
import { parseAddressSearch } from "../shared/ecommerceDelivery.mjs";
import { requestEcommerceDelivery } from "../services/ecommerceService";

export default function DeliveryAddressPicker({ value, selection, onInput, onSelect, error }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [results, setResults] = useState(null);
  const [retry, setRetry] = useState(0);
  const query = value.trim();
  const canSearch = !selection && Boolean(parseAddressSearch(query));

  useEffect(() => {
    if (!canSearch || !open) return;
    const controller = new AbortController();
    setResults({ query, status: "loading", options: [] });
    const timer = setTimeout(async () => {
      try {
        const data = await requestEcommerceDelivery({ mode: "search", query }, { signal: controller.signal });
        if (!controller.signal.aborted) setResults({ query, status: "ready", options: data.options });
      } catch (error) {
        if (!controller.signal.aborted) setResults({ query, status: "error", options: [], message: error.message });
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, open, query, retry]);

  const state = open && canSearch && results?.query === query ? results : null;
  const options = state?.options || [];
  const expanded = Boolean(options.length);
  function select(option) {
    onSelect(option);
    setOpen(false);
    setHighlighted(-1);
  }
  function handleKey(event) {
    if (event.key === "Escape" && open) {
      setOpen(false);
      setHighlighted(-1);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setOpen(true);
      if (!expanded) return;
      event.preventDefault();
      setHighlighted(event.key === "ArrowDown"
        ? Math.min(highlighted + 1, options.length - 1)
        : Math.max(highlighted - 1, 0));
    }
    if (event.key === "Enter" && expanded && options[highlighted]) {
      event.preventDefault();
      select(options[highlighted]);
    }
  }

  return (
    <div className="delivery-address-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label className="field-label">
        Calle y altura
        <input
          name="addressSearch"
          value={value}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded && options[highlighted] ? listId + "-" + highlighted : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          maxLength={150}
          placeholder="Ej.: Mendoza 1571"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onInput(event.target.value);
            setOpen(true);
            setHighlighted(-1);
          }}
          onKeyDown={handleKey}
        />
      </label>
      {expanded && (
        <ul id={listId} role="listbox" aria-label="Direcciones encontradas" className="delivery-address-options">
          {options.map((option, index) => (
            <li key={option.selectionToken} role="presentation">
              <button
                type="button" role="option" id={listId + "-" + index} tabIndex={-1}
                aria-selected={highlighted === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
              >
                <MapPin size={17} aria-hidden="true" />
                <span><strong>{option.label}</strong><small>{option.area}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {state?.status === "loading" && <p className="delivery-hint" role="status">Buscando direcciones…</p>}
      {state?.status === "ready" && !expanded && (
        <p className="delivery-hint" role="status">No encontramos esa dirección. Agregá la localidad o la provincia a la búsqueda.</p>
      )}
      {state?.status === "error" && (
        <p className="field-error" role="alert">{state.message} <button type="button" className="delivery-retry" onClick={() => setRetry((current) => current + 1)}>Volver a buscar</button></p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
