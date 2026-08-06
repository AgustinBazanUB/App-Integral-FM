import { useEffect } from "react";
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
import AdministrationPage from "./pages/AdministrationPage";
import ActivityPage from "./pages/ActivityPage";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import GenericModulePage from "./pages/GenericModulePage";
import LocationsPage from "./pages/LocationsPage";
import LocationDetailPage from "./pages/LocationDetailPage";
import LoginPage from "./pages/LoginPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";
import QuickSalesPage from "./pages/QuickSalesPage";
import SalesMetricsPage from "./pages/SalesMetricsPage";
import SettingsPage from "./pages/SettingsPage";
import SellerPanel from "./seller/SellerPanel";

const routeIdFromPath = (pathname) =>
  pathname.split("/").filter(Boolean)[1] || "dashboard";

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
    return canAccessSellerPanel(profile) ? <SellerPanel /> : <NotAuthorizedPage />;
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

  return <ManagementShell>{page}</ManagementShell>;
}

export default function ManagementApp() {
  return <AuthProvider><ManagementRouter /></AuthProvider>;
}
