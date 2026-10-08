import { useEffect, useState } from "react";
import { Button, FormField, Modal, Select, Toast } from "../../design-system";
import { catalogMergeRequest } from "../services/catalogOrganizationService";

export default function ProductMergeDialog({ open, onClose, products, onSaved }) {
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [plan, setPlan] = useState(null);
  const [state, setState] = useState({ busy: false, error: "", message: "" });
  useEffect(() => { if (open) { setPlan(null); setState({ busy: false, error: "", message: "" }); } }, [open]);
  async function review() {
    setState({ busy: true, error: "", message: "" }); setPlan(null);
    try { setPlan(await catalogMergeRequest({ action: "preview", sourceId, targetId })); setState({ busy: false, error: "", message: "" }); }
    catch (error) { setState({ busy: false, error: error.message, message: "" }); }
  }
  async function confirm() {
    setState({ busy: true, error: "", message: "" });
    try { const result = await catalogMergeRequest({ action: "merge", sourceId, targetId, expectedFingerprint: plan.fingerprint }); await onSaved(); setPlan(null); setSourceId(""); setTargetId(""); setState({ busy: false, error: "", message: `${result.totalUnits} unidades trasladadas. El duplicado quedó archivado y el historial se conserva.` }); }
    catch (error) { setPlan(null); setState({ busy: false, error: error.message, message: "" }); }
  }
  const active = products.filter(row => row.active !== false && !row.mergedIntoProductId);
  const source = active.find(row => row.id === sourceId);
  return <Modal open={open} title="Unificar producto duplicado" description="El stock pasa al producto de destino en cada ubicación y depósito. El duplicado se archiva y conserva su historial." onClose={() => !state.busy && onClose()} footer={<><Button variant="secondary" disabled={state.busy} onClick={onClose}>Cerrar</Button>{plan ? <Button disabled={state.busy} loading={state.busy} onClick={confirm}>Confirmar unificación</Button> : <Button disabled={state.busy || !sourceId || !targetId} loading={state.busy} onClick={review}>Revisar stock</Button>}</>}>
    <FormField label="Producto duplicado"><Select value={sourceId} disabled={state.busy} onChange={event => { setSourceId(event.target.value); setTargetId(""); setPlan(null); }}><option value="">Elegir producto</option>{active.map(row => <option value={row.id} key={row.id}>{row.name} · {row.abbreviation}</option>)}</Select></FormField>
    <FormField label="Conservar y recibir stock"><Select value={targetId} disabled={state.busy} onChange={event => { setTargetId(event.target.value); setPlan(null); }}><option value="">Elegir destino</option>{active.filter(row => row.id !== sourceId && row.categoryId === source?.categoryId).map(row => <option value={row.id} key={row.id}>{row.name} · {row.abbreviation}</option>)}</Select></FormField>
    {plan ? <><p><strong>{plan.source.name}</strong> → <strong>{plan.target.name}</strong></p><ul>{plan.inventories.map(row => <li key={`${row.type}-${row.id}`}>{row.name}: trasladar {row.quantity} unidades · destino {row.targetBefore} → {row.targetAfter}</li>)}</ul><p>Total a trasladar: <strong>{plan.totalUnits} unidades</strong>.</p></> : null}
    {state.error ? <Toast tone="error">{state.error}</Toast> : null}{state.message ? <Toast tone="success">{state.message}</Toast> : null}
  </Modal>;
}
