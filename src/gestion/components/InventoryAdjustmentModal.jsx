import { useEffect, useRef, useState } from "react";
import { Button, FormField, Modal, Toast } from "../../design-system";
import { adjustInventoryStock } from "../services/inventoryService";

export default function InventoryAdjustmentModal({ open, type, inventory, product, profile, onClose, onSaved }) {
  const submitRef = useRef(false);
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  useEffect(() => {
    if (!open) return;
    submitRef.current = false;
    setQuantity(product?.currentStock || 0); setReason(""); setRequestId(crypto.randomUUID()); setState({ busy: false, error: "" });
  }, [open, product?.productId]);
  const submit = async (event) => {
    event.preventDefault();
    if (submitRef.current) return;
    submitRef.current = true;
    setState({ busy: true, error: "" });
    try {
      await adjustInventoryStock({ type, inventory, product, quantity, reason, profile, requestId });
      await onSaved?.(); onClose?.();
    } catch (error) { submitRef.current = false; setState({ busy: false, error: error.message }); }
  };
  return <Modal open={open} onClose={() => !state.busy && onClose?.()} title={`Ajustar inventario · ${product?.productName || "Producto"}`} description="Registrá la cantidad física real. El ajuste conserva el historial y deja constancia del cambio y su responsable.">
    <form className="fm-inventory-modal" onSubmit={submit}>
      <dl className="fm-stock-calculation"><div><dt>Stock anterior</dt><dd>{product?.currentStock || 0}</dd></div><div><dt>Diferencia</dt><dd>{Number(quantity) - Number(product?.currentStock || 0)}</dd></div></dl>
      <FormField label="Cantidad física real" required><input disabled={state.busy} type="number" min="0" step="1" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></FormField>
      <FormField label="Motivo u observación" hint="Opcional."><input disabled={state.busy} value={reason} onChange={(event) => setReason(event.target.value)} /></FormField>
      {state.error ? <Toast tone="error">{state.error}</Toast> : null}
      <div className="fm-dialog-actions"><Button variant="secondary" disabled={state.busy} onClick={onClose}>Cancelar</Button><Button type="submit" loading={state.busy}>Confirmar ajuste</Button></div>
    </form>
  </Modal>;
}
