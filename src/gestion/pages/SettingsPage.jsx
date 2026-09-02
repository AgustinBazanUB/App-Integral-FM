import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, PageHeader, Panel, Skeleton, Toast } from "../../design-system";
import { firebaseConfig } from "../services/firebase";
import { useAuth } from "../AuthContext";
import { can } from "../permissions";
import {
  disconnectGoogleDrive,
  getGoogleDriveHealth,
  getGoogleDriveStatus,
  googleDriveFriendlyError,
  startGoogleDriveOAuth,
  testGoogleDriveConnection,
} from "../marketing/metaAds/googleDriveService";
import "../../styles/meta-ads-creative.css";

function connectionBadge(status, configured) {
  if (!configured) return <Badge tone="warning">No configurado</Badge>;
  if (status === "connected") return <Badge tone="success">Conectado</Badge>;
  if (status === "error") return <Badge tone="danger">Necesita reconexión</Badge>;
  return <Badge tone="neutral">Desconectado</Badge>;
}

function queryNotice() {
  if (typeof window === "undefined") return "";
  const value = new URLSearchParams(window.location.search).get("drive");
  if (value === "connected") return "Google Drive quedó conectado correctamente.";
  if (value === "oauth_cancelled") return "Cancelaste la autorización de Google Drive. No se guardaron credenciales nuevas.";
  if (value === "refresh_token_missing") return "Google no devolvió una autorización renovable. Volvé a conectar y aceptá el acceso solicitado.";
  if (value?.startsWith("oauth_") || value?.startsWith("drive-")) return "No pudimos completar la conexión con Google Drive. Podés reintentar desde esta pantalla.";
  return "";
}

function DriveSettings({ profile }) {
  const canView = can(profile, "marketing", "metaAdsViewCreativeWorkspace") || can(profile, "marketing", "metaAdsManageDrive");
  const canManage = can(profile, "marketing", "metaAdsManageDrive");
  const [state, setState] = useState({ status: "loading", connection: null, health: null, error: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(queryNotice());

  const load = async () => {
    if (!canView) return;
    setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const [connection, health] = await Promise.all([getGoogleDriveStatus(), getGoogleDriveHealth()]);
      setState({ status: "ready", connection, health, error: "" });
    } catch (error) {
      setState({ status: "error", connection: null, health: await getGoogleDriveHealth(), error: googleDriveFriendlyError(error) });
    }
  };

  useEffect(() => { load(); }, [profile.id, canView]);
  if (!canView) return null;

  const run = async (fn, success) => {
    setBusy(true); setNotice("");
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (error) { setNotice(googleDriveFriendlyError(error)); }
    finally { setBusy(false); }
  };

  if (state.status === "loading") return <Panel title="Google Drive"><Skeleton lines={5} /></Panel>;
  const connection = state.connection || {};
  const health = state.health || {};
  const configured = health.configured === true && health.firebaseBackendConfigured === true;
  const connected = configured && connection.connected === true;

  return (
    <Panel
      title="Google Drive"
      description="Repositorio de archivos multimedia de Meta Ads. Los videos se suben directamente desde el navegador a Drive; Netlify sólo autoriza y confirma la operación."
      action={connectionBadge(connection.status, configured)}
    >
      <div className="fm-drive-settings">
        {notice ? <Toast>{notice}</Toast> : null}
        {state.error ? <p className="fm-form-error" role="alert">{state.error}</p> : null}

        {!configured ? (
          <EmptyState
            icon="HardDrive"
            title="Google Drive todavía no está configurado"
            description="La aplicación está preparada, pero faltan las variables server-side de Google OAuth y/o la cuenta de servicio Firebase en Netlify. No se simula una conexión."
          />
        ) : (
          <div className="fm-drive-settings__summary">
            <div><span>Estado</span><strong>{connected ? "Conectado" : connection.status === "error" ? "Necesita reconexión" : "Desconectado"}</strong></div>
            <div><span>Cuenta</span><strong>{connection.accountEmail || "Todavía no autorizada"}</strong></div>
            <div><span>Carpeta raíz</span><strong>{connection.rootFolderName || "Meta Ads"}</strong></div>
            <div><span>Modalidad</span><strong>{connection.mode === "shared_drive" ? "Shared Drive" : "My Drive"}</strong></div>
            <div><span>Permiso Google</span><strong>drive.file</strong></div>
            <div><span>Acceso</span><strong>{canManage ? "Podés administrar la conexión" : "Sólo uso del Workspace Creativo"}</strong></div>
          </div>
        )}

        {canManage ? (
          <div className="fm-drive-settings__actions">
            {!connected ? (
              <Button
                icon="Link"
                loading={busy}
                disabled={!configured}
                onClick={async () => {
                  setBusy(true); setNotice("");
                  try {
                    const result = await startGoogleDriveOAuth();
                    window.location.assign(result.authorizationUrl);
                  } catch (error) {
                    setNotice(googleDriveFriendlyError(error));
                    setBusy(false);
                  }
                }}
              >Conectar Google Drive</Button>
            ) : (
              <>
                <Button variant="secondary" loading={busy} onClick={() => run(testGoogleDriveConnection, "La conexión con Google Drive responde correctamente.")}>Probar conexión</Button>
                <Button variant="secondary" loading={busy} onClick={() => run(disconnectGoogleDrive, "Google Drive quedó desconectado. Los archivos existentes no fueron borrados.")}>Desconectar</Button>
              </>
            )}
          </div>
        ) : null}

        <p className="fm-field__hint">La conexión administrativa utiliza OAuth 2.0 server-side. El refresh token se guarda cifrado en una colección inaccesible al navegador; el secreto de cifrado permanece únicamente en variables de entorno.</p>
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  const { profile } = useAuth();
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
      {profile ? <DriveSettings profile={profile} /> : null}
    </div>
  );
}
