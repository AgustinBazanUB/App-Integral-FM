import { Button, Panel } from "../../design-system";
import { useLocation } from "../../router";
import { useOliviaVisibility } from "./ScreenContext";
export default function OliviaReviewPanel() {
  const { review, setReview } = useOliviaVisibility(), { pathname } = useLocation();
  if (!review || review.path?.split("?")[0] !== pathname) return null;
  return <Panel title="Revisión preparada por Olivia"><p>{review.draft?.reason || review.draft?.name || "Revisá la configuración y completá la operación desde su formulario seguro."}</p>{review.entityId ? <p>Registro a revisar: <strong>{review.entityId}</strong></p> : null}<p>La operación se completa únicamente con los controles de este módulo. La preparación de Olivia conserva las validaciones del flujo manual.</p><Button variant="secondary" onClick={() => setReview(null)}>Cerrar resumen</Button></Panel>;
}
