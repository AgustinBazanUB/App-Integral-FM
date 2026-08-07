import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dropdown,
  IconButton,
  SearchInput,
} from "../design-system";
import { Link, useLocation } from "../router";
import { useAuth } from "./AuthContext";
import ConnectionIndicator from "./components/ConnectionIndicator";
import { Icon } from "./components/icons";
import { useConnectionStatus } from "./hooks";
import {
  getManagementPath,
  managementRoutes,
  moduleById,
} from "./modules";
import {
  canAccessManagementRoute,
  canAccessSellerPanel,
  normalizedRole,
} from "./permissions";

const roleLabels = {
  admin: "Administrador general",
  operational_admin: "Administrador operativo",
  seller: "Vendedor",
  location_manager: "Encargado de ubicación",
  warehouse_manager: "Responsable de depósito",
  marketing_manager: "Responsable de marketing",
  ecommerce_manager: "Responsable de ecommerce",
  shipping_manager: "Responsable de envíos",
  supplier_manager: "Responsable de proveedores",
  financial_manager: "Responsable financiero",
  analyst: "Analista de métricas",
};

const routeIdFromPath = (pathname) =>
  pathname.split("/").filter(Boolean)[1] || "dashboard";

const preloadSeller = () => import("./seller/SellerPanel").catch(() => {});

export default function ManagementShell({ children }) {
  const { profile, logout } = useAuth();
  const location = useLocation();
  const connectionStatus = useConnectionStatus();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const mobileCloseRef = useRef(null);
  const activeId = routeIdFromPath(location.pathname);
  const availableRoutes = useMemo(
    () => managementRoutes.filter((route) => canAccessManagementRoute(profile, route.id)),
    [profile],
  );
  const searchResults = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return term
      ? availableRoutes.filter((route) =>
          `${route.label} ${route.description || ""}`.toLocaleLowerCase("es").includes(term),
        )
      : [];
  }, [availableRoutes, search]);

  useEffect(() => {
    setDrawerOpen(false);
    setSearch("");
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    document.body.classList.add("fm-management-body");
    return () => document.body.classList.remove("fm-management-body");
  }, []);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previous = document.activeElement;
    const frame = window.requestAnimationFrame(() => mobileCloseRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      window.requestAnimationFrame(() => previous?.focus?.());
    };
  }, [drawerOpen]);

  const renderNavigation = () => (
    <>
      <div className="fm-sidebar__brand">
        <Link to="/gestion" aria-label="Flor Mía Gestión - Panel">
          <img src="/images/flor-mia/logo-flor-mia.svg" alt="" width="126" height="78" />
        </Link>
        <span>Gestión integral</span>
      </div>
      <nav className="fm-sidebar__nav" aria-label="Módulos de gestión">
        <p className="fm-sidebar__section-label">Plataforma</p>
        {availableRoutes.map((route) => {
          const isSystem = ["administration", "audit", "settings"].includes(route.id);
          const module = moduleById[route.id];
          return (
            <Link
              key={route.id}
              className={`fm-sidebar__link ${activeId === route.id ? "is-active" : ""} ${isSystem ? "is-system" : ""}`}
              to={getManagementPath(route.id)}
              aria-current={activeId === route.id ? "page" : undefined}
              title={collapsed ? route.label : undefined}
            >
              <Icon name={route.icon || module?.icon} />
              <span>{route.label}</span>
              {route.id === "alerts" ? <span className="fm-sidebar__dot" aria-label="Revisar alertas" /> : null}
            </Link>
          );
        })}
      </nav>
      <div className="fm-sidebar__footer">
        <div className="fm-sidebar__botanical" aria-hidden="true">
          <svg viewBox="0 0 240 100"><path d="M8 88c38-37 77-37 115 0m-92 0c28-52 62-68 99-48m-16 7c4-25 18-38 42-40m-30 53c22-28 48-34 78-18m-79 18c6-18 6-34-1-49" /></svg>
        </div>
        {normalizedRole(profile) === "admin" ? (
          <Link to="/tienda" target="_blank" rel="noreferrer" className="fm-sidebar__public-link">
            <Icon name="Store" /><span>Ver tienda pública</span>
          </Link>
        ) : null}
      </div>
    </>
  );

  return (
    <div className={`fm-app-shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="fm-sidebar">{renderNavigation()}</aside>
      {drawerOpen ? (
        <div className="fm-mobile-sidebar-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDrawerOpen(false)}>
          <aside className="fm-mobile-sidebar" role="dialog" aria-modal="true" aria-label="Navegación">
            <IconButton ref={mobileCloseRef} label="Cerrar menú" icon="X" className="fm-mobile-sidebar__close" onClick={() => setDrawerOpen(false)} />
            {renderNavigation()}
          </aside>
        </div>
      ) : null}

      <header className="fm-management-header">
        <div className="fm-management-header__leading">
          <IconButton label="Abrir menú" icon="Menu" className="fm-mobile-menu-trigger" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)} />
          <IconButton label={collapsed ? "Expandir barra lateral" : "Contraer barra lateral"} icon={collapsed ? "PanelLeftOpen" : "PanelLeftClose"} className="fm-collapse-trigger" onClick={() => setCollapsed((value) => !value)} />
          <div className="fm-global-search">
            <SearchInput ref={searchRef} label="Buscar módulos y acciones" value={search} onChange={(event) => setSearch(event.target.value)} />
            {searchResults.length ? (
              <div className="fm-global-search__results">
                {searchResults.map((route) => <Link key={route.id} to={getManagementPath(route.id)}><Icon name={route.icon || moduleById[route.id]?.icon} /><span>{route.label}</span></Link>)}
              </div>
            ) : null}
          </div>
        </div>
        <div className="fm-management-header__actions">
          <ConnectionIndicator />
          <Dropdown label={<span className="fm-profile-trigger"><span className="fm-avatar">{(profile.name || profile.email || "F").slice(0, 1).toUpperCase()}</span><span><strong>{profile.name || "Usuario"}</strong><small>{roleLabels[normalizedRole(profile)] || normalizedRole(profile)}</small></span><Icon name="ChevronDown" /></span>}>
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
          </Dropdown>
        </div>
      </header>

      <main className="fm-management-main" id="main-content">
        {children}
      </main>
      <div className="fm-live-region" aria-live="polite">
        {connectionStatus === "online" ? "Conexión disponible" : connectionStatus === "reconnecting" ? "Reconectando con Firestore" : "Sin conexión. Las ventas offline pueden quedar pendientes hasta recuperar la red."}
      </div>
    </div>
  );
}
