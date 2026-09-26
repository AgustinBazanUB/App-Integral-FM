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

function stageBadge(stage) {
  if (stage?.status === "ok") return <Badge tone="success">OK</Badge>;
  if (stage?.status === "skipped") return <Badge tone="neutral">Omitido</Badge>;
  if (stage?.status === "error") return <Badge tone="warning">Error</Badge>;
  return <Badge tone="neutral">Pendiente</Badge>;
}

function stageMessage(stage, fallback = "") {
  if (stage?.error) {
    const status = stage.error.status ? `HTTP ${stage.error.status} · ` : "";
    const cause = stage.error.causeCode ? ` · ${stage.error.causeCode}` : "";
    return `${status}${stage.error.code || "error"}${cause} · ${stage.error.message || fallback}`;
  }
  return fallback;
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

  const arcaOperational = arcaState.result?.ok === true;
  const pointOfSale = arcaState.result?.pointOfSale?.data;

  const rows = [
    ["Proyecto Firebase", firebaseConfig.projectId, "Conectado"],
    ["Autenticación", "Email y contraseña", "Configurado"],
    ["Esquema de datos", "Base separada + copia legacy verificada", "Configurado"],
    ["Pagos online", "Proveedor pendiente", "No integrado"],
    [
      "Facturación ARCA",
      arcaOperational
        ? `Homologación · punto ${pointOfSale?.selected}`
        : arcaState.result
          ? "Diagnóstico parcial disponible"
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
          description="Cada comprobación corre de forma independiente. Un 502 de ARCA ya no oculta el estado de Firebase/Firestore. No emite comprobantes ni muestra secretos."
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
                <div>
                  <strong>WSFE</strong>
                  <span>{stageMessage(
                    arcaState.result.wsfe,
                    arcaState.result.wsfe?.data
                      ? `App ${arcaState.result.wsfe.data.appServer} · DB ${arcaState.result.wsfe.data.dbServer} · Auth ${arcaState.result.wsfe.data.authServer}`
                      : "Sin respuesta",
                  )}</span>
                </div>
                {stageBadge(arcaState.result.wsfe)}
              </div>

              <div>
                <div>
                  <strong>Punto de venta</strong>
                  <span>{stageMessage(
                    arcaState.result.pointOfSale,
                    pointOfSale
                      ? `Configurado ${pointOfSale.selected} · devueltos: ${pointOfSale.returned.join(", ") || "ninguno"}`
                      : "Sin respuesta",
                  )}</span>
                </div>
                {stageBadge(arcaState.result.pointOfSale)}
              </div>

              <div>
                <div>
                  <strong>Padrón</strong>
                  <span>{stageMessage(
                    arcaState.result.registry,
                    arcaState.result.registry?.data
                      ? `${arcaState.result.registry.data.endpoint === "official-legacy" ? "Endpoint oficial compatible" : "Endpoint ARCA vigente"} · App ${arcaState.result.registry.data.appServer} · DB ${arcaState.result.registry.data.dbServer} · Auth ${arcaState.result.registry.data.authServer}`
                      : "Sin respuesta",
                  )}</span>
                </div>
                {stageBadge(arcaState.result.registry)}
              </div>

              <div>
                <div>
                  <strong>Firebase Admin OAuth</strong>
                  <span>{stageMessage(
                    arcaState.result.firebaseAdmin?.oauth,
                    arcaState.result.firebaseAdmin?.oauth?.status === "ok"
                      ? "La cuenta de servicio obtuvo token OAuth."
                      : "Sin validar",
                  )}</span>
                </div>
                {stageBadge(arcaState.result.firebaseAdmin?.oauth)}
              </div>

              <div>
                <div>
                  <strong>Firestore server-side</strong>
                  <span>{stageMessage(
                    arcaState.result.firebaseAdmin?.firestoreRead,
                    arcaState.result.firebaseAdmin?.firestoreRead?.status === "ok"
                      ? "Lectura autorizada con la cuenta de servicio."
                      : arcaState.result.firebaseAdmin?.firestoreRead?.status === "skipped"
                        ? "No se probó porque falló OAuth."
                        : "Sin validar",
                  )}</span>
                </div>
                {stageBadge(arcaState.result.firebaseAdmin?.firestoreRead)}
              </div>
            </div>
          ) : (
            <p>Ejecutá el diagnóstico desde Netlify Dev. La prueba no genera CAE ni modifica ventas.</p>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
