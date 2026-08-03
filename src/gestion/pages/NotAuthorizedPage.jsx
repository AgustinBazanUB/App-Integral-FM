import { Button, EmptyState, Panel } from "../../design-system";
import { Link } from "../../router";

export default function NotAuthorizedPage() {
  return (
    <Panel>
      <EmptyState
        icon="ShieldCheck"
        title="No tenés acceso a esta sección"
        description="El menú sólo muestra módulos autorizados y Firestore aplica la misma restricción sobre los datos."
        action={<Link className="fm-button fm-button--secondary" to="/gestion">Volver al panel</Link>}
      />
    </Panel>
  );
}
