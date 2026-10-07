import { lazy, Suspense } from "react";
import { useLocation } from "./router";
import PanelLoading from "./components/PanelLoading";

const ManagementApp = lazy(() => import("./gestion/ManagementApp"));
const Storefront = lazy(() => import("./Storefront"));

function AppShellFallback() {
  const { pathname } = useLocation();
  return <PanelLoading panel={pathname === "/vendedor" || pathname.startsWith("/vendedor/") ? "vendedor" : "plataforma"} />;
}

export default function App() {
  const location = useLocation();
  const surface = import.meta.env.VITE_APP_SURFACE || "unified";
  const isPrivatePath =
    location.pathname === "/" ||
    location.pathname === "/gestion" ||
    location.pathname.startsWith("/gestion/") ||
    location.pathname === "/vendedor" ||
    location.pathname.startsWith("/vendedor/");

  if (surface === "gestion") {
    return (
      <Suspense fallback={<AppShellFallback />}>
        <ManagementApp />
      </Suspense>
    );
  }

  if (surface === "ecommerce") {
    return (
      <Suspense fallback={<AppShellFallback />}>
        <Storefront />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AppShellFallback />}>
      {isPrivatePath ? <ManagementApp /> : <Storefront />}
    </Suspense>
  );
}
