import { Component, lazy, Suspense, useEffect } from "react";
import { Skeleton } from "../design-system";
import { useLocation, useNavigate } from "../router";
import { AuthProvider, useAuth } from "./AuthContext";
import ManagementShell from "./ManagementShell";
import { moduleById, SALES_METRICS_PATH } from "./modules";
import {
  canAccessAdminPanel,
  canAccessManagementRoute,
  canAccessSellerPanel,
  isPureSeller,
} from "./permissions";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";
import SellerPanel from "./seller/SellerPanel";
import {
  listLocationsShared,
  loadSellerResourcesShared,
} from "./services/sharedResources";

const AdministrationPage = lazy(() => import("./pages/AdministrationPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const GenericModulePage = lazy(() => import("./pages/GenericModulePage"));
const LoyalCustomersPage = lazy(() => import("./pages/LoyalCustomersPage"));
const LocationsPage = lazy(() => import("./pages/LocationsPage"));
const LocationDetailPage = lazy(() => import("./pages/LocationDetailPage"));
const QuickSalesPage = lazy(() => import("./pages/QuickSalesPage"));
const SalesMetricsPage = lazy(() => import("./pages/SalesMetricsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const routeIdFromPath = (pathname) =>
  pathname.split("/").filter(Boolean)[1] || "dashboard";

function ModuleFallback() {
  return (
    <main className="fm-module-transition" aria-live="polite">
      <Skeleton lines={5} />
      <span className="sr-only">Preparando módulo</span>
    </main>
  );
}

class ManagementErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Error no controlado en gestión", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main id="main-content" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f7f3ec" }}>
        <section style={{ width: "min(560px, 100%)", border: "1px solid #e5dccd", borderRadius: 16, background: "#fff", padding: 24, boxShadow: "0 18px 50px rgb(70 54 29 / 10%)" }}>
          <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" width="112" height="64" />
          <h1 style={{ margin: "14px 0 8px" }}>No pudimos abrir este panel</h1>
          <p style={{ margin: "0 0 18px", color: "#6f675e" }}>La aplicación sigue disponible. Podés volver al panel administrador o recargar esta versión.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button type="button" onClick={() => window.location.assign("/gestion")} style={{ minHeight: 44, border: 0, borderRadius: 10, padding: "0 16px", cursor: "pointer", background: "#b8892d", color: "#fff", fontWeight: 700 }}>Volver al administrador</button>
            <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 44, border: "1px solid #ded5c6", borderRadius: 10, padding: "0 16px", cursor: "pointer", background: "#fff", color: "#403a34", fontWeight: 700 }}>Recargar</button>
          </div>
        </section>
      </main>
    );
  }
}

function ManagementRouter() {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, profile, error } = useAuth();
  const routeId = routeIdFromPath(location.pathname);
  const pathParts = location.pathname.split("/").filter(Boolean);
  const sellerPath =
    location.pathname === "/vendedor" ||
    location.pathname.startsWith("/vendedor/");

  useEffect(() => {
    if (status !== "ready") return;
    if (isPureSeller(profile) && !sellerPath) {
      navigate("/vendedor", { replace: true });
      return;
    }
    if (sellerPath && !canAccessSellerPanel(profile) && canAccessAdminPanel(profile)) {
      navigate("/gestion", { replace: true });
    }
  }, [status, profile, sellerPath, navigate]);

  useEffect(() => {
    if (status !== "ready" || sellerPath || routeId !== "metrics") return;
    if (location.pathname !== SALES_METRICS_PATH) {
      navigate(SALES_METRICS_PATH, { replace: true });
    }
  }, [status, sellerPath, routeId, location.pathname, navigate]);

  // El código del Panel Vendedor forma parte del bundle de gestión para que el
  // cambio Administrador → Vendedor no dependa de descargar otro chunk. Mientras
  // el administrador trabaja, sólo calentamos los datos que el vendedor necesita.
  useEffect(() => {
    if (status !== "ready" || !canAccessSellerPanel(profile) || sellerPath) return undefined;
    let cancelled = false;
    Promise.all([
      listLocationsShared(profile),
      loadSellerResourcesShared(profile),
    ]).catch(() => {
      if (cancelled) return;
    });
    return () => { cancelled = true; };
  }, [status, profile?.id, sellerPath]);

  useEffect(() => {
    if (sellerPath) {
      document.title = "Panel Vendedor | Flor Mía";
      return;
    }
    document.title = routeId === "dashboard"
      ? "Gestión integral | Flor Mía"
      : `${routeId === "actividad" ? "Actividad" : moduleById[routeId]?.label || "Gestión"} | Flor Mía`;
  }, [routeId, sellerPath]);

  if (status === "loading") {
    return <main className="fm-auth-loading" id="main-content"><img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /><Skeleton lines={3} /></main>;
  }
  if (status === "signed-out" || status === "error") {
    return <LoginPage sessionError={status === "error" ? error : null} />;
  }

  if (sellerPath || isPureSeller(profile)) {
    return canAccessSellerPanel(profile)
      ? <SellerPanel />
      : <NotAuthorizedPage />;
  }

  let page;
  if (!canAccessManagementRoute(profile, routeId)) {
    page = <NotAuthorizedPage />;
  } else if (routeId === "dashboard") {
    page = <DashboardPage />;
  } else if (routeId === "locations") {
    page = pathParts[2] ? <LocationDetailPage locationId={decodeURIComponent(pathParts[2])} /> : <LocationsPage />;
  } else if (routeId === "quick-sales") {
    page = <QuickSalesPage />;
  } else if (routeId === "loyal-customers") {
    page = <LoyalCustomersPage />;
  } else if (routeId === "administration") {
    page = <AdministrationPage />;
  } else if (routeId === "audit") {
    page = <AuditPage />;
  } else if (routeId === "actividad") {
    page = <ActivityPage />;
  } else if (routeId === "metrics") {
    page = <SalesMetricsPage />;
  } else if (routeId === "settings") {
    page = <SettingsPage />;
  } else if (moduleById[routeId]) {
    page = <GenericModulePage moduleId={routeId} />;
  } else {
    page = <NotAuthorizedPage />;
  }

  return (
    <ManagementShell>
      <Suspense fallback={<ModuleFallback />}>{page}</Suspense>
    </ManagementShell>
  );
}

export default function ManagementApp() {
  return (
    <AuthProvider>
      <ManagementErrorBoundary>
        <ManagementRouter />
      </ManagementErrorBoundary>
    </AuthProvider>
  );
}
