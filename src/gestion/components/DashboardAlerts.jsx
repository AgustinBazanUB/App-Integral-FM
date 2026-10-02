import { useCallback, useId, useRef, useState } from "react";
import { Badge, Button, EmptyState, Panel, Skeleton } from "../../design-system";
import { alertContextPath, alertPresentation, groupActiveAlerts } from "../../modules/alerts/domain/alerts.js";
import { Link } from "../../router";
import { can } from "../permissions";
import AnchoredPopover from "./AnchoredPopover";
import { Icon } from "./icons";

function AlertGroups({ alerts, profile, allowedLocationIds, onNavigate }) {
  return <div className="fm-dashboard-alert-groups">
    {groupActiveAlerts(alerts).filter((group) => group.alerts.length).map((group) => (
      <section key={group.key} className={`fm-dashboard-alert-group fm-dashboard-alert-group--${group.key}`} aria-label={group.label}>
        <h3><span className="fm-dashboard-alert-dot" aria-hidden="true" />{group.label}<span>{group.alerts.length}</span></h3>
        <ul className="fm-dashboard-alerts">
          {group.alerts.map((alert) => {
            const presentation = alertPresentation(alert);
            return <li key={alert.id}>
              <Link onClick={onNavigate} to={alertContextPath(alert, allowedLocationIds, can(profile, "locations", "view"), can(profile, "locations", "viewStock"))}>
                <Badge tone={presentation.tone}>{presentation.label}</Badge>
                <span><strong>{alert.name || alert.title || "Alerta del negocio"}</strong><small>{alert.notes || alert.description || alert.locationName || "Revisá el registro en Alertas."}</small></span>
                <span className="sr-only">Abrir contexto de la alerta</span>
              </Link>
            </li>;
          })}
        </ul>
      </section>
    ))}
  </div>;
}

function AlertContent({ result, profile, allowedLocationIds, limit, onNavigate }) {
  const alerts = result.data || [];
  return <>
    {result.status === "loading" ? <div role="status"><span className="sr-only">Cargando alertas</span><Skeleton lines={3} /></div> : null}
    {result.status === "error" ? <EmptyState icon="WifiOff" title="No pudimos consultar las alertas" description="Reintentá cuando tengas conexión o revisá tus permisos."
      action={<Button variant="secondary" onClick={() => result.refresh().catch(() => {})}>Reintentar alertas</Button>} /> : null}
    {result.status === "ready" && !alerts.length ? <EmptyState icon="Bell" title="Sin alertas activas" description="Las alertas registradas en el módulo aparecerán aquí según su prioridad." /> : null}
    {result.status === "ready" && alerts.length ? <AlertGroups alerts={limit ? alerts.slice(0, limit) : alerts} profile={profile} allowedLocationIds={allowedLocationIds} onNavigate={onNavigate} /> : null}
    {result.status === "ready" && limit && alerts.length > limit ? <p>Mostrando las {limit} de mayor prioridad de {alerts.length} alertas activas.</p> : null}
  </>;
}

export function DashboardAlertsBell({ profile, allowedLocationIds, result }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const contentId = useId();
  const close = useCallback(() => setOpen(false), []);
  if (!can(profile, "alerts", "view")) return null;
  const alerts = result.status === "ready" ? result.data || [] : [];
  const count = alerts.length;
  const priority = count ? groupActiveAlerts(alerts).find((group) => group.alerts.length).key : "none";
  const label = result.status === "loading" ? "Cargando alertas" : result.status === "error" ? "Alertas: no pudimos consultarlas" : `Alertas activas: ${count}`;
  return <>
    <button ref={triggerRef} type="button" className={`fm-dashboard-alert-bell fm-dashboard-alert-bell--${priority}`}
      aria-label={label} title={label} aria-expanded={open} aria-controls={contentId} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
      <Icon name="Bell" />
      {count ? <span className="fm-dashboard-alert-bell__count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
      {result.status === "error" ? <span className="fm-dashboard-alert-bell__count" aria-hidden="true">!</span> : null}
    </button>
    <AnchoredPopover open={open} onClose={close} triggerRef={triggerRef} ariaLabel="Alertas activas" className="fm-dashboard-alert-popover">
      <div id={contentId} className="fm-dashboard-alert-dropdown">
        <header><div><strong>Alertas activas</strong><small>Pendientes actuales del negocio</small></div>
          <button type="button" className="fm-icon-button" aria-label="Cerrar alertas" onClick={close}><Icon name="X" /></button>
        </header>
        <div className="fm-dashboard-alert-dropdown__body"><AlertContent result={result} profile={profile} allowedLocationIds={allowedLocationIds} onNavigate={close} /></div>
        <footer><Link className="fm-button fm-button--secondary" to="/gestion/alerts" onClick={close}>Ver todas las alertas</Link></footer>
      </div>
    </AnchoredPopover>
  </>;
}

export default function DashboardAlerts({ profile, allowedLocationIds, result }) {
  if (!can(profile, "alerts", "view")) return null;
  return <Panel title="Alertas activas" description="Pendientes actuales de tus ubicaciones y del negocio. No dependen del período de ventas seleccionado."
    action={<Link className="fm-button fm-button--secondary" to="/gestion/alerts">Ver todas las alertas</Link>}>
    <AlertContent result={result} profile={profile} allowedLocationIds={allowedLocationIds} limit={6} />
  </Panel>;
}
