import { Badge, PageHeader, Panel } from "../../design-system";
import { firebaseConfig } from "../services/firebase";

export default function SettingsPage() {
  const rows = [
    ["Proyecto Firebase", firebaseConfig.projectId, "Conectado"],
    ["Autenticación", "Email y contraseña", "Configurado"],
    ["Esquema de datos", "Base separada + copia legacy verificada", "Configurado"],
    ["Pagos online", "Proveedor pendiente", "No integrado"],
    ["Facturación ARCA", "Backend seguro pendiente", "No integrado"],
    ["Canales sociales", "Carga manual y enlaces directos", "Primera versión"],
  ];
  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Capa transversal" title="Configuración" description="Estado honesto de servicios e integraciones, sin credenciales privadas en el navegador." />
      <Panel title="Servicios de la plataforma" description="Las integraciones pendientes están preparadas pero no simulan operaciones reales.">
        <div className="fm-settings-list">
          {rows.map(([label, value, status]) => <div key={label}><div><strong>{label}</strong><span>{value}</span></div><Badge tone={status === "Conectado" || status === "Configurado" ? "success" : status === "No integrado" ? "warning" : "neutral"}>{status}</Badge></div>)}
        </div>
      </Panel>
    </div>
  );
}

