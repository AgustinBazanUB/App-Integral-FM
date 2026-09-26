import { useState } from "react";
import { Badge, Button, PageHeader, Panel, Toast } from "../../design-system";
import { useAuth } from "../AuthContext";
import { canAccessAdministration } from "../permissions";
import { runArcaDiagnostics } from "../services/arcaService";
import { firebaseConfig } from "../services/firebase";

function statusTone(status) {
  if (["Conectado", "Configurado", "Operativo"].includes(status)) return "success";
  if (["No integrado", "Error"].includes(status)) return "warning";
  return "neutral";
}

export default function SettingsPage() {
  const { profile } = useAuth();
  const isAdmin = canAccessAdministration(profile);
  const [arcaState, setArcaState] = useState({
    busy: false,
    result: null,
    error: "",
  });

  const runDiagnostic = async () => {
    setArcaState({ busy: true, result: null, error: "" });
    try {
      const result = await runArcaDiagnostics();
      setArcaState({ busy: false, result, error: "" });
    } catch (error) {
      setArcaState({ busy: false, result: null, error: error.message });
    }
  };

  const arcaOperational = Boolean(
    arcaState.result
      && arcaState.result.pointOfSale?.found === true
      && arcaState.result.wsfe?.appServer === "OK"
      && arcaState.result.wsfe?.dbServer === "OK"
      && arcaState.result.wsfe?.authServer === "OK"
      && arcaState.result.registry?.appServer === "OK"
      && arcaState.result.registry?.dbServer === "OK"
      && arcaState.result.registry?.authServer === "OK"
      && arcaState.result.firebaseAdmin?.oauth === "ok"
      && ["ok-document-found", "ok-not-found"].includes(arcaState.result.firebaseAdmin?.firestoreRead),
  );

  const rows = [
    ["Proyecto Firebase", firebaseConfig.projectId, "Conectado"],
    ["Autenticación", "Email y contraseña", "Configurado"],
    ["Esquema de datos", "Base separada + copia legacy verificada", "Configurado"],
    ["Pagos online", "Proveedor pendiente", "No integrado"],
    [
      "Facturación ARCA",
      arcaOperational
        ? `Homologación · punto ${arcaState.result.pointOfSale.selected}`
        : arcaState.error
          ? "La última verificación falló"
          : "Backend de homologación en configuración",
      arcaOperational ? "Operativo" : arcaState.error ? "Error" : "En progreso",
    ],
    ["Canales sociales", "Carga manual y enlaces directos", "Primera versión"],
  ];

  return (
    <div className="fm-page-enter">
      <PageHeader
        eyebrow="Capa transversal"
        title="Configuración"
        description="Estado honesto de servicios e integraciones, sin credenciales privadas en el navegador."
      />

      <Panel
        title="Servicios de la plataforma"
        description="Las integraciones pendientes están preparadas pero no simulan operaciones reales."
      >
        <div className="fm-settings-list">
          {rows.map(([label, value, status]) => (
            <div key={label}>
              <div><strong>{label}</strong><span>{value}</span></div>
              <Badge tone={statusTone(status)}>{status}</Badge>
            </div>
          ))}
        </div>
      </Panel>

      {isAdmin ? (
        <Panel
          title="Diagnóstico ARCA"
          description="Comprueba homologación, punto de venta, Padrón y acceso server-only a Firestore. No emite comprobantes ni muestra secretos."
          action={(
            <Button
              variant="secondary"
              loading={arcaState.busy}
              onClick={runDiagnostic}
            >
              Probar conexión ARCA
            </Button>
          )}
        >
          {arcaState.error ? <Toast tone="error">{arcaState.error}</Toast> : null}
          {arcaState.result ? (
            <div className="fm-settings-list">
              <div>
                <div><strong>Entorno</strong><span>{arcaState.result.environment}</span></div>
                <Badge tone={arcaState.result.environment === "homologation" ? "success" : "warning"}>
                  {arcaState.result.environment}
                </Badge>
              </div>
              <div>
                <div><strong>WSFE</strong><span>App · DB · Auth</span></div>
                <Badge tone={arcaState.result.wsfe?.appServer === "OK" && arcaState.result.wsfe?.dbServer === "OK" && arcaState.result.wsfe?.authServer === "OK" ? "success" : "warning"}>
                  {arcaState.result.wsfe?.appServer === "OK" && arcaState.result.wsfe?.dbServer === "OK" && arcaState.result.wsfe?.authServer === "OK" ? "OK" : "Revisar"}
                </Badge>
              </div>
              <div>
                <div><strong>Punto de venta</strong><span>{arcaState.result.pointOfSale?.selected ?? "—"}</span></div>
                <Badge tone={arcaState.result.pointOfSale?.found ? "success" : "warning"}>
                  {arcaState.result.pointOfSale?.found ? "Confirmado" : "No encontrado"}
                </Badge>
              </div>
              <div>
                <div><strong>Padrón</strong><span>{arcaState.result.registry?.endpoint === "official-legacy" ? "Endpoint oficial compatible" : "Endpoint ARCA vigente"}</span></div>
                <Badge tone={arcaState.result.registry?.appServer === "OK" ? "success" : "warning"}>
                  {arcaState.result.registry?.appServer === "OK" ? "OK" : "Revisar"}
                </Badge>
              </div>
              <div>
                <div><strong>Firebase backend</strong><span>OAuth + lectura Firestore</span></div>
                <Badge tone={arcaState.result.firebaseAdmin?.oauth === "ok" && ["ok-document-found", "ok-not-found"].includes(arcaState.result.firebaseAdmin?.firestoreRead) ? "success" : "warning"}>
                  {arcaState.result.firebaseAdmin?.oauth === "ok" && ["ok-document-found", "ok-not-found"].includes(arcaState.result.firebaseAdmin?.firestoreRead) ? "OK" : "Revisar"}
                </Badge>
              </div>
            </div>
          ) : (
            <p>Ejecutá el diagnóstico desde el entorno local de Netlify Dev. La prueba no genera CAE ni modifica ventas.</p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
