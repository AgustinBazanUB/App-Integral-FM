import { useEffect } from "react";
import { Skeleton } from "../design-system";
import { useLocation } from "../router";
import { AuthProvider, useAuth } from "./AuthContext";
import ManagementShell from "./ManagementShell";
import { moduleById } from "./modules";
import { canAccessManagementRoute } from "./permissions";
import AdministrationPage from "./pages/AdministrationPage";
import AuditPage from "./pages/AuditPage";
import DashboardPage from "./pages/DashboardPage";
import GenericModulePage from "./pages/GenericModulePage";
import LocationsPage from "./pages/LocationsPage";
import LoginPage from "./pages/LoginPage";
import NotAuthorizedPage from "./pages/NotAuthorizedPage";
import QuickSalesPage from "./pages/QuickSalesPage";
import SettingsPage from "./pages/SettingsPage";

const routeIdFromPath = (pathname) =>
  pathname.split("/").filter(Boolean)[1] || "dashboard";

function ManagementRouter() {
  const location = useLocation();
  const { status, profile, error } = useAuth();
  const routeId = routeIdFromPath(location.pathname);

  useEffect(() => {
    document.title = routeId === "dashboard"
      ? "Gestión integral | Flor Mía"
      : `${moduleById[routeId]?.label || "Gestión"} | Flor Mía`;
  }, [routeId]);

  if (status === "loading") {
    return <main className="fm-auth-loading" id="main-content"><img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" /><Skeleton lines={3} /></main>;
  }
  if (status === "signed-out" || status === "error") {
    return <LoginPage sessionError={status === "error" ? error : null} />;
  }

  let page;
  if (!canAccessManagementRoute(profile, routeId)) {
    page = <NotAuthorizedPage />;
  } else if (routeId === "dashboard") {
    page = <DashboardPage />;
  } else if (routeId === "locations") {
    page = <LocationsPage />;
  } else if (routeId === "quick-sales") {
    page = <QuickSalesPage />;
  } else if (routeId === "administration") {
    page = <AdministrationPage />;
  } else if (routeId === "audit") {
    page = <AuditPage />;
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
