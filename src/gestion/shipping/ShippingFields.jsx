import { useEffect, useState } from "react";
import { Button, FormField, Modal, Select } from "../../design-system";
import { TRANSPORTS, cleanShippingDraft } from "../../shared/shippingDomain.mjs";
import { shippingRequest } from "../services/shippingService";
import "./shipping.css";

export function ShippingFields({ value, onChange, administrative = false, people = [] }) {
  const set = (key, next) => onChange({ ...value, [key]: next });
  return <div className="fm-shipping-form">
    {administrative && <>
      <FormField label="Tipo de envío" required><Select value={value.deliveryType || ""} onChange={event => set("deliveryType", event.target.value)}><option value="">Elegí transporte</option>{Object.entries(TRANSPORTS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></FormField>
      <fieldset className="fm-shipping-people"><legend>Personas que preparan *</legend>{people.map(person => <label key={person.id}><input type="checkbox" checked={(value.assignedPreparerIds || []).includes(person.id)} onChange={event => set("assignedPreparerIds", event.target.checked ? [...(value.assignedPreparerIds || []), person.id] : value.assignedPreparerIds.filter(id => id !== person.id))} />{person.name}</label>)}{!people.length && <p>No hay preparadores disponibles. Revisá los usuarios activos.</p>}</fieldset>
    </>}
    <FormField label="Dirección de entrega" required hint="Incluí calle, número, piso/depto, localidad y provincia."><textarea rows={3} maxLength={800} value={value.displayAddress || ""} onChange={event => set("displayAddress", event.target.value)} /></FormField>
    <FormField label="Observaciones"><textarea rows={2} maxLength={1500} value={value.notes || ""} onChange={event => set("notes", event.target.value)} /></FormField>
    <p className="fm-shipping-muted">La zona y el marcador quedan por confirmar hasta su verificación. El nombre y teléfono se toman del diálogo Cliente.</p>
  </div>;
}
export default function ShippingDialog({ open, value, onClose, onConfirm, administrative = false, onRemove }) {
  const [draft, setDraft] = useState(value || {}), [people, setPeople] = useState([]), [error, setError] = useState("");
  useEffect(() => { if (open) { setDraft(value || {}); setError(""); } }, [open]);
  useEffect(() => { if (!open || !administrative) return; let live = true; shippingRequest({ mode: "resources" }).then(rows => live && setPeople(rows)).catch(error => live && setError(error.message)); return () => { live = false; }; }, [open, administrative]);
  const save = () => { try { cleanShippingDraft(draft, administrative); onConfirm(draft); } catch (error) { setError(error.message); } };
  return <Modal open={open} onClose={onClose} title="Datos del envío" description={administrative ? "El stock se descuenta del origen elegido al confirmar la venta." : "La solicitud queda pendiente de aprobación. El stock se descuenta cuando gestión confirma el origen real."} footer={<><Button variant="secondary" onClick={onClose}>Volver</Button>{onRemove && <Button variant="secondary" onClick={onRemove}>Sin envío</Button>}<Button onClick={save}>Guardar envío</Button></>}>
    <ShippingFields value={draft} onChange={setDraft} administrative={administrative} people={people} />
    {error && <p role="alert" className="fm-shipping-error">{error}</p>}
  </Modal>;
}
