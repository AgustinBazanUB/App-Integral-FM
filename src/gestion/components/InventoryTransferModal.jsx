import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, FormField, Modal, Select, Skeleton, Toast } from "../../design-system";
import { INVENTORY_TYPES, reconcileTransferLine, summarizeTransfer } from "../../modules/inventory/domain/inventory";
import { getTransferDestinationInventory, transferStock } from "../services/inventoryService";
import { formatMoney } from "../formatters";
import HelpTooltip from "./HelpTooltip";
function ProductImage({ product }) {
  const source = product.thumbUrl || product.imageUrl;
  return source
    ? <img className="fm-product-thumb" src={source} alt="" loading="lazy" />
    : <span className="fm-product-thumb fm-product-thumb--empty" aria-label="Imagen pendiente">FM</span>;
}
export default function InventoryTransferModal({ open, warehouses, locations, initialOriginId = "", initialOriginType = INVENTORY_TYPES.WAREHOUSE, initialProductId = "", profile, onClose, onSaved }) {
  const submitRef = useRef(false);
  const [originType, setOriginType] = useState(INVENTORY_TYPES.WAREHOUSE);
  const [counts, setCounts] = useState({});
  const [carrierName, setCarrierName] = useState("");
  const [originId, setOriginId] = useState("");
  const [destinationType, setDestinationType] = useState(INVENTORY_TYPES.LOCATION);
  const [destinationId, setDestinationId] = useState("");
  const [originInventory, setOriginInventory] = useState([]);
  const [destinationInventory, setDestinationInventory] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [pricing, setPricing] = useState({});
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [transferId, setTransferId] = useState("");
  const [state, setState] = useState({ busy: false, loadingOrigin: false, loadingDestination: false, error: "" });

  useEffect(() => {
    if (!open) return;
    const nextOrigin = initialOriginId || warehouses.find((item) => item.active !== false)?.id || "";
    setOriginType(initialOriginType);
    setCounts({}); setCarrierName(profile.name || profile.email || ""); submitRef.current = false;
    setOriginId(nextOrigin);
    setDestinationType(INVENTORY_TYPES.LOCATION);
    setDestinationId("");
    setOriginInventory([]);
    setDestinationInventory([]);
    setQuantities(initialProductId ? { [initialProductId]: 1 } : {});
    setPricing({});
    setNote("");
    setConfirming(false);
    setTransferId(crypto.randomUUID());
    setState({ busy: false, loadingOrigin: false, loadingDestination: false, error: "" });
  }, [open, initialOriginId, initialOriginType, initialProductId]);

  useEffect(() => {
    if (!open || !originId) { setOriginInventory([]); setState((current) => ({ ...current, loadingOrigin: false })); return undefined; }
    let active = true;
    setState((current) => ({ ...current, loadingOrigin: true, error: "" }));
    setOriginInventory([]);
    getTransferDestinationInventory({ type: originType, id: originId })
      .then((data) => { if (active) { setOriginInventory(data); setState((current) => ({ ...current, loadingOrigin: false })); } })
      .catch((error) => { if (active) setState((current) => ({ ...current, loadingOrigin: false, error: error.message })); });
    return () => { active = false; };
  }, [open, originId, originType]);

  useEffect(() => {
    if (!open || !destinationId) { setDestinationInventory([]); setState((current) => ({ ...current, loadingDestination: false })); return undefined; }
    let active = true;
    setState((current) => ({ ...current, loadingDestination: true, error: "" }));
    getTransferDestinationInventory({ type: destinationType, id: destinationId })
      .then((data) => { if (active) { setDestinationInventory(data); setState((current) => ({ ...current, loadingDestination: false })); } })
      .catch((error) => { if (active) setState((current) => ({ ...current, loadingDestination: false, error: error.message })); });
    return () => { active = false; };
  }, [open, destinationId, destinationType]);

  const originList = originType === INVENTORY_TYPES.LOCATION ? locations.filter((item) => item.deleted !== true) : warehouses.filter((item) => item.active !== false);
  const origin = originList.find((item) => item.id === originId);
  const destinationList = (destinationType === INVENTORY_TYPES.LOCATION ? locations.filter((item) => item.deleted !== true) : warehouses.filter((item) => item.active !== false)).filter((item) => destinationType !== originType || item.id !== originId);
  const destinationRecord = destinationList.find((item) => item.id === destinationId);
  const destinationIds = useMemo(() => new Set(destinationInventory.map((item) => item.productId || item.id)), [destinationInventory]);
  const lines = useMemo(() => originInventory.map((item) => ({
    ...item,
    quantity: Number(quantities[item.productId] || 0),
    preparedQuantity: counts[item.productId]?.prepared ?? Number(quantities[item.productId] || 0),
    receivedQuantity: counts[item.productId]?.received ?? counts[item.productId]?.prepared ?? Number(quantities[item.productId] || 0),
    destinationUseDefaultPrice: pricing[item.productId]?.useDefaultPrice !== false,
    destinationPriceOverride: pricing[item.productId]?.priceOverride ?? item.defaultPrice ?? 0,
  })).filter((item) => item.quantity > 0), [originInventory, pricing, quantities, counts]);
  const summary = summarizeTransfer(lines);

  const changeDestinationType = (value) => {
    setDestinationType(value);
    setDestinationId("");
    setDestinationInventory([]);
    setConfirming(false);
  };
  const changeQty = (product, value) => {
    const max = Number(product.currentStock || 0);
    const next = Math.min(max, Math.max(0, Number(value || 0)));
    setQuantities((current) => ({ ...current, [product.productId]: next }));
    setCounts((current) => ({ ...current, [product.productId]: {} }));
    setConfirming(false);
  };

  const review = () => {
    try {
      lines.forEach((line) => reconcileTransferLine(line, line.currentStock));
      setState((current) => ({ ...current, error: "" }));
      setConfirming(true);
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    }
  };

  const execute = async () => {
    if (submitRef.current) return;
    submitRef.current = true;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await transferStock({
        origin: { ...origin, type: originType },
        carrierName,
        destination: { type: destinationType, id: destinationId, note },
        lines,
        profile,
        transferId,
      });
      await onSaved?.(result);
      onClose?.();
    } catch (error) {
      submitRef.current = false;
      setConfirming(false);
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  };

  return (
    <Modal open={open} onClose={() => !state.busy && onClose?.()} title="Transferir stock" description="Verificá el conteo físico del origen y lo recibido en destino. Confirmás ambos stocks en una sola operación.">
      <div className="fm-inventory-modal fm-transfer-form">
        <div className="fm-form-grid">
          <FormField label="Tipo de origen" required><Select disabled={state.busy} value={originType} onChange={(event) => { setOriginType(event.target.value); setOriginId(""); setDestinationId(""); setOriginInventory([]); setQuantities({}); setCounts({}); setConfirming(false); }}><option value={INVENTORY_TYPES.WAREHOUSE}>Depósito</option><option value={INVENTORY_TYPES.LOCATION}>Ubicación de venta</option></Select></FormField>
          <FormField label="Origen" required><Select disabled={state.busy} value={originId} onChange={(event) => { setOriginId(event.target.value); setDestinationId(""); setQuantities({}); setCounts({}); setConfirming(false); }}><option value="">Elegir origen</option>{originList.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active === false ? " (inactiva)" : ""}</option>)}</Select></FormField>
          <FormField label="Tipo de destino" required><Select disabled={state.busy} value={destinationType} onChange={(event) => changeDestinationType(event.target.value)}><option value={INVENTORY_TYPES.LOCATION}>Ubicación de venta</option><option value={INVENTORY_TYPES.WAREHOUSE}>Depósito</option></Select></FormField>
          <FormField label="Destino" required><Select disabled={state.busy} value={destinationId} onChange={(event) => { setDestinationId(event.target.value); setConfirming(false); }}><option value="">Elegir destino</option>{destinationList.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active === false ? " (inactiva)" : ""}</option>)}</Select></FormField>
          <FormField label="Responsable del traslado" hint="Nombre de quien mueve físicamente la mercadería, incluso un tercero."><input disabled={state.busy} value={carrierName} onChange={(event) => setCarrierName(event.target.value)} /></FormField>
          <FormField label="Observación" hint="Opcional; permite explicar faltantes o roturas."><input disabled={state.busy} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Reposición feria" /></FormField>
        </div>
        {state.loadingOrigin ? <Skeleton lines={4} /> : null}
        {originId && !state.loadingOrigin && !originInventory.length ? <EmptyState icon="Boxes" title="El origen no tiene productos" description="Primero habilitá productos y stock en el origen." /> : null}
        {originInventory.length ? <div className="fm-transfer-lines">{originInventory.map((product) => {
          const missingAtDestination = Boolean(destinationId) && !destinationIds.has(product.productId);
          const value = quantities[product.productId] || 0;
          const priceSettings = pricing[product.productId] || { useDefaultPrice: true, priceOverride: product.defaultPrice || 0 };
          return <article key={product.productId} className={value ? "is-selected" : ""}>
            <ProductImage product={product} />
            <div className="fm-transfer-line__identity"><strong>{product.productName}</strong><small>Disponible: {product.currentStock}</small>{destinationId && !state.loadingDestination ? (missingAtDestination ? <Badge tone="warning">Todavía no está en el destino</Badge> : <Badge tone="success">Ya está en el destino</Badge>) : null}</div>
            <FormField label={`Cantidad prevista de ${product.productName}`}><input disabled={state.busy} type="number" min="0" max={product.currentStock} step="1" inputMode="numeric" value={value} onChange={(event) => changeQty(product, event.target.value)} /></FormField>
            {Number(value) > 0 ? <div className="fm-form-grid fm-transfer-counts"><FormField label={`Preparadas de ${product.productName}`}><input disabled={state.busy} type="number" min="0" max={value} step="1" value={counts[product.productId]?.prepared ?? value} onChange={(event) => { setCounts((current) => ({ ...current, [product.productId]: { prepared: event.target.value } })); setConfirming(false); }} /></FormField><FormField label={`Recibidas de ${product.productName}`}><input disabled={state.busy} type="number" min="0" max={counts[product.productId]?.prepared ?? value} step="1" value={counts[product.productId]?.received ?? counts[product.productId]?.prepared ?? value} onChange={(event) => { setCounts((current) => ({ ...current, [product.productId]: { ...current[product.productId], received: event.target.value } })); setConfirming(false); }} /></FormField></div> : null}
            {missingAtDestination && destinationType === INVENTORY_TYPES.LOCATION && Number(value) > 0 ? <div className="fm-transfer-line__pricing"><label className="fm-check-row"><input disabled={state.busy} type="checkbox" checked={priceSettings.useDefaultPrice !== false} onChange={(event) => setPricing((current) => ({ ...current, [product.productId]: { ...priceSettings, useDefaultPrice: event.target.checked } }))} /><span>Usar precio predeterminado ({formatMoney(product.defaultPrice || 0)})</span></label>{priceSettings.useDefaultPrice === false ? <FormField label="Precio especial"><input disabled={state.busy} type="number" min="0" step="1" inputMode="numeric" value={priceSettings.priceOverride} onChange={(event) => setPricing((current) => ({ ...current, [product.productId]: { ...priceSettings, priceOverride: event.target.value } }))} /></FormField> : null}</div> : null}
          </article>;
        })}</div> : null}

        {confirming ? <section className="fm-transfer-summary" aria-live="polite"><h3>Revisá antes de confirmar</h3><dl><div><dt>Desde</dt><dd>{origin?.name || "—"}</dd></div><div><dt>Hacia</dt><dd>{destinationRecord?.name || "—"}</dd></div><div><dt>Productos</dt><dd>{summary.productCount}</dd></div><div><dt>Unidades previstas</dt><dd>{summary.totalQuantity}</dd></div></dl><ul>{lines.map((line) => <li key={line.productId}><span>{line.productName}</span><strong>Previstas {line.quantity} · preparadas {line.preparedQuantity} · recibidas {line.receivedQuantity}</strong></li>)}</ul><p>Confirmás personalmente la preparación y recepción. Sólo las unidades recibidas ingresan al destino. Los faltantes de preparación y pérdidas se descuentan del origen y quedan en el historial. Si una parte falla, no se modifica ningún stock.</p></section> : null}
        {state.error ? <Toast tone="error">{state.error}</Toast> : null}
        <div className="fm-dialog-actions">
          <HelpTooltip label="Cierra esta ventana sin mover mercadería."><Button disabled={state.busy} variant="secondary" onClick={onClose}>Cancelar</Button></HelpTooltip>
          {!confirming ? <HelpTooltip label="Muestra un resumen final antes de mover el stock."><Button disabled={!originId || !destinationId || !summary.productCount || state.loadingDestination || state.loadingOrigin || state.busy} onClick={review}>Revisar transferencia</Button></HelpTooltip> : <HelpTooltip label="Mueve todos los productos seleccionados en una sola operación y actualiza origen y destino juntos."><Button loading={state.busy} onClick={execute}>Confirmar transferencia</Button></HelpTooltip>}
        </div>
      </div>
    </Modal>
  );
}
