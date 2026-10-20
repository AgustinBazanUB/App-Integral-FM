import { Button, Modal } from "../../design-system";
import { useId, useState } from "react";
import { createPortal } from "react-dom";
export default function LabelPreview({ url, onClose }) {
  const frameId = useId();
  const [error, setError] = useState("");
  if (!url) return null;
  // A preview opened from a Drawer must live beside it: the overlay stack
  // makes older overlays inert, including every descendant of that Drawer.
  return createPortal(<div className="fm-management-body"><Modal open onClose={onClose} title="Vista previa · Etiquetas A4" footer={<><a className="fm-button fm-button--secondary" href={url} download="Flor-Mia-Etiquetas.pdf">Descargar PDF</a><Button onClick={() => { try { const frame = document.getElementById(frameId); frame?.contentWindow?.focus(); frame?.contentWindow?.print(); } catch { setError("Este navegador no permite imprimir la vista integrada. Descargá el PDF y abrilo para imprimir en A4 al 100 %."); } }}>Imprimir etiquetas</Button></>}>
    {error && <p role="status">{error}</p>}
    {url && <iframe id={frameId} title="Etiquetas de envíos" src={url} className="fm-shipping-pdf" />}
  </Modal></div>, document.body);
}
