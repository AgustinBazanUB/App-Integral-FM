import { lazy, Suspense } from "react";
import { useLocation } from "./router";

const ManagementApp = lazy(() => import("./gestion/ManagementApp"));
const Storefront = lazy(() => import("./Storefront"));

function AppShellFallback() {
  return (
    <main className="fm-app-loading" id="main-content" aria-live="polite">
      <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" width="120" height="70" />
      <div className="fm-app-loading__skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="sr-only">Cargando plataforma</span>
    </main>
  );
}

export default function App() {
  const location = useLocation();
  const isPrivatePath =
    location.pathname === "/" ||
    location.pathname === "/gestion" ||
    location.pathname.startsWith("/gestion/") ||
    location.pathname === "/vendedor" ||
    location.pathname.startsWith("/vendedor/");

  return (
    <Suspense fallback={<AppShellFallback />}>
      {isPrivatePath ? <ManagementApp /> : <Storefront />}
    </Suspense>
  );
}
