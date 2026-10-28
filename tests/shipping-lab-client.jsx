import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, useLocation } from "../src/router";
import ManagementShell from "../src/gestion/ManagementShell";
import ShippingPage from "../src/gestion/pages/ShippingPage";
import QuickSalesPage from "../src/gestion/pages/QuickSalesPage";
import SellerPanel from "../src/gestion/seller/SellerPanel";
import ShippingPublicApp from "../src/gestion/shipping/ShippingPublicApp";
import { labProfile } from "lab:firebase";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "../src/styles.css";
import "../src/styles-v3.css";
import "../src/styles-responsive-mobile.css";
import "../src/styles/tokens.css";
import "../src/styles/theme.css";
import "../src/styles/management.css";
import "../src/styles/location-enhancements.css";
import "../src/styles/seller-panel.css";
import "../src/styles/seller-stage2.css";
import "../src/styles/seller-stage2-mobile.css";
import "../src/styles/responsive.css";
import "../src/styles/seller-customers.css";
import "../src/styles/inventory.css";
import "../src/styles/scrollbars.css";
import "../src/styles/seller-compact.css";
import "../src/styles/seller-pos.css";
import "./shipping-lab.css";

function Guide({ state }) {
  return <main className="shipping-lab-guide"><h1>Probemos los envíos</h1><p>Este laboratorio usa los componentes y el motor logístico de la aplicación, con sesiones de prueba y Firestore emulado. No envía facturas, WhatsApp ni pedidos reales.</p>
    <ol><li><a href="/gestion/quick-sales?qaRole=admin">Venta Rápida</a>: canal WhatsApp, origen Local Valle, 2 unidades de Aceite de prueba, cliente con nombre/teléfono, envío Manual y preparador Preparación QA. Confirmar con Continuar. Valle debe pasar de 10 a 8.</li><li><a href="/vendedor?qaRole=seller">Panel Vendedor</a>: venta de 2 unidades con envío. Al registrar, Valle sigue en 8 e Infal en 20. Queda una solicitud.</li><li><a href="/gestion/shipping?qaRole=admin">Solicitudes del vendedor</a>: aprobar salida desde Depósito Infal, preparador Preparación QA y transporte Repositorio. Infal debe pasar de 20 a 18; la venta sigue atribuida a Valle.</li><li><a href="/vendedor?view=shipping-tasks&qaRole=preparer">Preparación</a>: seleccionar pedidos, generar un PDF A4 y abrir preparación por QR para confirmar listo o reportar un problema.</li><li>En la ficha administrativa, autorizar repartidor y abrir su enlace. Manual: retirar y entregar. Repositorio: retirar, llegar al repositorio y salir con un segundo permiso para el tramo final.</li><li>Sin geocerca configurada, entregar debe bloquearse. Administración autoriza una excepción con motivo; el repartidor confirma la entrega una sola vez. El stock no vuelve a cambiar.</li></ol>
    {state && <pre>{JSON.stringify({ stock: state.stock, sales: state.sales.length, shipments: state.shipments.map(row => ({ code: row.publicCode, status: row.status, commercial: row.commercialLocationName, stockOrigin: row.stockOriginName })), movements: state.movements.length, fiscalCalls: state.fiscalCalls }, null, 2)}</pre>}
  </main>;
}
function Lab() {
  const location = useLocation(), [state, setState] = useState(null), [error, setError] = useState("");
  useEffect(() => { const load = () => fetch("/__lab/state").then(async response => { const data = await response.json(); if (!response.ok || !data.stock) throw Error(data.message || "Actualizando el emulador…"); return data; }).then(data => { setState(data); setError(""); }).catch(error => setError(error.message)); load(); const timer = setInterval(load, 3000); return () => clearInterval(timer); }, []);
  const publicPath = /^\/(e\/|reparto|seguimiento)/.test(location.pathname), sellerPath = location.pathname.startsWith("/vendedor");
  const page = location.pathname === "/gestion/shipping" ? <ShippingPage /> : location.pathname === "/gestion/quick-sales" ? <QuickSalesPage /> : <Guide state={state} />;
  return <><header className="shipping-lab-strip"><div><strong>LABORATORIO LOCAL</strong><span>Firestore emulado · Sin ARCA ni envíos reales · {labProfile.name}</span></div><nav aria-label="Controles de prueba"><a href="/gestion/shipping?qaRole=admin">Administrador</a><a href="/vendedor?qaRole=seller">Vendedor</a><a href="/vendedor?view=shipping-tasks&qaRole=preparer">Preparador</a><a href="/__lab/guia">Guía y stock</a><button onClick={async () => { await fetch("/__lab/reset", { method: "POST" }); sessionStorage.clear(); window.location.assign("/gestion/shipping?qaRole=admin"); }}>Reiniciar datos de prueba</button></nav><small data-testid="lab-stock">Valle: {state?.stock.valle ?? "…"} · Infal: {state?.stock.infal ?? "…"} · Ventas: {state?.sales.length ?? 0} · Envíos: {state?.shipments.length ?? 0}</small>{error && <span role="alert">{error}</span>}</header><div className="shipping-lab-app">{publicPath ? <ShippingPublicApp /> : sellerPath ? <SellerPanel /> : <ManagementShell>{page}</ManagementShell>}</div></>;
}
document.body.classList.add("fm-management-body");
createRoot(document.getElementById("root")).render(<RouterProvider><Lab /></RouterProvider>);
