import { lazy, Suspense, useEffect } from "react";
import { Skeleton } from "../design-system";
import { useLocation, useNavigate } from "../router";
import { AuthProvider, useAuth } from "./AuthContext";
import ManagementShell from "./ManagementShell";
import { moduleById } from "./modules";
import {
  canAccessAdminPanel,
  canAccessManagementRoute,
  canAccessSellerPanel,
  isPureSeller,
} from "./permissions";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";
import { listLocationsShared } from "./services/sharedResources";

const loadSellerPanel = () => import("./seller/SellerPanel");
const SellerPanel = lazy(loadSellerPanel);
const AdministrationPage = lazy(() => import("./pages/AdministrationPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const GenericModulePage = lazy(() => import("./pages/GenericModulePage"));
const LocationsPage = lazy(() => import("./pages/LocationsPage"));
const LocationDetailPage = lazy(() => import("./pages/LocationDetailPage"));
const QuickSalesPage = lazy(() => import("./pages/QuickSalesPage"));
const SalesMetricsPage = lazy(() => import("./pages/SalesMetricsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const routeIdFromPath = (pathname) =>
  pathname.split("/").filter(Boolean)[1] || "dashboard";

const scheduleIdle = (callback) => {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1200 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 250);
  return () => window.clearTimeout(id);
};

function ModuleFallback({ seller = false }) {
  return (
    <main className={seller ? "fm-seller-transition" : "fm-module-transition"} id={seller ? "main-content" : undefined} aria-live="polite">
      {seller ? <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" width="112" height="64" /> : null}
      <Skeleton lines={seller ? 4 : 5} />
      <span className="sr-only">Preparando módulo</span>
    </main>
  );
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
    if (status !== "ready" || !canAccessSellerPanel(profile) || sellerPath) return undefined;
    return scheduleIdle(() => {
      Promise.all([
        loadSellerPanel(),
        listLocationsShared(profile),
      ]).catch(() => {});
    });
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
      ? <Suspense fallback={<ModuleFallback seller />}><SellerPanel /></Suspense>
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
  } else if (routeId === "administration") {
    page = <AdministrationPage />;
  } else if (routeId === "audit") {
    page = <AuditPage />;
  } else if (routeId === "actividad") {
    page = <ActivityPage />;
  } else if (routeId === "metrics" && pathParts[2] === "sales") {
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
  return <AuthProvider><ManagementRouter /></AuthProvider>;
}
