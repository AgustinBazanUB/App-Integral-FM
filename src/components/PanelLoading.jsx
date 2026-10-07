export default function PanelLoading({ panel = "plataforma" }) {
  return <main id="main-content" className="fm-panel-loading" aria-live="polite" style={{ position: "fixed", inset: 0, zIndex: 100, width: "100%", minHeight: "100dvh", margin: 0, display: "grid", placeContent: "center", justifyItems: "center", gap: 18, padding: 24, background: "#fff", color: "#403a34" }}>
    <img src="/images/flor-mia/logo-flor-mia.svg" alt="Flor Mía" width="150" height="90" />
    <p role="status">{panel === "plataforma" ? "Cargando plataforma" : `Cargando panel ${panel}…`}</p>
  </main>;
}
