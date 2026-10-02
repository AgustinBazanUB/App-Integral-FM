import { Badge, Button, EmptyState, Panel, Skeleton } from "../../design-system";
import { alertContextPath, alertPresentation } from "../../modules/alerts/domain/alerts.js";
import { Link } from "../../router";
import { can } from "../permissions";
import { useAsyncData } from "../hooks";
import { listActiveAlerts } from "../services/alertsService";

export default function DashboardAlerts({ profile, allowedLocationIds }) {
  const result = useAsyncData(() => listActiveAlerts(profile), [profile]);
  if (!can(profile, "alerts", "view")) return null;
  const alerts = result.data || [];
  return (
    <Panel title="Alertas activas" description="Pendientes actuales de tus ubicaciones y del negocio. No dependen del período de ventas seleccionado."
      action={<Link className="fm-button fm-button--secondary" to="/gestion/alerts">Ver todas las alertas</Link>}>
      {result.status === "loading" ? <div role="status"><span className="sr-only">Cargando alertas</span><Skeleton lines={3} /></div> : null}
      {result.status === "error" ? <EmptyState icon="WifiOff" title="No pudimos consultar las alertas" description="Reintentá cuando tengas conexión o revisá tus permisos."
        action={<Button variant="secondary" onClick={() => result.refresh().catch(() => {})}>Reintentar alertas</Button>} /> : null}
      {result.status === "ready" && !alerts.length ? <EmptyState icon="Bell" title="Sin alertas activas" description="Las alertas registradas en el módulo aparecerán aquí según su prioridad." /> : null}
      {result.status === "ready" && alerts.length ? (
        <ul className="fm-dashboard-alerts">
          {alerts.slice(0, 6).map((alert) => {
            const presentation = alertPresentation(alert);
            return <li key={alert.id}>
              <Link to={alertContextPath(alert, allowedLocationIds, can(profile, "locations", "view"), can(profile, "locations", "viewStock"))}>
                <Badge tone={presentation.tone}>{presentation.label}</Badge>
                <span><strong>{alert.name || alert.title || "Alerta del negocio"}</strong><small>{alert.notes || alert.description || alert.locationName || "Revisá el registro en Alertas."}</small></span>
                <span className="sr-only">Abrir contexto de la alerta</span>
              </Link>
            </li>;
          })}
        </ul>
      ) : null}
      {result.status === "ready" && alerts.length > 6 ? <p>Mostrando las 6 de mayor prioridad de {alerts.length} alertas activas.</p> : null}
    </Panel>
  );
}
