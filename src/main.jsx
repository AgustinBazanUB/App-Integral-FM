import React from "react";
import ReactDOM from "react-dom/client";
import Surface from "@flormia/surface";
import { RouterProvider } from "./router";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";
import "./styles-v3.css";
import "./styles-responsive-mobile.css";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/management.css";
import "./styles/location-enhancements.css";
import "./styles/dashboard-filters.css";
import "./styles/seller-panel.css";
import "./styles/seller-stage2.css";
import "./styles/seller-stage2-mobile.css";
import "./styles/responsive.css";
import "./styles/performance-optimizations.css";
import "./styles/metrics-fixes.css";
import "./styles/seller-customers.css";
import "./styles/customer-import.css";
import "./styles/whatsapp-marketing.css";
import "./styles/inventory.css";
import "./styles/scrollbars.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider>
      <Surface />
    </RouterProvider>
  </React.StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const surface = import.meta.env.VITE_APP_SURFACE || "unified";
    navigator.serviceWorker.register(`/service-worker.js?surface=${surface}`).catch(() => {
      // La app sigue operativa en navegadores que bloquean el service worker.
    });
  });
}
