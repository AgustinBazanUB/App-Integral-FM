from pathlib import Path
import re
import textwrap

ROOT = Path(__file__).resolve().parents[2]


def path(name):
    return ROOT / name


def read(name):
    return path(name).read_text(encoding="utf-8")


def write(name, content):
    target = path(name)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(name, old, new):
    content = read(name)
    if old not in content:
        raise RuntimeError(f"No se encontró bloque esperado en {name}: {old[:90]!r}")
    write(name, content.replace(old, new, 1))


def regex_once(name, pattern, replacement, flags=0):
    content = read(name)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Patrón no encontrado exactamente una vez en {name}: {pattern[:90]!r}; count={count}")
    write(name, updated)


write("src/gestion/components/AnchoredPopover.jsx", r'''
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_GAP = 8;

function focusableInside(node) {
  return node?.querySelector(
    "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
  );
}

export default function AnchoredPopover({
  open,
  onClose,
  triggerRef,
  children,
  className = "",
  role = "dialog",
  ariaLabel,
  align = "end",
}) {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const preferredLeft = align === "start"
        ? triggerRect.left
        : triggerRect.right - popoverRect.width;
      const left = Math.min(
        Math.max(VIEWPORT_GAP, preferredLeft),
        Math.max(VIEWPORT_GAP, viewportWidth - popoverRect.width - VIEWPORT_GAP),
      );
      const below = triggerRect.bottom + 7;
      const above = triggerRect.top - popoverRect.height - 7;
      const top = below + popoverRect.height <= viewportHeight - VIEWPORT_GAP
        ? below
        : Math.max(VIEWPORT_GAP, above);
      setPosition({ top, left, ready: true });
    };
    const frame = window.requestAnimationFrame(update);
    window.addEventListener("resize", update, { passive: true });
    document.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [align, open, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      (focusableInside(popoverRef.current) || popoverRef.current)?.focus?.();
    });
    const onPointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) return;
      if (triggerRef.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (previous && previous !== document.body && document.contains(previous)) previous.focus?.();
        else triggerRef.current?.focus?.();
      });
    };
  }, [open, onClose, triggerRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popoverRef}
      className={`fm-anchored-popover ${className}`.trim()}
      role={role}
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        visibility: position.ready ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
''')

write("src/gestion/routePreload.js", r'''
export const managementPageLoaders = {
  administration: () => import("./pages/AdministrationPage"),
  actividad: () => import("./pages/ActivityPage"),
  audit: () => import("./pages/AuditPage"),
  generic: () => import("./pages/GenericModulePage"),
  "loyal-customers": () => import("./pages/LoyalCustomersPage"),
  locations: () => import("./pages/LocationsPage"),
  locationDetail: () => import("./pages/LocationDetailPage"),
  "quick-sales": () => import("./pages/QuickSalesPage"),
  metrics: () => import("./pages/SalesMetricsPage"),
  settings: () => import("./pages/SettingsPage"),
};

export function preloadManagementRoute(routeId) {
  const loader = managementPageLoaders[routeId] || managementPageLoaders.generic;
  loader?.().catch(() => {});
  if (routeId === "locations") managementPageLoaders.locationDetail().catch(() => {});
}
''')

write("src/gestion/activity/activityPresentation.js", r'''
const definitions = {
  "sale.created": { label: "Venta registrada", icon: "ReceiptText", tone: "gold", group: "Ventas" },
  "sale.updated": { label: "Venta editada", icon: "FileText", tone: "gold", group: "Ventas" },
  "sale.cancelled": { label: "Venta anulada", icon: "RotateCcw", tone: "error", group: "Ventas" },
  "stock.initial": { label: "Stock inicial", icon: "Boxes", tone: "olive", group: "Stock" },
  "stock.initial_adjustment": { label: "Stock inicial ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.add": { label: "Mercadería agregada", icon: "PackagePlus", tone: "olive", group: "Stock" },
  "stock.adjust": { label: "Inventario ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.adjustment": { label: "Inventario ajustado", icon: "SlidersHorizontal", tone: "olive", group: "Stock" },
  "stock.stock_delete": { label: "Stock desactivado", icon: "AlertTriangle", tone: "error", group: "Stock" },
  "stock.updated": { label: "Stock actualizado", icon: "Boxes", tone: "olive", group: "Stock" },
  "location.created": { label: "Ubicación creada", icon: "MapPinned", tone: "info", group: "Ubicaciones" },
  "location.updated": { label: "Ubicación editada", icon: "Settings2", tone: "info", group: "Ubicaciones" },
  "location.paused": { label: "Ubicación pausada", icon: "Pause", tone: "warning", group: "Ubicaciones" },
  "location.activated": { label: "Ubicación activada", icon: "MapPin", tone: "olive", group: "Ubicaciones" },
  "location.deleted": { label: "Ubicación dada de baja", icon: "X", tone: "error", group: "Ubicaciones" },
  "location.restored": { label: "Ubicación restaurada", icon: "RotateCcw", tone: "olive", group: "Ubicaciones" },
  "location.sellersUpdated": { label: "Vendedores actualizados", icon: "UserPlus", tone: "info", group: "Ubicaciones" },
  "location.discountsUpdated": { label: "Descuentos actualizados", icon: "Percent", tone: "gold", group: "Descuentos" },
  "locationProduct.configured": { label: "Producto configurado", icon: "PackageCheck", tone: "olive", group: "Productos" },
  "product.createdFromLocation": { label: "Producto creado desde ubicación", icon: "PackagePlus", tone: "olive", group: "Productos" },
  "product.updatedFromLocation": { label: "Producto maestro actualizado", icon: "PackageCheck", tone: "olive", group: "Productos" },
  "customer.created": { label: "Cliente creado", icon: "UserPlus", tone: "info", group: "Clientes" },
  "customer.updated": { label: "Cliente actualizado", icon: "UserRoundCheck", tone: "info", group: "Clientes" },
};

export const ACTIVITY_DEFINITIONS = Object.freeze(definitions);

const prefixFallbacks = [
  ["sale.", { icon: "ReceiptText", tone: "gold", group: "Ventas" }],
  ["stock.", { icon: "Boxes", tone: "olive", group: "Stock" }],
  ["location.", { icon: "MapPin", tone: "info", group: "Ubicaciones" }],
  ["locationProduct.", { icon: "PackageCheck", tone: "olive", group: "Productos" }],
  ["product.", { icon: "PackageCheck", tone: "olive", group: "Productos" }],
  ["customer.", { icon: "UserRound", tone: "info", group: "Clientes" }],
  ["discount.", { icon: "Percent", tone: "gold", group: "Descuentos" }],
];

function readableUnknown(action) {
  return String(action || "Actividad")
    .replace(/[._-]+/g, " ")
    .replace(/^./, (character) => character.toLocaleUpperCase("es-AR"));
}

export function getActivityPresentation(activityOrAction) {
  const activity = typeof activityOrAction === "string" ? { action: activityOrAction } : (activityOrAction || {});
  const action = activity.action || "system.updated";
  const exact = definitions[action];
  if (exact) return { action, ...exact };
  const fallback = prefixFallbacks.find(([prefix]) => action.startsWith(prefix))?.[1];
  return {
    action,
    label: activity.title || readableUnknown(action),
    icon: fallback?.icon || "Activity",
    tone: activity.status === "cancelled" ? "error" : (fallback?.tone || "neutral"),
    group: fallback?.group || "Otros",
  };
}

export function getActivityTypeGroups(items = []) {
  const map = new Map(Object.entries(definitions));
  for (const item of items || []) {
    if (!item?.action || map.has(item.action)) continue;
    const presentation = getActivityPresentation(item);
    map.set(item.action, presentation);
  }
  const grouped = new Map();
  for (const [action, definition] of map) {
    const group = definition.group || "Otros";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push({ value: action, label: definition.label || readableUnknown(action) });
  }
  return [...grouped.entries()]
    .map(([label, options]) => ({
      label,
      options: options.sort((a, b) => a.label.localeCompare(b.label, "es")),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}
''')

write("src/gestion/components/ConnectionIndicator.jsx", r'''
import { useCallback, useRef, useState } from "react";
import { Button } from "../../design-system";
import { reconnectFirestore } from "../connection";
import { useAuth } from "../AuthContext";
import { useConnectionStatus } from "../hooks";
import AnchoredPopover from "./AnchoredPopover";
import { Icon } from "./icons";

const labels = {
  online: "En línea",
  offline: "Sin conexión",
  reconnecting: "Reconectando",
};

export default function ConnectionIndicator() {
  const { profile } = useAuth();
  const status = useConnectionStatus();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const triggerRef = useRef(null);
  const busy = status === "reconnecting";
  const online = status === "online";
  const close = useCallback(() => setOpen(false), []);

  const reconnect = async () => {
    setMessage("");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage("No se pudo restablecer la conexión.");
      return;
    }
    try {
      const connected = await reconnectFirestore(profile.id);
      setMessage(connected ? "Conexión restablecida." : "No se pudo restablecer la conexión.");
    } catch {
      setMessage("No se pudo restablecer la conexión.");
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`fm-connection-trigger is-${status}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Estado de conexión: ${labels[status]}`}
      >
        <Icon name={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"} />
        <span>{labels[status]}</span>
      </button>
      <AnchoredPopover
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        className="fm-connection-popover"
        role="dialog"
        ariaLabel="Estado de conexión"
      >
        <div className="fm-connection-popover__head">
          <span className={`fm-connection-popover__icon is-${status}`}><Icon name={busy ? "RefreshCw" : online ? "Wifi" : "WifiOff"} /></span>
          <div><small>Estado de conexión</small><strong>{labels[status]}</strong></div>
        </div>
        <p>{online ? "Conexión disponible." : busy ? "Comprobando conexión con Firestore…" : "Sin conexión."}</p>
        {!online ? (
          <Button icon="RefreshCw" variant="secondary" loading={busy} onClick={reconnect}>
            Reconectar
          </Button>
        ) : null}
        {message ? <p className="fm-connection-popover__message" aria-live="polite">{message}</p> : null}
      </AnchoredPopover>
    </>
  );
}
''')

# ManagementShell: controlled profile popover, exactly one chevron, route preloading.
shell = read("src/gestion/ManagementShell.jsx")
shell = shell.replace('import {\n  Dropdown,\n  IconButton,\n  SearchInput,\n} from "../design-system";', 'import {\n  IconButton,\n  SearchInput,\n} from "../design-system";')
shell = shell.replace('import ConnectionIndicator from "./components/ConnectionIndicator";\nimport { Icon } from "./components/icons";', 'import AnchoredPopover from "./components/AnchoredPopover";\nimport ConnectionIndicator from "./components/ConnectionIndicator";\nimport { Icon } from "./components/icons";')
shell = shell.replace('import {\n  canAccessManagementRoute,', 'import { preloadManagementRoute } from "./routePreload";\nimport {\n  canAccessManagementRoute,')
shell = shell.replace('\nconst preloadSeller = () => import("./seller/SellerPanel").catch(() => {});\n', '\n')
shell = shell.replace('  const [search, setSearch] = useState("");\n  const searchRef = useRef(null);', '  const [search, setSearch] = useState("");\n  const [profileOpen, setProfileOpen] = useState(false);\n  const searchRef = useRef(null);\n  const profileTriggerRef = useRef(null);')
shell = shell.replace('    setDrawerOpen(false);\n    setSearch("");', '    setDrawerOpen(false);\n    setProfileOpen(false);\n    setSearch("");')
shell = shell.replace('              title={collapsed ? route.label : undefined}\n            >', '              title={collapsed ? route.label : undefined}\n              onPointerEnter={() => preloadManagementRoute(route.id)}\n              onPointerDown={() => preloadManagementRoute(route.id)}\n              onFocus={() => preloadManagementRoute(route.id)}\n            >')
old_profile = '''          <Dropdown label={<span className="fm-profile-trigger"><span className="fm-avatar">{(profile.name || profile.email || "F").slice(0, 1).toUpperCase()}</span><span><strong>{profile.name || "Usuario"}</strong><small>{roleLabels[normalizedRole(profile)] || normalizedRole(profile)}</small></span><Icon name="ChevronDown" /></span>}>
            <div className="fm-profile-menu">
              <Link to="/gestion/settings"><Icon name="UserRound" />Mi perfil</Link>
              {canAccessSellerPanel(profile) ? (
                <Link
                  to="/vendedor"
                  onPointerEnter={preloadSeller}
                  onFocus={preloadSeller}
                  onClick={() => localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "seller")}
                ><Icon name="ShoppingCart" />Ver Panel Vendedor</Link>
              ) : null}
              <button type="button" onClick={logout}><Icon name="LogOut" />Cerrar sesión</button>
            </div>
          </Dropdown>'''
new_profile = '''          <button
            ref={profileTriggerRef}
            type="button"
            className="fm-profile-button"
            onClick={() => setProfileOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
          >
            <span className="fm-profile-trigger">
              <span className="fm-avatar">{(profile.name || profile.email || "F").slice(0, 1).toUpperCase()}</span>
              <span><strong>{profile.name || "Usuario"}</strong><small>{roleLabels[normalizedRole(profile)] || normalizedRole(profile)}</small></span>
              <Icon name="ChevronDown" />
            </span>
          </button>
          <AnchoredPopover
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            triggerRef={profileTriggerRef}
            className="fm-profile-popover"
            role="menu"
            ariaLabel="Menú de usuario"
          >
            <div className="fm-profile-menu">
              <Link role="menuitem" to="/gestion/settings" onClick={() => setProfileOpen(false)}><Icon name="UserRound" />Mi perfil</Link>
              {canAccessSellerPanel(profile) ? (
                <Link
                  role="menuitem"
                  to="/vendedor"
                  onClick={() => {
                    setProfileOpen(false);
                    try { localStorage.setItem(`flor-mia-preferred-panel-${profile.id}`, "seller"); } catch { /* preferencia no crítica */ }
                  }}
                ><Icon name="ShoppingCart" />Ver Panel Vendedor</Link>
              ) : null}
              <button role="menuitem" type="button" onClick={() => { setProfileOpen(false); logout(); }}><Icon name="LogOut" />Cerrar sesión</button>
            </div>
          </AnchoredPopover>'''
if old_profile not in shell:
    raise RuntimeError("No se encontró el Dropdown de perfil esperado")
shell = shell.replace(old_profile, new_profile, 1)
write("src/gestion/ManagementShell.jsx", shell)

# ManagementApp: same lazy loaders are preloaded by the shell; keep the shell mounted with a lightweight section fallback.
app = read("src/gestion/ManagementApp.jsx")
app = app.replace('import ManagementShell from "./ManagementShell";\nimport { moduleById, SALES_METRICS_PATH } from "./modules";', 'import ManagementShell from "./ManagementShell";\nimport { moduleById, SALES_METRICS_PATH } from "./modules";\nimport { managementPageLoaders } from "./routePreload";')
for old, new in [
    ('const AdministrationPage = lazy(() => import("./pages/AdministrationPage"));', 'const AdministrationPage = lazy(managementPageLoaders.administration);'),
    ('const ActivityPage = lazy(() => import("./pages/ActivityPage"));', 'const ActivityPage = lazy(managementPageLoaders.actividad);'),
    ('const AuditPage = lazy(() => import("./pages/AuditPage"));', 'const AuditPage = lazy(managementPageLoaders.audit);'),
    ('const GenericModulePage = lazy(() => import("./pages/GenericModulePage"));', 'const GenericModulePage = lazy(managementPageLoaders.generic);'),
    ('const LoyalCustomersPage = lazy(() => import("./pages/LoyalCustomersPage"));', 'const LoyalCustomersPage = lazy(managementPageLoaders["loyal-customers"]);'),
    ('const LocationsPage = lazy(() => import("./pages/LocationsPage"));', 'const LocationsPage = lazy(managementPageLoaders.locations);'),
    ('const LocationDetailPage = lazy(() => import("./pages/LocationDetailPage"));', 'const LocationDetailPage = lazy(managementPageLoaders.locationDetail);'),
    ('const QuickSalesPage = lazy(() => import("./pages/QuickSalesPage"));', 'const QuickSalesPage = lazy(managementPageLoaders["quick-sales"]);'),
    ('const SalesMetricsPage = lazy(() => import("./pages/SalesMetricsPage"));', 'const SalesMetricsPage = lazy(managementPageLoaders.metrics);'),
    ('const SettingsPage = lazy(() => import("./pages/SettingsPage"));', 'const SettingsPage = lazy(managementPageLoaders.settings);'),
]:
    if old not in app: raise RuntimeError(f"Lazy loader faltante: {old}")
    app = app.replace(old, new, 1)
app = app.replace('<main className="fm-module-transition" aria-live="polite">\n      <Skeleton lines={5} />\n      <span className="sr-only">Preparando módulo</span>\n    </main>', '<section className="fm-module-transition" aria-live="polite">\n      <Skeleton lines={5} />\n      <span className="sr-only">Preparando módulo</span>\n    </section>')
write("src/gestion/ManagementApp.jsx", app)

# Dashboard: centralized activity presentation + compact type filter.
dashboard = read("src/gestion/pages/DashboardPage.jsx")
dashboard = dashboard.replace('import { useAuth } from "../AuthContext";\nimport DashboardFilters', 'import { useAuth } from "../AuthContext";\nimport { getActivityPresentation, getActivityTypeGroups } from "../activity/activityPresentation";\nimport DashboardFilters')
old_activity_list = '''function ActivityList({ activities }) {
  return (
    <ul className="fm-activity-list">
      {activities.map((activity) => (
        <li key={activity.id}>
          <div className="fm-activity-list__icon"><Icon name={activity.source === "sales" ? "ReceiptText" : activity.source === "stockMovements" ? "PackagePlus" : "Activity"} /></div>
          <div>
            <strong>{activity.title}</strong>
            <span>{activity.description || activity.locationName || "Sistema"} · {formatDateTime(activity.createdAt)}</span>
            <small>{activity.userName || "Sistema"}{activity.locationName ? ` · ${activity.locationName}` : ""}</small>
          </div>
          <Badge tone={activity.status === "cancelled" ? "error" : "success"}>
            {activity.amount != null ? formatMoney(activity.amount) : "Registrada"}
          </Badge>
        </li>
      ))}
    </ul>
  );
}'''
new_activity_list = '''function ActivityList({ activities }) {
  return (
    <ul className="fm-activity-list">
      {activities.map((activity) => {
        const presentation = getActivityPresentation(activity);
        return (
          <li key={activity.id}>
            <div className={`fm-activity-list__icon is-${presentation.tone}`}><Icon name={presentation.icon} /></div>
            <div>
              <strong>{presentation.label}</strong>
              <span>{activity.description || activity.locationName || "Sistema"} · {formatDateTime(activity.createdAt)}</span>
              <small>{activity.userName || "Sistema"}{activity.locationName ? ` · ${activity.locationName}` : ""}</small>
            </div>
            <Badge tone={activity.status === "cancelled" ? "error" : "success"}>
              {activity.amount != null ? formatMoney(activity.amount) : "Registrada"}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}'''
if old_activity_list not in dashboard: raise RuntimeError("ActivityList del Dashboard cambió")
dashboard = dashboard.replace(old_activity_list, new_activity_list, 1)
dashboard = dashboard.replace('  const [stockPickerOpen, setStockPickerOpen] = useState(false);', '  const [stockPickerOpen, setStockPickerOpen] = useState(false);\n  const [activityType, setActivityType] = useState("");')
dashboard = dashboard.replace('      pageSize: 6,\n    });', '      filters: { action: activityType },\n      pageSize: 6,\n    });', 1)
dashboard = dashboard.replace('  }, [profile.id, allowedLocationIdsKey, selectedLocationIdsKey, format, referenceKey]);\n\n  const modules = visibleBusinessModules(profile);', '  }, [profile.id, allowedLocationIdsKey, selectedLocationIdsKey, format, referenceKey, activityType]);\n\n  const activityTypeGroups = useMemo(() => getActivityTypeGroups(activityResult.data || []), [activityResult.data]);\n  const modules = visibleBusinessModules(profile);', 1)
old_panel_action = '              action={<Link className="fm-button fm-button--secondary" to="/gestion/actividad"><Icon name="Activity" /><span>Ver toda la actividad</span></Link>}'
new_panel_action = '''              action={<div className="fm-dashboard-activity-actions">
                <label><span className="sr-only">Tipo de actividad</span><select value={activityType} onChange={(event) => setActivityType(event.target.value)} aria-label="Filtrar actividad del período por tipo"><option value="">Todas</option>{activityTypeGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</select></label>
                <Link className="fm-button fm-button--secondary" to="/gestion/actividad"><Icon name="Activity" /><span>Ver toda la actividad</span></Link>
              </div>}'''
if old_panel_action not in dashboard: raise RuntimeError("Acción del panel Actividad no encontrada")
dashboard = dashboard.replace(old_panel_action, new_panel_action, 1)
write("src/gestion/pages/DashboardPage.jsx", dashboard)

# Activity page rewrite: shared locations + one semantic map + grouped type selector.
write("src/gestion/pages/ActivityPage.jsx", r'''
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Panel,
  Select,
  Skeleton,
} from "../../design-system";
import { addArgentinaDays, argentinaDateFromKey } from "../../modules/locations/domain/time";
import { getActivityPresentation, getActivityTypeGroups } from "../activity/activityPresentation";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime, formatMoney } from "../formatters";
import { businessModules } from "../modules";
import { can } from "../permissions";
import { listActivityPage } from "../services/dashboardService";
import { listLocationsShared } from "../services/sharedResources";
import { useAsyncData } from "../hooks";

const emptyFilters = { from: "", to: "", locationId: "", userId: "", moduleId: "", action: "" };

export default function ActivityPage() {
  const { profile } = useAuth();
  const locationsResult = useAsyncData(() => listLocationsShared(profile), [profile.id]);
  const [filters, setFilters] = useState(emptyFilters);
  const [state, setState] = useState({ status: "loading", items: [], cursor: {}, hasMore: false, error: null });
  const locations = locationsResult.data || [];
  const locationIdsKey = locations.map((location) => location.id).join(",");

  const load = useCallback(async ({ append = false } = {}) => {
    if (locationsResult.status !== "ready") return;
    setState((current) => ({ ...current, status: append ? "loading-more" : "loading", error: null }));
    try {
      const from = filters.from ? argentinaDateFromKey(filters.from) : null;
      const to = filters.to ? addArgentinaDays(argentinaDateFromKey(filters.to), 1) : null;
      const page = await listActivityPage({
        profile,
        locationIds: filters.locationId ? [filters.locationId] : can(profile, "locations", "viewAllLocations") ? undefined : locations.map((location) => location.id),
        from,
        to,
        filters: { userId: filters.userId, moduleId: filters.moduleId, action: filters.action },
        pageSize: 20,
        cursor: append ? state.cursor : {},
      });
      setState((current) => ({
        status: "ready",
        items: append ? [...current.items, ...page.items] : page.items,
        cursor: page.cursor,
        hasMore: page.hasMore,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error }));
    }
  }, [filters, locationIdsKey, locationsResult.status, profile, state.cursor]);

  useEffect(() => {
    if (locationsResult.status === "ready") load();
    // El cursor no debe reiniciar la primera página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, locationIdsKey, locationsResult.status, profile.id]);

  const users = useMemo(() => {
    const map = new Map();
    state.items.forEach((item) => {
      if (item.userId) map.set(item.userId, item.userName || "Usuario");
    });
    return [...map].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [state.items]);
  const activityTypeGroups = useMemo(() => getActivityTypeGroups(state.items), [state.items]);
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Actividad operativa" title="Toda la actividad" description="Ventas, movimientos de stock y acciones administrativas, ordenadas desde la más reciente." />
      <Panel title="Filtros" description="Las consultas se realizan por páginas y solamente sobre ubicaciones autorizadas.">
        <FilterBar actions={Object.values(filters).some(Boolean) ? <Button variant="ghost" icon="RotateCcw" onClick={() => setFilters(emptyFilters)}>Limpiar filtros</Button> : null}>
          <label className="fm-compact-field"><span>Desde</span><input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} /></label>
          <label className="fm-compact-field"><span>Hasta</span><input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} /></label>
          <Select aria-label="Filtrar por ubicación" value={filters.locationId} onChange={(event) => updateFilter("locationId", event.target.value)}><option value="">Todas las ubicaciones</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Select>
          <Select aria-label="Filtrar por módulo" value={filters.moduleId} onChange={(event) => updateFilter("moduleId", event.target.value)}><option value="">Todos los módulos</option>{businessModules.map((module) => <option key={module.id} value={module.id}>{module.label}</option>)}</Select>
          <Select aria-label="Filtrar por usuario" value={filters.userId} onChange={(event) => updateFilter("userId", event.target.value)}><option value="">Todos los usuarios</option>{users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Select>
          <Select aria-label="Filtrar por tipo de actividad" value={filters.action} onChange={(event) => updateFilter("action", event.target.value)}><option value="">Todos los tipos</option>{activityTypeGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</optgroup>)}</Select>
        </FilterBar>
      </Panel>

      <Panel title="Registro cronológico" description="Se cargan hasta 20 actividades por vez.">
        {(state.status === "loading" || locationsResult.status === "loading") ? <Skeleton lines={7} /> : null}
        {state.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo consultar la actividad" description={state.error?.message || "Revisá la conexión y los permisos."} action={<Button variant="secondary" onClick={() => load()}>Reintentar</Button>} /> : null}
        {state.items.length ? <DataTable rows={state.items} columns={[
          { key: "action", label: "Actividad", render: (item) => { const presentation = getActivityPresentation(item); return <div className="fm-activity-cell"><span className={`fm-activity-list__icon is-${presentation.tone}`}><Icon name={presentation.icon} /></span><span><strong>{presentation.label}</strong><small>{item.description}</small></span></div>; } },
          { key: "moduleId", label: "Módulo", render: (item) => businessModules.find((module) => module.id === item.moduleId)?.shortLabel || "Sistema" },
          { key: "locationName", label: "Ubicación", render: (item) => item.locationName || "General" },
          { key: "userName", label: "Usuario" },
          { key: "status", label: "Estado", render: (item) => <Badge tone={item.status === "cancelled" ? "error" : "success"}>{item.amount != null ? formatMoney(item.amount) : "Registrada"}</Badge> },
          { key: "createdAt", label: "Fecha y hora", render: (item) => formatDateTime(item.createdAt) },
        ]} /> : null}
        {state.status === "ready" && !state.items.length ? <EmptyState icon="Activity" title="No hay actividad para estos filtros" description="Probá ampliar las fechas o quitar algún filtro." /> : null}
        {state.items.length && state.hasMore ? <div className="fm-load-more"><Button variant="secondary" loading={state.status === "loading-more"} onClick={() => load({ append: true })}>Cargar más actividad</Button></div> : null}
      </Panel>
    </div>
  );
}
''')

# Keep activity pagination bounded but allow enough candidates for client-side type/user/module filters.
service = read("src/gestion/services/dashboardService.js")
service = service.replace('  const tasks = sources.flatMap((source) => groups.map(async (group) => {', '  const hasPostFilter = Boolean(filters.userId || filters.moduleId || filters.action);\n  const sourceLimit = hasPostFilter ? Math.min(100, Math.max(pageSize * 5, pageSize + 1)) : pageSize + 1;\n  const tasks = sources.flatMap((source) => groups.map(async (group) => {')
service = service.replace('    constraints.push(limit(pageSize + 1));', '    constraints.push(limit(sourceLimit));')
service = service.replace('    hasMore: processed.length < raw.length || fetchedGroups.some((entries) => entries.length > pageSize),', '    hasMore: processed.length < raw.length || fetchedGroups.some((entries) => entries.length >= sourceLimit),')
write("src/gestion/services/dashboardService.js", service)

# Customer domain adds one display formatter and one WhatsApp conversion, both based on the existing normalizer.
customer_domain = read("src/gestion/customers/customerDomain.js")
insert_after = '''export function isValidCustomerPhone(value) {
  const normalized = normalizeCustomerPhone(value);
  return normalized.length >= 8 && normalized.length <= 11;
}
'''
addition = r'''

export function formatPhoneForDisplay(value) {
  const normalized = normalizeCustomerPhone(value);
  if (!normalized) return "";
  if (normalized.length === 10 && normalized.startsWith("11")) {
    return `11-${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }
  if (normalized.length <= 4) return normalized;
  return `${normalized.slice(0, -4)}-${normalized.slice(-4)}`;
}

export function phoneToWhatsAppInternational(value) {
  const normalized = normalizeCustomerPhone(value);
  if (!isValidCustomerPhone(normalized)) return "";
  // Los clientes de esta base usan numeración argentina nacional. Para móviles,
  // WhatsApp requiere país 54 + indicador móvil 9 + número nacional sin 0/15.
  return normalized.length === 10 ? `549${normalized}` : `54${normalized}`;
}

export function customerWhatsAppUrl(value) {
  const international = phoneToWhatsAppInternational(value);
  return international ? `https://wa.me/${international}` : "";
}
'''
if insert_after not in customer_domain: raise RuntimeError("No se encontró isValidCustomerPhone")
customer_domain = customer_domain.replace(insert_after, insert_after + addition, 1)
write("src/gestion/customers/customerDomain.js", customer_domain)

# Customer service: bounded list, transactional phone migration, duplicate protection and audit.
write("src/gestion/services/customerService.js", r'''
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  buildCustomerDraft,
  cleanZoneName,
  customerDocumentId,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { can } from "../permissions";
import { db } from "./firebase";
import { invalidateRuntimeCache, withRuntimeCache } from "./runtimeCache";

const docsToArray = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const ACTIVE_ZONES_CACHE_KEY = "customer-zones:active";
const ALL_ZONES_CACHE_KEY = "customer-zones:all";
const LOCAL_ZONES_KEY = "flor-mia-customer-zones-v1";

function userName(profile = {}) {
  return profile.name || profile.email || "Usuario";
}

function assertCanEditCustomer(profile) {
  if (!can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para editar clientes.");
  }
}

function customerAudit(profile, { action, customerId, changedFields = [] }) {
  return {
    action,
    title: action === "customer.created" ? "Cliente creado" : "Cliente actualizado",
    description: action === "customer.created" ? "Nuevo cliente fidelizado" : "Datos principales actualizados",
    moduleId: "loyal-customers",
    entityType: "customer",
    entityId: customerId,
    userId: profile.id,
    userName: userName(profile),
    status: "completed",
    ...(changedFields.length ? { changedFields } : {}),
    createdAt: serverTimestamp(),
  };
}

function sortZones(zones = []) {
  return [...zones].sort((a, b) =>
    Number(a.order || 0) - Number(b.order || 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "es"),
  );
}

function rememberActiveZones(zones) {
  try {
    localStorage.setItem(LOCAL_ZONES_KEY, JSON.stringify(zones.map((zone) => ({
      id: zone.id,
      name: zone.name,
      order: Number(zone.order || 0),
      active: zone.active !== false,
    }))));
  } catch {
    // El cache persistente es una mejora offline; nunca bloquea la venta.
  }
  return zones;
}

function rememberedActiveZones() {
  try {
    const value = JSON.parse(localStorage.getItem(LOCAL_ZONES_KEY) || "[]");
    return Array.isArray(value) ? sortZones(value.filter((zone) => zone?.active !== false && zone?.name)) : [];
  } catch {
    return [];
  }
}

export async function findCustomerByPhone(phone) {
  const phoneNormalized = normalizeCustomerPhone(phone);
  if (!phoneNormalized) return null;
  const customerId = await customerDocumentId(phoneNormalized);
  const snapshot = await getDoc(doc(db, "customers", customerId));
  if (!snapshot.exists() || snapshot.data().deleted === true || snapshot.data().active === false) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listCustomers(profile, pageSize = 200) {
  if (!can(profile, "loyal-customers", "view")) {
    throw new Error("No tenés permiso para ver Clientes Fidelizados.");
  }
  const size = Math.max(1, Math.min(500, Number(pageSize) || 200));
  try {
    return docsToArray(await getDocs(query(
      collection(db, "customers"),
      orderBy("updatedAt", "desc"),
      limit(size),
    ))).filter((customer) => customer.deleted !== true);
  } catch (error) {
    if (error?.code === "permission-denied") throw error;
    return docsToArray(await getDocs(query(collection(db, "customers"), limit(size))))
      .filter((customer) => customer.deleted !== true);
  }
}

export async function saveCustomerFromAdmin(profile, input) {
  if (!can(profile, "loyal-customers", "create") && !can(profile, "loyal-customers", "edit")) {
    throw new Error("No tenés permiso para guardar clientes.");
  }
  const draft = buildCustomerDraft(input);
  const customerId = await customerDocumentId(draft.phoneNormalized);
  const reference = doc(db, "customers", customerId);
  const existing = await getDoc(reference);
  if (existing.exists() && !can(profile, "loyal-customers", "edit")) {
    throw new Error("Ese cliente ya existe y no tenés permiso para editarlo.");
  }
  const batch = writeBatch(db);
  batch.set(reference, {
    customerKey: customerId,
    phone: draft.phone,
    phoneNormalized: draft.phoneNormalized,
    name: draft.name || null,
    zoneId: draft.zoneId || null,
    zoneName: draft.zoneName,
    customZone: draft.customZone || null,
    active: true,
    deleted: false,
    source: existing.exists() ? (existing.data().source || "admin") : "admin",
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
    ...(existing.exists() ? {} : {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
    }),
  }, { merge: true });
  batch.set(doc(collection(db, "auditLogs")), customerAudit(profile, {
    action: existing.exists() ? "customer.updated" : "customer.created",
    customerId,
    changedFields: existing.exists() ? ["name", "phone", "zone"] : [],
  }));
  await batch.commit();
  return customerId;
}

export async function updateCustomerFromAdmin(profile, currentCustomer, input) {
  assertCanEditCustomer(profile);
  if (!currentCustomer?.id) throw new Error("El cliente no está disponible.");
  const draft = buildCustomerDraft(input);
  const targetId = await customerDocumentId(draft.phoneNormalized);
  const currentRef = doc(db, "customers", currentCustomer.id);
  const targetRef = doc(db, "customers", targetId);
  const auditRef = doc(collection(db, "auditLogs"));

  return runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(currentRef);
    if (!currentSnapshot.exists() || currentSnapshot.data().deleted === true) {
      throw new Error("El cliente dejó de estar disponible. Actualizá el listado.");
    }
    const stored = currentSnapshot.data();
    let targetSnapshot = currentSnapshot;
    if (targetId !== currentCustomer.id) {
      targetSnapshot = await transaction.get(targetRef);
      if (targetSnapshot.exists() && targetSnapshot.data().deleted !== true) {
        throw new Error("Ya existe otro cliente con ese teléfono.");
      }
    }

    const changedFields = [];
    if (String(stored.name || "") !== draft.name) changedFields.push("name");
    if (String(stored.phoneNormalized || "") !== draft.phoneNormalized || String(stored.phone || "") !== draft.phone) changedFields.push("phone");
    if (String(stored.zoneId || "") !== draft.zoneId || String(stored.zoneName || "") !== draft.zoneName || String(stored.customZone || "") !== draft.customZone) changedFields.push("zone");

    const payload = {
      customerKey: targetId,
      phone: draft.phone,
      phoneNormalized: draft.phoneNormalized,
      name: draft.name || null,
      zoneId: draft.zoneId || null,
      zoneName: draft.zoneName,
      customZone: draft.customZone || null,
      active: true,
      deleted: false,
      source: stored.source || "admin",
      updatedBy: profile.id,
      updatedByName: userName(profile),
      updatedAt: serverTimestamp(),
    };

    if (targetId === currentCustomer.id) {
      transaction.set(currentRef, payload, { merge: true });
    } else {
      transaction.set(targetRef, {
        ...payload,
        createdBy: profile.id,
        createdByName: userName(profile),
        createdAt: serverTimestamp(),
        originalCreatedBy: stored.createdBy || null,
        originalCreatedByName: stored.createdByName || null,
        originalCreatedAt: stored.createdAt || null,
        lastSaleId: stored.lastSaleId || null,
        lastPurchaseAt: stored.lastPurchaseAt || null,
        migratedFromCustomerId: currentCustomer.id,
      }, { merge: true });
      transaction.set(currentRef, {
        active: false,
        deleted: true,
        movedToCustomerId: targetId,
        movedAt: serverTimestamp(),
        updatedBy: profile.id,
        updatedByName: userName(profile),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    transaction.set(auditRef, customerAudit(profile, {
      action: "customer.updated",
      customerId: targetId,
      changedFields,
    }));
    return { id: targetId, changedFields };
  });
}

export async function listActiveCustomerZones({ allowOfflineFallback = true } = {}) {
  return withRuntimeCache(ACTIVE_ZONES_CACHE_KEY, async () => {
    try {
      const zones = docsToArray(await getDocs(query(
        collection(db, "customerZones"),
        where("active", "==", true),
        limit(100),
      )));
      return rememberActiveZones(sortZones(zones));
    } catch (error) {
      const cached = allowOfflineFallback ? rememberedActiveZones() : [];
      if (cached.length) return cached;
      throw error;
    }
  }, 120_000);
}

export async function listCustomerZones(profile) {
  if (!can(profile, "loyal-customers", "view")) {
    throw new Error("No tenés permiso para administrar zonas.");
  }
  return withRuntimeCache(ALL_ZONES_CACHE_KEY, async () => sortZones(
    docsToArray(await getDocs(query(
      collection(db, "customerZones"),
      limit(150),
    ))),
  ), 60_000);
}

export async function saveCustomerZone(profile, input, zoneId = null) {
  const canEdit = can(profile, "loyal-customers", "edit") || can(profile, "loyal-customers", "admin");
  if (!canEdit) throw new Error("No tenés permiso para configurar zonas.");
  const name = cleanZoneName(input?.name);
  if (!name) throw new Error("Ingresá el nombre de la zona.");
  const reference = zoneId ? doc(db, "customerZones", zoneId) : doc(collection(db, "customerZones"));
  await setDoc(reference, {
    name,
    active: input?.active !== false,
    order: Math.max(0, Number(input?.order || 0)),
    updatedBy: profile.id,
    updatedByName: userName(profile),
    updatedAt: serverTimestamp(),
    ...(zoneId ? {} : {
      createdBy: profile.id,
      createdByName: userName(profile),
      createdAt: serverTimestamp(),
    }),
  }, { merge: true });
  invalidateCustomerZones();
  return reference.id;
}

export async function setCustomerZoneActive(profile, zone, active) {
  if (!zone?.id) throw new Error("La zona no existe.");
  return saveCustomerZone(profile, { ...zone, active }, zone.id);
}

export function invalidateCustomerZones() {
  invalidateRuntimeCache(ACTIVE_ZONES_CACHE_KEY);
  invalidateRuntimeCache(ALL_ZONES_CACHE_KEY);
}
''')

# Seller must never reuse a retired customer document after an administrator changes the deterministic phone ID.
seller = read("src/gestion/services/sellerService.js")
old_resolved = '''function resolvedCustomerFromSnapshot(snapshot, prepared) {
  if (!prepared) return null;
  if (!snapshot?.exists()) return prepared;
  const stored = snapshot.data();
  return {'''
new_resolved = '''function resolvedCustomerFromSnapshot(snapshot, prepared) {
  if (!prepared) return null;
  if (!snapshot?.exists()) return prepared;
  const stored = snapshot.data();
  if (stored.deleted === true || stored.active === false) {
    throw new Error("Este teléfono fue reemplazado en Clientes Fidelizados. Usá el número actualizado.");
  }
  return {'''
if old_resolved not in seller: raise RuntimeError("resolvedCustomerFromSnapshot no encontrado")
seller = seller.replace(old_resolved, new_resolved, 1)
write("src/gestion/services/sellerService.js", seller)

# Loyal Customers page: details, edit, readable phone and WhatsApp link.
write("src/gestion/pages/LoyalCustomersPage.jsx", r'''
import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  Skeleton,
  Tabs,
  Toast,
} from "../../design-system";
import {
  customerDisplayName,
  customerWhatsAppUrl,
  customerZoneLabel,
  formatPhoneForDisplay,
  matchesCustomerSearch,
  normalizeCustomerPhone,
} from "../customers/customerDomain";
import { useAuth } from "../AuthContext";
import { Icon } from "../components/icons";
import { formatDateTime } from "../formatters";
import { useAsyncData } from "../hooks";
import { can } from "../permissions";
import {
  listCustomers,
  listCustomerZones,
  saveCustomerFromAdmin,
  saveCustomerZone,
  setCustomerZoneActive,
  updateCustomerFromAdmin,
} from "../services/customerService";

const blankCustomer = { phone: "", zoneId: "", customZone: "", name: "" };
const blankZone = { name: "", order: 0, active: true };

function displayedPhone(customer) {
  return formatPhoneForDisplay(customer.phoneNormalized || customer.phone || customer.title) || "Sin teléfono";
}

function customerToForm(customer = {}, zones = []) {
  const configured = zones.some((zone) => zone.id && zone.id === customer.zoneId);
  const usesCustom = Boolean(customer.customZone) || (!configured && !customer.zoneId && customer.zoneName);
  return {
    phone: customer.phoneNormalized || customer.phone || "",
    name: customer.name || "",
    zoneId: usesCustom ? "__custom" : (customer.zoneId || ""),
    customZone: usesCustom ? (customer.customZone || customer.zoneName || "") : "",
  };
}

function CustomersList({ customers, onOpen }) {
  if (!customers.length) {
    return <EmptyState icon="UsersRound" title="No hay clientes para mostrar" description="Los clientes identificados desde una venta aparecerán aquí automáticamente." />;
  }
  return (
    <div className="fm-customers-list">
      {customers.map((customer) => {
        const phone = displayedPhone(customer);
        const whatsappUrl = customerWhatsAppUrl(customer.phoneNormalized || customer.phone);
        return (
          <article key={customer.id} className="fm-customer-card">
            <button type="button" className="fm-customer-card__open" onClick={() => onOpen(customer)} aria-label={`Abrir detalle de ${customerDisplayName(customer)}`} />
            <div className="fm-customer-card__identity">
              <span className="fm-customer-card__icon"><Icon name="UserRound" /></span>
              <div>
                {customer.name ? <strong>{customerDisplayName(customer)}</strong> : null}
                {whatsappUrl ? (
                  <a
                    className="fm-customer-phone-link"
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Abrir WhatsApp con ${phone}`}
                    onClick={(event) => event.stopPropagation()}
                  ><Icon name="MessagesSquare" /><b>{phone}</b></a>
                ) : <b>{phone}</b>}
                {customerZoneLabel(customer) ? <span><Icon name="MapPin" />{customerZoneLabel(customer)}</span> : null}
              </div>
            </div>
            <Badge tone={customer.active === false ? "neutral" : "success"}>
              {customer.active === false ? "Inactivo" : "Activo"}
            </Badge>
          </article>
        );
      })}
    </div>
  );
}

export default function LoyalCustomersPage() {
  const { profile } = useAuth();
  const canEditCustomers = can(profile, "loyal-customers", "edit");
  const canCreateCustomers = can(profile, "loyal-customers", "create") || canEditCustomers;
  const canManageZones = canEditCustomers || can(profile, "loyal-customers", "admin");
  const customersResult = useAsyncData(() => listCustomers(profile, 250), [profile.id]);
  const zonesResult = useAsyncData(() => listCustomerZones(profile), [profile.id]);
  const [tab, setTab] = useState("customers");
  const [search, setSearch] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerForm, setCustomerForm] = useState(blankCustomer);
  const [customerBusy, setCustomerBusy] = useState(false);
  const [customerError, setCustomerError] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [detailForm, setDetailForm] = useState(blankCustomer);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState(blankZone);
  const [editingZoneId, setEditingZoneId] = useState("");
  const [zoneBusy, setZoneBusy] = useState(false);
  const [zoneError, setZoneError] = useState("");
  const [message, setMessage] = useState("");

  const customers = customersResult.data || [];
  const zones = zonesResult.data || [];
  const activeZones = zones.filter((zone) => zone.active !== false);
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => matchesCustomerSearch(customer, search)),
    [customers, search],
  );

  const openNewCustomer = () => {
    setCustomerForm(blankCustomer);
    setCustomerError("");
    setCustomerOpen(true);
  };

  const saveCustomer = async () => {
    setCustomerBusy(true);
    setCustomerError("");
    try {
      const selectedZone = activeZones.find((zone) => zone.id === customerForm.zoneId);
      await saveCustomerFromAdmin(profile, {
        phone: customerForm.phone,
        name: customerForm.name,
        zoneId: selectedZone?.id || "",
        zoneName: selectedZone?.name || "",
        customZone: customerForm.zoneId === "__custom" ? customerForm.customZone : "",
      });
      setCustomerOpen(false);
      setCustomerForm(blankCustomer);
      await customersResult.refresh();
      setMessage("Cliente guardado correctamente.");
    } catch (error) {
      setCustomerError(error.message);
    } finally {
      setCustomerBusy(false);
    }
  };

  const openCustomer = (customer) => {
    setSelectedCustomer(customer);
    setDetailForm(customerToForm(customer, zones));
    setEditingCustomer(false);
    setDetailError("");
  };

  const closeCustomer = () => {
    if (detailBusy) return;
    setSelectedCustomer(null);
    setEditingCustomer(false);
    setDetailError("");
  };

  const startCustomerEdit = () => {
    setDetailForm(customerToForm(selectedCustomer, zones));
    setDetailError("");
    setEditingCustomer(true);
  };

  const saveCustomerEdit = async () => {
    if (!selectedCustomer) return;
    setDetailBusy(true);
    setDetailError("");
    try {
      const selectedZone = zones.find((zone) => zone.id === detailForm.zoneId);
      const result = await updateCustomerFromAdmin(profile, selectedCustomer, {
        phone: detailForm.phone,
        name: detailForm.name,
        zoneId: selectedZone?.id || "",
        zoneName: selectedZone?.name || "",
        customZone: detailForm.zoneId === "__custom" ? detailForm.customZone : "",
      });
      const refreshed = await customersResult.refresh();
      const updated = (refreshed || []).find((customer) => customer.id === result.id);
      setSelectedCustomer(updated || { ...selectedCustomer, id: result.id, phone: detailForm.phone, phoneNormalized: normalizeCustomerPhone(detailForm.phone), name: detailForm.name, zoneId: selectedZone?.id || "", zoneName: selectedZone?.name || detailForm.customZone, customZone: detailForm.zoneId === "__custom" ? detailForm.customZone : "" });
      setEditingCustomer(false);
      setMessage("Cliente actualizado.");
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setDetailBusy(false);
    }
  };

  const openNewZone = () => {
    setEditingZoneId("");
    setZoneForm(blankZone);
    setZoneError("");
    setZoneOpen(true);
  };

  const openEditZone = (zone) => {
    setEditingZoneId(zone.id);
    setZoneForm({ name: zone.name || "", order: Number(zone.order || 0), active: zone.active !== false });
    setZoneError("");
    setZoneOpen(true);
  };

  const saveZone = async () => {
    setZoneBusy(true);
    setZoneError("");
    try {
      await saveCustomerZone(profile, zoneForm, editingZoneId || null);
      setZoneOpen(false);
      await zonesResult.refresh();
      setMessage(editingZoneId ? "Zona actualizada." : "Zona creada.");
    } catch (error) {
      setZoneError(error.message);
    } finally {
      setZoneBusy(false);
    }
  };

  const toggleZone = async (zone) => {
    try {
      await setCustomerZoneActive(profile, zone, zone.active === false);
      await zonesResult.refresh();
      setMessage(zone.active === false ? "Zona activada." : "Zona desactivada. Los registros históricos se conservan.");
    } catch (error) {
      setMessage(error.message);
    }
  };

  const detailPhone = selectedCustomer ? displayedPhone(selectedCustomer) : "";
  const detailWhatsapp = selectedCustomer ? customerWhatsAppUrl(selectedCustomer.phoneNormalized || selectedCustomer.phone) : "";
  const historicalZone = selectedCustomer?.zoneId ? zones.find((zone) => zone.id === selectedCustomer.zoneId && zone.active === false) : null;

  return (
    <div className="fm-page fm-customers-page">
      <PageHeader
        eyebrow="CRM operativo"
        title="Clientes Fidelizados"
        description="Una única base de clientes, identificada principalmente por teléfono y alimentada también desde las ventas."
        actions={tab === "customers" && canCreateCustomers
          ? <Button icon="UserPlus" onClick={openNewCustomer}>Nuevo cliente</Button>
          : tab === "zones" && canManageZones
            ? <Button icon="Plus" onClick={openNewZone}>Nueva zona</Button>
            : null}
      />

      <Tabs
        tabs={[
          { id: "customers", label: "Clientes" },
          ...(canManageZones ? [{ id: "zones", label: "Configuración de zonas" }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {message ? <Toast tone={message.toLocaleLowerCase().includes("error") ? "error" : "success"}>{message}</Toast> : null}

      {tab === "customers" ? (
        <Panel
          title="Registro de clientes"
          description="La vista carga un bloque acotado de registros; la venta nunca descarga la colección completa para identificar un teléfono."
          action={<Badge tone="neutral">{filteredCustomers.length} visibles</Badge>}
        >
          <div className="fm-customers-toolbar">
            <SearchInput
              label="Buscar por teléfono, nombre o zona"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            {search && normalizeCustomerPhone(search) ? <small>Teléfono normalizado: {formatPhoneForDisplay(normalizeCustomerPhone(search))}</small> : null}
          </div>
          {customersResult.status === "loading" ? <Skeleton lines={6} /> : null}
          {customersResult.status === "error" ? <Toast tone="error">{customersResult.error.message}</Toast> : null}
          {customersResult.status === "ready" ? <CustomersList customers={filteredCustomers} onOpen={openCustomer} /> : null}
        </Panel>
      ) : (
        <Panel
          title="Zonas"
          description="Las zonas inactivas dejan de ofrecerse en ventas nuevas, pero siguen visibles en clientes y ventas históricas."
        >
          {zonesResult.status === "loading" ? <Skeleton lines={5} /> : null}
          {zonesResult.status === "error" ? <Toast tone="error">{zonesResult.error.message}</Toast> : null}
          <div className="fm-zones-list">
            {zones.map((zone) => (
              <article key={zone.id} className="fm-zone-row">
                <div><strong>{zone.name}</strong><small>Orden {Number(zone.order || 0)}</small></div>
                <Badge tone={zone.active === false ? "neutral" : "success"}>{zone.active === false ? "Inactiva" : "Activa"}</Badge>
                {canManageZones ? (
                  <div className="fm-zone-row__actions">
                    <button type="button" onClick={() => openEditZone(zone)}><Icon name="Settings2" />Editar</button>
                    <button type="button" onClick={() => toggleZone(zone)}><Icon name={zone.active === false ? "Play" : "Pause"} />{zone.active === false ? "Activar" : "Desactivar"}</button>
                  </div>
                ) : null}
              </article>
            ))}
            {zonesResult.status === "ready" && !zones.length ? <EmptyState icon="MapPinned" title="Todavía no hay zonas" description="Creá las zonas que el vendedor podrá seleccionar al identificar un cliente." /> : null}
          </div>
        </Panel>
      )}

      <Modal
        open={Boolean(selectedCustomer)}
        onClose={closeCustomer}
        title={editingCustomer ? "Editar cliente" : "Detalle del cliente"}
        description={editingCustomer ? "Los cambios se guardan únicamente al confirmar." : "Datos principales del cliente fidelizado."}
        footer={selectedCustomer ? <div className="fm-dialog-actions">
          {editingCustomer ? <><Button variant="secondary" disabled={detailBusy} onClick={() => { setEditingCustomer(false); setDetailError(""); }}>Cancelar</Button><Button icon="Save" loading={detailBusy} onClick={saveCustomerEdit}>Guardar cambios</Button></> : <><Button variant="secondary" onClick={closeCustomer}>Cerrar</Button>{canEditCustomers ? <Button icon="Settings2" onClick={startCustomerEdit}>Editar</Button> : null}</>}
        </div> : null}
      >
        {selectedCustomer ? editingCustomer ? (
          <div className="fm-customer-form fm-customer-detail-form">
            <FormField label="Nombre (opcional)"><input autoComplete="name" value={detailForm.name} onChange={(event) => setDetailForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
            <FormField label="Teléfono" required hint="Se valida contra la base antes de guardar para evitar duplicados."><input type="tel" inputMode="tel" autoComplete="tel" value={detailForm.phone} onChange={(event) => setDetailForm((current) => ({ ...current, phone: event.target.value }))} /></FormField>
            <FormField label="Zona" required><select value={detailForm.zoneId} onChange={(event) => setDetailForm((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Elegir zona</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}{historicalZone ? <option value={historicalZone.id}>{historicalZone.name} (inactiva · actual)</option> : null}<option value="__custom">Otra zona</option></select></FormField>
            {detailForm.zoneId === "__custom" ? <FormField label="Otra zona" required><input value={detailForm.customZone} onChange={(event) => setDetailForm((current) => ({ ...current, customZone: event.target.value }))} /></FormField> : null}
            {detailError ? <Toast tone="error">{detailError}</Toast> : null}
          </div>
        ) : (
          <div className="fm-customer-detail">
            <div className="fm-customer-detail__hero"><span className="fm-customer-card__icon"><Icon name="UserRound" /></span><div><small>Cliente</small><strong>{customerDisplayName(selectedCustomer)}</strong></div></div>
            <dl>
              <div><dt>Teléfono</dt><dd>{detailWhatsapp ? <a href={detailWhatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Abrir WhatsApp con ${detailPhone}`}><Icon name="MessagesSquare" />{detailPhone}</a> : detailPhone}</dd></div>
              <div><dt>Zona</dt><dd>{customerZoneLabel(selectedCustomer) || "Sin zona"}</dd></div>
              {selectedCustomer.createdAt ? <div><dt>Alta</dt><dd>{formatDateTime(selectedCustomer.createdAt)}</dd></div> : null}
              {selectedCustomer.lastPurchaseAt ? <div><dt>Última compra</dt><dd>{formatDateTime(selectedCustomer.lastPurchaseAt)}</dd></div> : null}
              {selectedCustomer.updatedAt ? <div><dt>Última actualización</dt><dd>{formatDateTime(selectedCustomer.updatedAt)}</dd></div> : null}
            </dl>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={customerOpen}
        onClose={() => !customerBusy && setCustomerOpen(false)}
        title="Nuevo cliente"
        description="Teléfono y zona son suficientes; el nombre es opcional."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={() => setCustomerOpen(false)}>Cancelar</Button><Button icon="Save" loading={customerBusy} onClick={saveCustomer}>Guardar</Button></div>}
      >
        <div className="fm-customer-form">
          <FormField label="Teléfono" required hint="Se usa para evitar clientes duplicados aunque cambie el formato escrito."><input type="tel" inputMode="tel" autoComplete="tel" value={customerForm.phone} onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} /></FormField>
          <FormField label="Zona" required><select value={customerForm.zoneId} onChange={(event) => setCustomerForm((current) => ({ ...current, zoneId: event.target.value }))}><option value="">Elegir zona</option>{activeZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}<option value="__custom">Otra zona</option></select></FormField>
          {customerForm.zoneId === "__custom" ? <FormField label="Nueva zona" required><input value={customerForm.customZone} onChange={(event) => setCustomerForm((current) => ({ ...current, customZone: event.target.value }))} /></FormField> : null}
          <FormField label="Nombre (opcional)"><input autoComplete="name" value={customerForm.name} onChange={(event) => setCustomerForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
          {customerError ? <Toast tone="error">{customerError}</Toast> : null}
        </div>
      </Modal>

      <Modal
        open={zoneOpen}
        onClose={() => !zoneBusy && setZoneOpen(false)}
        title={editingZoneId ? "Editar zona" : "Nueva zona"}
        description="La zona quedará disponible para la captura rápida del Panel Vendedor."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={() => setZoneOpen(false)}>Cancelar</Button><Button icon="Save" loading={zoneBusy} onClick={saveZone}>Guardar</Button></div>}
      >
        <div className="fm-customer-form">
          <FormField label="Nombre de la zona" required><input value={zoneForm.name} onChange={(event) => setZoneForm((current) => ({ ...current, name: event.target.value }))} /></FormField>
          <FormField label="Orden"><input type="number" min="0" step="1" inputMode="numeric" value={zoneForm.order} onChange={(event) => setZoneForm((current) => ({ ...current, order: event.target.value }))} /></FormField>
          <label className="fm-zone-active-toggle"><input type="checkbox" checked={zoneForm.active !== false} onChange={(event) => setZoneForm((current) => ({ ...current, active: event.target.checked }))} /><span>Zona activa</span></label>
          {zoneError ? <Toast tone="error">{zoneError}</Toast> : null}
        </div>
      </Modal>
    </div>
  );
}
''')

# Firestore: editing a phone may create the new deterministic customer ID; customer audit has no location.
rules = read("firestore.rules")
rules = rules.replace('      allow create: if (canModule("loyal-customers", "create") && ownsNewRecord())\n        || sellerCustomerCreate(customerId);', '      allow create: if ((canModule("loyal-customers", "create") || canModule("loyal-customers", "edit")) && ownsNewRecord())\n        || sellerCustomerCreate(customerId);')
rules = rules.replace('      allow create: if signedIn()\n        && request.resource.data.userId == request.auth.uid\n        && (isAdmin()\n          || (("locationId" in request.resource.data)\n            && allowedLocation(request.resource.data.locationId)));', '      allow create: if signedIn()\n        && request.resource.data.userId == request.auth.uid\n        && (isAdmin()\n          || (("moduleId" in request.resource.data)\n            && request.resource.data.moduleId == "loyal-customers"\n            && (canModule("loyal-customers", "create") || canModule("loyal-customers", "edit")))\n          || (("locationId" in request.resource.data)\n            && allowedLocation(request.resource.data.locationId)));')
write("firestore.rules", rules)

# CSS: portal popovers, compact header controls, semantic activity and smoother transitions.
perf = read("src/styles/performance-optimizations.css")
perf += r'''

/* Etapa administrador: continuidad visual, popovers portales y controles compactos. */
.fm-anchored-popover {
  z-index: 120;
  max-width: calc(100vw - 16px);
  border: 1px solid var(--fm-border);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 18px 42px rgb(36 23 13 / 18%);
  color: var(--fm-text);
}

.fm-connection-trigger {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--fm-success-border);
  border-radius: 999px;
  background: var(--fm-success-bg);
  padding: 0 10px;
  color: var(--fm-success);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}
.fm-connection-trigger.is-offline { border-color: var(--fm-warning-border); background: var(--fm-warning-bg); color: var(--fm-warning); }
.fm-connection-trigger.is-reconnecting { border-color: var(--fm-border); background: var(--fm-surface-cream); color: var(--fm-text-accent); }
.fm-connection-trigger > svg { width: 14px; height: 14px; flex: none; }
.fm-connection-trigger.is-reconnecting > svg { animation: fm-spin .8s linear infinite; }
.fm-connection-popover { display: grid; width: min(300px, calc(100vw - 16px)); gap: 12px; padding: 14px; }
.fm-connection-popover__head { display: flex; align-items: center; gap: 10px; }
.fm-connection-popover__head > div { display: grid; gap: 1px; }
.fm-connection-popover__head small { color: var(--fm-text-muted); font-size: 9px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
.fm-connection-popover__icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: var(--fm-success-bg); color: var(--fm-success); }
.fm-connection-popover__icon.is-offline { background: var(--fm-warning-bg); color: var(--fm-warning); }
.fm-connection-popover__icon.is-reconnecting { background: var(--fm-surface-cream); color: var(--fm-text-accent); }
.fm-connection-popover__icon svg { width: 17px; height: 17px; }
.fm-connection-popover__icon.is-reconnecting svg { animation: fm-spin .8s linear infinite; }
.fm-connection-popover > p { margin: 0; color: var(--fm-text-muted); font-size: 11px; }
.fm-connection-popover .fm-button { justify-self: stretch; }
.fm-connection-popover__message { border-top: 1px solid var(--fm-border-subtle); padding-top: 9px; color: var(--fm-text-secondary) !important; }

.fm-profile-button { min-height: 46px; border: 0; border-radius: 10px; background: transparent; padding: 0; cursor: pointer; color: inherit; }
.fm-profile-button:hover { background: var(--fm-surface-cream); }
.fm-profile-button:focus-visible { outline: 3px solid rgb(184 138 45 / 28%); outline-offset: 2px; }
.fm-profile-button .fm-profile-trigger { min-height: 46px; }
.fm-profile-popover { width: min(245px, calc(100vw - 16px)); padding: 0; overflow: hidden; }
.fm-profile-popover .fm-profile-menu { padding: 7px; }
.fm-profile-popover .fm-profile-menu a,
.fm-profile-popover .fm-profile-menu button { width: 100%; }

.fm-dashboard-activity-actions { display: flex; align-items: center; gap: 8px; }
.fm-dashboard-activity-actions select { max-width: 210px; min-height: 38px; border: 1px solid var(--fm-border); border-radius: 9px; background: #fff; padding: 0 30px 0 9px; color: var(--fm-text-secondary); font-size: 10px; }
.fm-activity-cell { display: flex; align-items: center; gap: 10px; min-width: 220px; }
.fm-activity-cell > span:last-child { min-width: 0; }
.fm-activity-list__icon.is-gold { background: var(--fm-gold-pale); color: var(--fm-text-accent); }
.fm-activity-list__icon.is-olive { background: var(--fm-success-bg); color: var(--fm-success); }
.fm-activity-list__icon.is-error { background: var(--fm-error-bg); color: var(--fm-error); }
.fm-activity-list__icon.is-warning { background: var(--fm-warning-bg); color: var(--fm-warning); }
.fm-activity-list__icon.is-info { background: var(--fm-info-bg); color: var(--fm-info); }
.fm-activity-list__icon.is-neutral { background: var(--fm-bg-muted); color: var(--fm-text-secondary); }

.fm-management-main > .fm-module-transition { min-height: calc(100dvh - var(--fm-header-height) - 40px); padding: 12px 0; }
.fm-page-enter { animation-duration: 160ms; }
@keyframes fm-page-enter { from { opacity: .72; transform: translateY(3px); } }

@media (max-width: 767px) {
  .fm-management-header__actions { gap: 6px; }
  .fm-connection-trigger { min-height: 34px; padding-inline: 8px; font-size: 10px; }
  .fm-profile-button .fm-profile-trigger > span:nth-child(2),
  .fm-profile-button .fm-profile-trigger > svg { display: none; }
  .fm-profile-button .fm-profile-trigger { min-height: 42px; padding: 2px 4px; }
  .fm-dashboard-activity-actions { width: 100%; flex-wrap: wrap; }
  .fm-dashboard-activity-actions label { flex: 1 1 150px; }
  .fm-dashboard-activity-actions select { width: 100%; max-width: none; }
}

@media (max-width: 479px) {
  .fm-management-header { overflow: visible; }
  .fm-management-header__actions { flex: none; }
  .fm-connection-trigger { gap: 4px; padding-inline: 7px; }
  .fm-connection-trigger span { max-width: 66px; overflow: hidden; text-overflow: ellipsis; }
  .fm-profile-button .fm-avatar { width: 36px; height: 36px; }
}
'''
write("src/styles/performance-optimizations.css", perf)

customers_css = read("src/styles/seller-customers.css")
customers_css += r'''

/* Clientes Fidelizados: detalle, edición y WhatsApp sin perder la tarjeta completa. */
.fm-customer-card { position: relative; transition: border-color var(--fm-duration-fast), box-shadow var(--fm-duration-fast), transform var(--fm-duration-fast); }
.fm-customer-card:hover,
.fm-customer-card:focus-within { border-color: var(--fm-border-accent); box-shadow: var(--fm-shadow-sm); transform: translateY(-1px); }
.fm-customer-card__open { position: absolute; z-index: 1; inset: 0; width: 100%; border: 0; border-radius: inherit; background: transparent; cursor: pointer; }
.fm-customer-card__open:focus-visible { outline: 3px solid rgb(184 138 45 / 28%); outline-offset: 2px; }
.fm-customer-card__identity,
.fm-customer-card > .fm-badge { position: relative; z-index: 0; pointer-events: none; }
.fm-customer-phone-link { position: relative; z-index: 2; display: inline-flex; width: fit-content; min-height: 40px; align-items: center; gap: 6px; color: var(--fm-text-accent); text-decoration: none; pointer-events: auto; }
.fm-customer-phone-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.fm-customer-phone-link:focus-visible { outline: 3px solid rgb(184 138 45 / 28%); outline-offset: 2px; border-radius: 6px; }
.fm-customer-phone-link svg { width: 15px !important; height: 15px !important; }

.fm-customer-detail { display: grid; gap: 18px; }
.fm-customer-detail__hero { display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--fm-border-subtle); padding-bottom: 14px; }
.fm-customer-detail__hero > div { display: grid; gap: 2px; }
.fm-customer-detail__hero small { color: var(--fm-text-muted); font-size: .7rem; }
.fm-customer-detail__hero strong { font-family: var(--fm-font-display); font-size: 1.35rem; }
.fm-customer-detail dl { display: grid; gap: 0; margin: 0; }
.fm-customer-detail dl > div { display: grid; grid-template-columns: minmax(120px, .4fr) 1fr; align-items: center; gap: 12px; min-height: 48px; border-bottom: 1px solid var(--fm-border-subtle); }
.fm-customer-detail dl > div:last-child { border-bottom: 0; }
.fm-customer-detail dt { color: var(--fm-text-muted); font-size: .72rem; font-weight: 700; }
.fm-customer-detail dd { margin: 0; color: var(--fm-text); font-size: .85rem; }
.fm-customer-detail dd a { display: inline-flex; min-height: 40px; align-items: center; gap: 7px; color: var(--fm-text-accent); font-weight: 700; text-decoration: none; }
.fm-customer-detail dd a:hover { text-decoration: underline; }
.fm-customer-detail dd a svg { width: 16px; height: 16px; }
.fm-customer-detail-form { min-width: min(480px, 76vw); }

@media (max-width: 640px) {
  .fm-customer-card { align-items: flex-start; }
  .fm-customer-card__identity { flex: 1; }
  .fm-customer-phone-link { min-height: 44px; }
  .fm-customer-detail-form { min-width: 0; }
  .fm-customer-detail dl > div { grid-template-columns: 1fr; gap: 3px; padding: 9px 0; }
  .fm-customer-detail dd a { min-height: 44px; }
}
'''
write("src/styles/seller-customers.css", customers_css)

# Tests: phone formatting/WhatsApp and structural regression coverage.
test_domain = read("tests/customer-domain.test.mjs")
test_domain = test_domain.replace('  buildCustomerDraft,\n  customerDocumentId,', '  buildCustomerDraft,\n  customerDocumentId,\n  customerWhatsAppUrl,\n  formatPhoneForDisplay,')
test_domain += r'''

test("el teléfono CABA se muestra legible sin alterar la normalización", () => {
  assert.equal(formatPhoneForDisplay("1157571979"), "11-5757-1979");
  assert.equal(formatPhoneForDisplay("+54 9 11 5757-1979"), "11-5757-1979");
  assert.equal(normalizeCustomerPhone("11-5757-1979"), "1157571979");
});

test("otros teléfonos conservan todos sus dígitos en el formato visible", () => {
  const normalized = normalizeCustomerPhone("261 555-1234");
  assert.equal(formatPhoneForDisplay(normalized).replace(/\D/g, ""), normalized);
});

test("WhatsApp usa numeración internacional sin guiones ni datos adicionales", () => {
  assert.equal(customerWhatsAppUrl("11-5757-1979"), "https://wa.me/5491157571979");
  assert.doesNotMatch(customerWhatsAppUrl("11-5757-1979"), /[-?&]/);
});
'''
write("tests/customer-domain.test.mjs", test_domain)

write("tests/activity-presentation.test.mjs", r'''
import test from "node:test";
import assert from "node:assert/strict";
import { getActivityPresentation, getActivityTypeGroups } from "../src/gestion/activity/activityPresentation.js";

test("las actividades reales reciben iconos semánticos consistentes", () => {
  assert.equal(getActivityPresentation("sale.created").icon, "ReceiptText");
  assert.equal(getActivityPresentation("sale.cancelled").icon, "RotateCcw");
  assert.equal(getActivityPresentation("stock.add").icon, "PackagePlus");
  assert.equal(getActivityPresentation("product.updatedFromLocation").icon, "PackageCheck");
  assert.equal(getActivityPresentation("customer.updated").icon, "UserRoundCheck");
});

test("un tipo desconocido conserva un fallback legible", () => {
  const presentation = getActivityPresentation({ action: "future.event", title: "Evento futuro" });
  assert.equal(presentation.icon, "Activity");
  assert.equal(presentation.label, "Evento futuro");
});

test("el selector agrupa tipos por módulo semántico", () => {
  const groups = getActivityTypeGroups([{ action: "future.event", title: "Evento futuro" }]);
  assert.ok(groups.find((group) => group.label === "Ventas")?.options.some((item) => item.value === "sale.created"));
  assert.ok(groups.find((group) => group.label === "Clientes")?.options.some((item) => item.value === "customer.updated"));
  assert.ok(groups.find((group) => group.label === "Otros")?.options.some((item) => item.value === "future.event"));
});
''')

write("tests/admin-experience.test.mjs", r'''
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const shell = read("src/gestion/ManagementShell.jsx");
const connection = read("src/gestion/components/ConnectionIndicator.jsx");
const popover = read("src/gestion/components/AnchoredPopover.jsx");
const activity = read("src/gestion/pages/ActivityPage.jsx");
const dashboard = read("src/gestion/pages/DashboardPage.jsx");
const customers = read("src/gestion/pages/LoyalCustomersPage.jsx");
const customerService = read("src/gestion/services/customerService.js");
const rules = read("firestore.rules");

test("header usa un solo chevron de perfil y popovers portales", () => {
  assert.doesNotMatch(shell, /<Dropdown/);
  assert.match(shell, /className="fm-profile-button"/);
  assert.match(shell, /<Icon name="ChevronDown" \/>/);
  assert.equal((shell.match(/<Icon name="ChevronDown" \/>/g) || []).length, 1);
  assert.match(popover, /createPortal/);
  assert.match(popover, /document\.body/);
  assert.match(popover, /event\.key !== "Escape"/);
});

test("conexión es global, compacta, accesible y permite reconectar", () => {
  assert.match(connection, /useConnectionStatus\(\)/);
  assert.match(connection, /aria-expanded=\{open\}/);
  assert.match(connection, /navigator\.onLine/);
  assert.match(connection, /reconnectFirestore\(profile\.id\)/);
  assert.match(connection, /Conexión restablecida\./);
});

test("actividad comparte presentación y mantiene paginación", () => {
  assert.match(activity, /getActivityPresentation/);
  assert.match(activity, /Filtrar por tipo de actividad/);
  assert.match(dashboard, /getActivityPresentation/);
  assert.match(dashboard, /activityType/);
  assert.match(activity, /Cargar más actividad/);
});

test("clientes abren detalle, editan transaccionalmente y WhatsApp no usa el formato visual", () => {
  assert.match(customers, /Detalle del cliente/);
  assert.match(customers, /updateCustomerFromAdmin/);
  assert.match(customers, /customerWhatsAppUrl/);
  assert.match(customers, /rel="noopener noreferrer"/);
  assert.match(customers, /event\.stopPropagation\(\)/);
  assert.match(customerService, /runTransaction/);
  assert.match(customerService, /Ya existe otro cliente con ese teléfono/);
  assert.match(customerService, /movedToCustomerId/);
  assert.match(customerService, /action: "customer\.updated"/);
});

test("reglas permiten migración de ID al editar y auditoría de clientes", () => {
  assert.match(rules, /canModule\("loyal-customers", "create"\) \|\| canModule\("loyal-customers", "edit"\)/);
  assert.match(rules, /request\.resource\.data\.moduleId == "loyal-customers"/);
});
''')

print("Aplicación de cambios completada")
