import ManagementApp from "../gestion/ManagementApp";
import { lazy, Suspense } from "react";
import { useLocation } from "../router";
const ShippingPublicApp = lazy(() => import("../gestion/shipping/ShippingPublicApp"));

export default function ManagementSurface() {
  const location = useLocation();
  if (/^\/(e\/[^/]+|reparto|seguimiento)\/?$/.test(location.pathname)) return <Suspense fallback={<p>Cargando envío…</p>}><ShippingPublicApp /></Suspense>;
  return <ManagementApp />;
}
