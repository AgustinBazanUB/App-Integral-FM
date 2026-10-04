import { useEffect, useRef, useState } from "react";
import { fiscalPresentation } from "../../shared/fiscalRecovery.mjs";
import { Badge, Button, EmptyState, PageHeader, Panel, Skeleton, Toast } from "../../design-system";
import { useAuth } from "../AuthContext";
import OliviaSettings from "../olivia/OliviaSettings";
import { can, canAccessAdministration } from "../permissions";
import {
  authorizeArcaInvoice,
  dryRunArcaInvoice,
  getArcaSafeStatus,
  getArcaWsaaCacheStatus,
  listRecentArcaInvoices,
  reconcileArcaInvoice,
  reviewArcaInvoice,
  recoverPreCaeArcaInvoice,
  runArcaDiagnostics,
  runArcaProductionReadonlyPreflight,
  runArcaWsaaRegistrySharedSmoke,
  runArcaWsaaSharedSmoke,
  verifyAuthorizedArcaInvoice,
} from "../services/arcaService";
import { firebaseConfig } from "../services/firebase";
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
  const fiscalActionRef = useRef(false);
  const { profile } = useAuth();
  const isAdmin = canAccessAdministration(profile);
  const [arcaState, setArcaState] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const [receiverDrafts, setReceiverDrafts] = useState({});
  const [invoiceState, setInvoiceState] = useState({
    busy: false,
    items: [],
    error: "",
    message: "",
    actionId: "",
    dryRuns: {},
  });
  const [arcaConfigState, setArcaConfigState] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const [wsaaCacheState, setWsaaCacheState] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const [wsaaSmokeState, setWsaaSmokeState] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const [registrySmokeState, setRegistrySmokeState] = useState({
    busy: false,
    result: null,
    error: "",
  });
  const [productionPreflightState, setProductionPreflightState] = useState({
    busy: false,
    result: null,
    error: "",
  });

  const loadInvoices = async () => {
    setInvoiceState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      const items = await listRecentArcaInvoices({ pageSize: 25 });
      setInvoiceState((current) => ({ ...current, busy: false, items, error: "" }));
    } catch (error) {
      setInvoiceState((current) => ({ ...current, busy: false, error: error.message }));
    }
  };

  const loadSafeArcaConfig = async () => {
    setArcaConfigState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await getArcaSafeStatus();
      setArcaConfigState({ busy: false, result, error: "" });
    } catch (error) {
      setArcaConfigState({ busy: false, result: null, error: error.message });
    }
  };

  const loadWsaaCacheStatus = async () => {
    setWsaaCacheState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await getArcaWsaaCacheStatus();
      setWsaaCacheState({ busy: false, result, error: "" });
    } catch (error) {
      setWsaaCacheState({ busy: false, result: null, error: error.message });
    }
  };

  const runWsaaSharedSmoke = async () => {
    setWsaaSmokeState({ busy: true, result: null, error: "" });
    try {
      const result = await runArcaWsaaSharedSmoke();
      setWsaaSmokeState({ busy: false, result, error: "" });
      await loadWsaaCacheStatus();
    } catch (error) {
      setWsaaSmokeState({ busy: false, result: null, error: error.message });
    }
  };

  const runRegistrySharedSmoke = async () => {
    setRegistrySmokeState({ busy: true, result: null, error: "" });
    try {
      const result = await runArcaWsaaRegistrySharedSmoke();
      setRegistrySmokeState({ busy: false, result, error: "" });
      await loadWsaaCacheStatus();
    } catch (error) {
      setRegistrySmokeState({ busy: false, result: null, error: error.message });
    }
  };

  const runProductionReadonlyPreflight = async () => {
    setProductionPreflightState({ busy: true, result: null, error: "" });
    try {
      const result = await runArcaProductionReadonlyPreflight();
      setProductionPreflightState({ busy: false, result, error: "" });
      await loadWsaaCacheStatus();
    } catch (error) {
      setProductionPreflightState({ busy: false, result: null, error: error.message });
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    loadInvoices();
    loadSafeArcaConfig();
    loadWsaaCacheStatus();
  }, [isAdmin]);

  const runInvoiceAction = async (invoice, mode) => {
    if (fiscalActionRef.current) return;
    fiscalActionRef.current = true;
    setInvoiceState((current) => ({
      ...current,
      actionId: invoice.id,
      error: "",
      message: "",
    }));
    try {
      const draft = receiverDrafts[invoice.id];
      const condition = Number(draft?.condition || 0);
      const digits = String(draft?.document || "").replace(/\D/g, "");
      const receiver = !invoice.receiverSnapshot?.vatConditionId && !invoice.authorization?.voucherNumber && condition ? {
        vatConditionId: condition, documentType: condition === 5 ? (digits ? 96 : 99) : 80,
        documentNumber: digits || "0", anonymousConsumerFinal: condition === 5 && !digits, concept: 1,
      } : null;
      if (mode === "review") {
        const result = await reviewArcaInvoice({ invoiceId: invoice.id, receiver });
        await loadInvoices();
        setInvoiceState((current) => ({ ...current, actionId: "", message: `Revisión fiscal: ${fiscalPresentation(result.invoice || { status: result.status, recovery: { classification: result.classification } }).label}. No se solicitó CAE.` }));
        return;
      }
      if (mode === "dry-run") {
        const result = await dryRunArcaInvoice({ invoiceId: invoice.id, receiver });
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          dryRuns: { ...current.dryRuns, [invoice.id]: result },
          message: result.blocked ? "La validación fiscal requiere corregir datos; no se solicitó CAE." : `Dry-run fiscal completado para ${invoice.saleSnapshot?.saleCode || invoice.id}.`,
        }));
        return;
      }

      if (mode === "authorize") {
        const result = await authorizeArcaInvoice({ invoiceId: invoice.id, receiver });
        await loadInvoices();
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          message: result?.status === "authorized"
            ? result?.postAuthorizationVerification?.matched
              ? `ARCA autorizó ${invoice.saleSnapshot?.saleCode || invoice.id} y FECompConsultar confirmó número, CAE y vencimiento.`
              : result?.postAuthorizationVerification?.verified === false
                ? `ARCA autorizó ${invoice.saleSnapshot?.saleCode || invoice.id}, pero la verificación posterior necesita revisión.`
                : `ARCA autorizó ${invoice.saleSnapshot?.saleCode || invoice.id}.`
            : `La solicitud quedó en estado ${result?.status || "desconocido"}.`,
        }));
        return;
      }

      if (mode === "reconcile") {
        const result = await reconcileArcaInvoice({ invoiceId: invoice.id });
        await loadInvoices();
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          message: `Reconciliación finalizada con estado ${result?.status || "desconocido"}.`,
        }));
        return;
      }

      if (mode === "recover-pre-cae") {
        const result = await recoverPreCaeArcaInvoice({ invoiceId: invoice.id });
        await loadInvoices();
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          message: result?.recovered
            ? "Solicitud recuperada a pending. No había número reservado ni CAE."
            : `La solicitud no se modificó: ${result?.reason || "recuperación no segura"}.`,
        }));
        return;
      }

      if (mode === "verify-authorized") {
        const result = await verifyAuthorizedArcaInvoice({ invoiceId: invoice.id });
        await loadInvoices();
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          message: result?.matched
            ? "FECompConsultar confirmó que número, CAE y vencimiento coinciden con Firestore."
            : "FECompConsultar respondió, pero los datos no coinciden. Revisá la verificación antes de continuar.",
        }));
      }
    } catch (error) {
      setInvoiceState((current) => ({
        ...current,
        actionId: "",
        error: error.message,
      }));
    } finally {
      fiscalActionRef.current = false;
    }
  };

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
  const fiscalConfig = arcaState.result?.configuration || arcaConfigState.result || {};
  const caeEnabled = fiscalConfig.caeHomologationEnabled === true;
  const productionEnvironment = fiscalConfig.environment === "production";
  const productionPreflightReady = (
    productionEnvironment
    && fiscalConfig.productionReadonlyEnabled === true
    && fiscalConfig.credentialsReady === true
    && fiscalConfig.taSharedCacheConfigured === true
    && fiscalConfig.pointOfSaleConfigured === true
  );
  const productionCaeTargetSaleCode = String(fiscalConfig.productionCaeTargetSaleCode || "").trim();
  const productionAutoAuthorizeEnabled = fiscalConfig.productionAutoAuthorizeEnabled === true;
  const productionAutoAuthorizeSources = Array.isArray(fiscalConfig.productionAutoAuthorizeSources)
    ? fiscalConfig.productionAutoAuthorizeSources
    : [];
  const productionInvoices = invoiceState.items.filter((invoice) => (
    String(invoice.fiscalEnvironment || "").toLowerCase() === "production"
  ));

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

      {isAdmin ? <OliviaSettings /> : null}

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
      {isAdmin && !productionEnvironment ? (
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

      {isAdmin && !productionEnvironment ? (
        <Panel
          title="Homologación fiscal controlada"
          description="Permite revisar solicitudes persistidas, repetir el dry-run y autorizar sólo cuando el interruptor de CAE de homologación está habilitado."
          action={(
            <Button variant="secondary" loading={invoiceState.busy} onClick={loadInvoices}>
              Actualizar solicitudes
            </Button>
          )}
        >
          <div className="fm-settings-list">
            <div>
              <div>
                <strong>CAE homologación</strong>
                <span>{caeEnabled ? "Habilitado temporalmente" : "Bloqueado por configuración"}</span>
              </div>
              <Badge tone={caeEnabled ? "warning" : "success"}>
                {caeEnabled ? "Habilitado" : "Bloqueado"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>Estado de configuración</strong>
                <span>Se lee sin llamar a WSAA ni consumir un Ticket de Acceso.</span>
              </div>
              <Button variant="secondary" loading={arcaConfigState.busy} onClick={loadSafeArcaConfig}>
                Actualizar estado
              </Button>
            </div>
            <div>
              <div>
                <strong>Certificado + clave privada</strong>
                <span>
                  {fiscalConfig.credentialsReady
                    ? `Par válido y vigente hasta ${fiscalConfig.certificateValidTo || "fecha no informada"}.`
                    : fiscalConfig.credentialErrorCode
                      ? `No listo: ${fiscalConfig.credentialErrorCode}.`
                      : "Sin validar."}
                </span>
              </div>
              <Badge tone={fiscalConfig.credentialsReady ? "success" : "neutral"}>
                {fiscalConfig.credentialsReady ? "Listo" : "Pendiente"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>TA compartido WSFE</strong>
                <span>
                  {!fiscalConfig.taSharedCacheConfigured
                    ? "Pendiente de configurar clave de cifrado."
                    : wsaaCacheState.result?.wsfe?.reusable
                      ? `Cifrado y reutilizable hasta ${wsaaCacheState.result.wsfe.ticketExpiresAt}.`
                      : wsaaCacheState.result?.wsfe?.exists
                        ? "Documento presente, sin TA reutilizable."
                        : "Caché preparada; todavía no se publicó un TA."}
                </span>
              </div>
              <Badge tone={wsaaCacheState.result?.wsfe?.reusable ? "success" : "neutral"}>
                {wsaaCacheState.result?.wsfe?.reusable ? "Reutilizable" : fiscalConfig.taSharedCacheConfigured ? "Preparado" : "Pendiente"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>TA compartido Padrón</strong>
                <span>
                  {!fiscalConfig.taSharedCacheConfigured
                    ? "Pendiente de configurar clave de cifrado."
                    : wsaaCacheState.result?.registry?.reusable
                      ? `Cifrado y reutilizable hasta ${wsaaCacheState.result.registry.ticketExpiresAt}.`
                      : wsaaCacheState.result?.registry?.exists
                        ? "Documento presente, sin TA reutilizable."
                        : "Caché preparada; todavía no se publicó un TA."}
                </span>
              </div>
              <Button variant="secondary" loading={wsaaCacheState.busy} onClick={loadWsaaCacheStatus}>
                Actualizar caché
              </Button>
            </div>
            <div>
              <div>
                <strong>Prueba compartida WSFE</strong>
                <span>
                  {wsaaSmokeState.result
                    ? wsaaSmokeState.result.reusedExistingTicket
                      ? "OK: FEParamGetPtosVenta reutilizó el TA persistido; no se creó otro LoginCms."
                      : wsaaSmokeState.result.createdOrRenewedTicket
                        ? "OK: FEParamGetPtosVenta creó/renovó un TA y lo publicó cifrado."
                        : "FEParamGetPtosVenta respondió; revisar metadata de caché."
                    : "FEParamGetPtosVenta + caché compartida. No genera CAE ni comprobantes."}
                </span>
              </div>
              <Button
                variant="secondary"
                disabled={!fiscalConfig.taSharedCacheConfigured}
                loading={wsaaSmokeState.busy}
                onClick={runWsaaSharedSmoke}
              >
                Probar TA compartido
              </Button>
            </div>
            <div>
              <div>
                <strong>Prueba compartida Padrón</strong>
                <span>
                  {registrySmokeState.result
                    ? registrySmokeState.result.reusedExistingTicket
                      ? "OK: getPersona_v2 reutilizó el TA persistido del Padrón."
                      : registrySmokeState.result.createdOrRenewedTicket
                        ? "OK: getPersona_v2 creó/renovó el TA del Padrón y lo publicó cifrado."
                        : "getPersona_v2 respondió; revisar metadata de caché."
                    : "Usa el CUIT de ejemplo de homologación de ARCA; no consulta clientes reales."}
                </span>
              </div>
              <Button
                variant="secondary"
                disabled={!fiscalConfig.taSharedCacheConfigured}
                loading={registrySmokeState.busy}
                onClick={runRegistrySharedSmoke}
              >
                Probar TA Padrón
              </Button>
            </div>
          </div>

          {arcaConfigState.error ? <Toast tone="error">{arcaConfigState.error}</Toast> : null}
          {wsaaCacheState.error ? <Toast tone="error">{wsaaCacheState.error}</Toast> : null}
          {wsaaSmokeState.error ? <Toast tone="error">{wsaaSmokeState.error}</Toast> : null}
          {registrySmokeState.error ? <Toast tone="error">{registrySmokeState.error}</Toast> : null}
          {productionPreflightState.error ? <Toast tone="error">{productionPreflightState.error}</Toast> : null}
          {invoiceState.error ? <Toast tone="error">{invoiceState.error}</Toast> : null}
          {invoiceState.message ? <Toast tone="info">{invoiceState.message}</Toast> : null}

          {invoiceState.items.length ? (
            <div className="fm-settings-list fm-fiscal-attention-list">
              {invoiceState.items.map((invoice) => {
                const recovery = fiscalPresentation(invoice);
                const dryRun = invoiceState.dryRuns[invoice.id];
                const plan = dryRun?.plan;
                return (
                  <div key={invoice.id}>
                    <div>
                      <strong>{invoice.saleSnapshot?.saleCode || invoice.id}</strong>
                      <span>
                        {recovery.label} · {invoice.sourceType}
                        {invoice.saleSnapshot?.total != null ? ` · ${Number(invoice.saleSnapshot.total).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}` : ""}
                      </span>
                      {invoice.status === "pending" && !invoice.receiverSnapshot?.vatConditionId && !invoice.authorization?.voucherNumber ? (
                        <fieldset className="fm-fiscal-receiver">
                          <legend>Completar receptor fiscal</legend>
                          <label>Condición IVA
                            <select aria-label={`Condición IVA de ${invoice.saleSnapshot?.saleCode || invoice.id}`} value={receiverDrafts[invoice.id]?.condition || ""} onChange={(event) => setReceiverDrafts((current) => ({ ...current, [invoice.id]: { ...current[invoice.id], condition: event.target.value } }))}>
                              <option value="">Elegí la condición</option>
                              <option value="5">Consumidor Final</option><option value="1">Responsable Inscripto</option><option value="6">Monotributo</option><option value="4">Exento</option>
                            </select>
                          </label>
                          <label>{receiverDrafts[invoice.id]?.condition === "5" ? "DNI (opcional)" : "CUIT"}
                            <input aria-label={`Documento fiscal de ${invoice.saleSnapshot?.saleCode || invoice.id}`} inputMode="numeric" value={receiverDrafts[invoice.id]?.document || ""} onChange={(event) => setReceiverDrafts((current) => ({ ...current, [invoice.id]: { ...current[invoice.id], document: event.target.value } }))} />
                          </label>
                          <small>Revisá el receptor antes de autorizar. Si el importe exige identificación, deberás completar su documento.</small>
                        </fieldset>
                      ) : null}
                      {plan ? (
                        <span>
                          Dry-run: Factura {plan.voucherClass} · Neto {Number(plan.fiscal.net).toLocaleString("es-AR", { style: "currency", currency: "ARS" })} · IVA {Number(plan.fiscal.vat).toLocaleString("es-AR", { style: "currency", currency: "ARS" })} · Total {Number(plan.fiscal.total).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                        </span>
                      ) : null}
                      {invoice.authorization?.voucherNumber ? (
                        <span>
                          Comprobante: PV {invoice.authorization.pointOfSale} · tipo {invoice.authorization.voucherType} · N° {invoice.authorization.voucherNumber}
                          {invoice.authorization.cae ? ` · CAE ${invoice.authorization.cae}` : ""}
                          {invoice.authorization.caeExpiration ? ` · vence ${invoice.authorization.caeExpiration}` : ""}
                        </span>
                      ) : null}
                      {invoice.error?.message ? <span>Error fiscal: {invoice.error.message}</span> : null}
                      {recovery.nextRetryAt ? <span>Próximo intento seguro desde {new Date(recovery.nextRetryAt).toLocaleString("es-AR")} · intento {invoice.recovery?.attemptCount || 0}/3</span> : null}
                      {recovery.classification === "UNCERTAIN" ? <span>La venta y el pago permanecen. Consultar ARCA antes de cualquier reenvío.</span> : null}
                      {Array.isArray(invoice.authorization?.observations) && invoice.authorization.observations.length ? (
                        <span>
                          Observaciones ARCA: {invoice.authorization.observations.map((item) => `${item.code}: ${item.message}`).join(" · ")}
                        </span>
                      ) : null}
                      {invoice.verification?.checkedAt ? (
                        <span>
                          FECompConsultar: {invoice.verification.matched ? "coincide" : "NO coincide"} · verificado {invoice.verification.checkedAt}
                        </span>
                      ) : null}
                    </div>
                    <div>
                      {invoice.status !== "authorized" ? <Button variant="secondary" disabled={Boolean(invoiceState.actionId)} loading={invoiceState.actionId === invoice.id} onClick={() => runInvoiceAction(invoice, "review")}>Revisar recuperación</Button> : null}
                      <Button
                        variant="secondary"
                        loading={invoiceState.actionId === invoice.id}
                        onClick={() => runInvoiceAction(invoice, "dry-run")}
                      >
                        Dry-run
                      </Button>
                      {invoice.status === "pending" ? (
                        <Button
                          disabled={!caeEnabled || Boolean(invoiceState.actionId) || (invoice.recovery?.classification === "TEMPORARY" && (!recovery.retryable || Date.parse(recovery.nextRetryAt || "") > Date.now()))}
                          loading={invoiceState.actionId === invoice.id}
                          onClick={() => runInvoiceAction(invoice, "authorize")}
                        >
                          Autorizar homologación
                        </Button>
                      ) : null}
                      {invoice.status === "authorizing"
                        && !invoice.authorization?.voucherNumber
                        && !invoice.authorization?.cae ? (
                        <Button
                          variant="secondary"
                          loading={invoiceState.actionId === invoice.id}
                          onClick={() => runInvoiceAction(invoice, "recover-pre-cae")}
                        >
                          Recuperar intento pre-CAE
                        </Button>
                      ) : null}
                      {invoice.status === "reconciling" ? (
                        <Button
                          variant="secondary"
                          loading={invoiceState.actionId === invoice.id}
                          onClick={() => runInvoiceAction(invoice, "reconcile")}
                        >
                          Reconciliar
                        </Button>
                      ) : null}
                      {invoice.status === "authorized" ? (
                        <Button
                          variant="secondary"
                          loading={invoiceState.actionId === invoice.id}
                          onClick={() => runInvoiceAction(invoice, "verify-authorized")}
                        >
                          Verificar en ARCA
                        </Button>
                      ) : null}
                      <Badge tone={invoice.status === "authorized" ? "success" : invoice.status === "rejected" || invoice.status === "error" ? "warning" : "neutral"}>
                        {invoice.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p>No hay solicitudes fiscales recientes para mostrar.</p>
          )}
        </Panel>
      ) : null}

      {isAdmin && productionEnvironment ? (
        <Panel
          title="Preflight ARCA producción"
          description="Sólo lectura: valida WSFE, punto de venta, Padrón del propio emisor y TA compartidos. La emisión de CAE en producción sigue bloqueada por código."
          action={(
            <Button
              variant="secondary"
              disabled={!productionPreflightReady}
              loading={productionPreflightState.busy}
              onClick={runProductionReadonlyPreflight}
            >
              Ejecutar preflight
            </Button>
          )}
        >
          <div className="fm-settings-list">
            <div>
              <div>
                <strong>Certificado productivo</strong>
                <span>
                  {fiscalConfig.credentialsReady
                    ? `Par certificado/clave válido hasta ${fiscalConfig.certificateValidTo || "fecha no informada"}.`
                    : fiscalConfig.credentialErrorCode
                      ? `No listo: ${fiscalConfig.credentialErrorCode}.`
                      : "Sin validar."}
                </span>
              </div>
              <Badge tone={fiscalConfig.credentialsReady ? "success" : "warning"}>
                {fiscalConfig.credentialsReady ? "Listo" : "Pendiente"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>Conexiones producción</strong>
                <span>
                  {!fiscalConfig.productionReadonlyEnabled
                    ? "Bloqueadas por configuración."
                    : !fiscalConfig.credentialsReady
                      ? "Read-only habilitado, pero certificado/clave no están listos."
                      : !fiscalConfig.taSharedCacheConfigured
                        ? "Read-only habilitado, falta clave de cifrado TA."
                        : !fiscalConfig.pointOfSaleConfigured
                          ? "Read-only habilitado, falta punto de venta."
                          : "Read-only listo para ejecutar el preflight."}
                </span>
              </div>
              <Badge tone={fiscalConfig.productionReadonlyEnabled ? "warning" : "success"}>
                {fiscalConfig.productionReadonlyEnabled ? "Read-only" : "Bloqueado"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>Preparación de facturas productivas</strong>
                <span>{fiscalConfig.productionInvoicePreparationEnabled ? "Habilitada explícitamente." : "Bloqueada por configuración."}</span>
              </div>
              <Badge tone={fiscalConfig.productionInvoicePreparationEnabled ? "warning" : "success"}>
                {fiscalConfig.productionInvoicePreparationEnabled ? "Habilitada" : "Bloqueada"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>Padrón productivo de clientes</strong>
                <span>{fiscalConfig.productionTaxpayerLookupEnabled ? "Habilitado explícitamente." : "Bloqueado por configuración."}</span>
              </div>
              <Badge tone={fiscalConfig.productionTaxpayerLookupEnabled ? "warning" : "success"}>
                {fiscalConfig.productionTaxpayerLookupEnabled ? "Habilitado" : "Bloqueado"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>CAE producción</strong>
                <span>
                  {fiscalConfig.productionCaeEnabled
                    ? productionCaeTargetSaleCode
                      ? `Armado manualmente sólo para la venta ${productionCaeTargetSaleCode}.`
                      : productionAutoAuthorizeEnabled
                        ? "Gate CAE habilitado para el flujo automático acotado por allowlist."
                        : "Gate habilitado, pero no hay venta objetivo manual ni modo automático habilitado."
                    : "Bloqueado por configuración."}
                </span>
              </div>
              <Badge tone={fiscalConfig.productionCaeEnabled ? "warning" : "success"}>
                {fiscalConfig.productionCaeEnabled ? "Armado" : "Bloqueado"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>Autorización automática productiva</strong>
                <span>
                  {productionAutoAuthorizeEnabled
                    ? `Habilitada para: ${productionAutoAuthorizeSources.length ? productionAutoAuthorizeSources.join(", ") : "ningún origen"}.`
                    : "Bloqueada por configuración. La etapa inicial debe limitarse a Venta Rápida."}
                </span>
              </div>
              <Badge tone={productionAutoAuthorizeEnabled ? "warning" : "success"}>
                {productionAutoAuthorizeEnabled ? "Automático" : "Bloqueado"}
              </Badge>
            </div>
            <div>
              <div>
                <strong>PDF fiscal</strong>
                <span>
                  {fiscalConfig.invoicePdfIssuerReady
                    ? "Datos visibles del emisor configurados; PDF habilitable para facturas autorizadas y verificadas."
                    : `Faltan datos del emisor: ${(fiscalConfig.invoicePdfIssuerMissingFields || []).join(", ") || "configuración pendiente"}.`}
                </span>
              </div>
              <Badge tone={fiscalConfig.invoicePdfIssuerReady ? "success" : "warning"}>
                {fiscalConfig.invoicePdfIssuerReady ? "Listo" : "Incompleto"}
              </Badge>
            </div>
            {productionPreflightState.result ? (
              <>
                <div>
                  <div>
                    <strong>Resultado general</strong>
                    <span>{productionPreflightState.result.ready ? "Todos los controles productivos read-only pasaron." : "Hay uno o más controles para revisar; no se habilitó ninguna emisión."}</span>
                  </div>
                  <Badge tone={productionPreflightState.result.ready ? "success" : "warning"}>
                    {productionPreflightState.result.ready ? "Listo" : "Revisar"}
                  </Badge>
                </div>
                <div>
                  <div>
                    <strong>WSFE</strong>
                    <span>
                      {productionPreflightState.result.wsfe?.stageStatus === "ok"
                        ? `App ${productionPreflightState.result.wsfe.appServer} · DB ${productionPreflightState.result.wsfe.dbServer} · Auth ${productionPreflightState.result.wsfe.authServer}`
                        : "La etapa WSFE falló."}
                    </span>
                  </div>
                  <Badge tone={productionPreflightState.result.wsfe?.healthy ? "success" : "warning"}>
                    {productionPreflightState.result.wsfe?.healthy ? "OK" : "Revisar"}
                  </Badge>
                </div>
                <div>
                  <div>
                    <strong>Punto de venta {productionPreflightState.result.pointOfSale?.selected}</strong>
                    <span>
                      Encontrado: {productionPreflightState.result.pointOfSale?.found ? "sí" : "no"} ·
                      operativo: {productionPreflightState.result.pointOfSale?.operational ? "sí" : "no"} ·
                      bloqueado: {productionPreflightState.result.pointOfSale?.blocked || "sin dato"} ·
                      baja: {productionPreflightState.result.pointOfSale?.dropDate || "sin fecha"}
                    </span>
                  </div>
                  <Badge tone={productionPreflightState.result.pointOfSale?.operational ? "success" : "warning"}>
                    {productionPreflightState.result.pointOfSale?.operational ? "Operativo" : "Revisar"}
                  </Badge>
                </div>
                <div>
                  <div>
                    <strong>Tablas fiscales</strong>
                    <span>
                      A: {productionPreflightState.result.fiscalTables?.voucherTypes?.facturaA ? "sí" : "no"} ·
                      B: {productionPreflightState.result.fiscalTables?.voucherTypes?.facturaB ? "sí" : "no"} ·
                      IVA 21%: {productionPreflightState.result.fiscalTables?.vat21 ? "sí" : "no"} ·
                      Doc 80/96/99: {productionPreflightState.result.fiscalTables?.documentTypes?.cuit80 && productionPreflightState.result.fiscalTables?.documentTypes?.dni96 && productionPreflightState.result.fiscalTables?.documentTypes?.consumidorFinal99 ? "sí" : "no"}
                    </span>
                  </div>
                  <Badge tone={productionPreflightState.result.fiscalTables?.ready ? "success" : "warning"}>
                    {productionPreflightState.result.fiscalTables?.ready ? "OK" : "Revisar"}
                  </Badge>
                </div>
                <div>
                  <div>
                    <strong>Correlatividad</strong>
                    <span>
                      Factura A último: {productionPreflightState.result.sequences?.facturaA?.lastAuthorized ?? "sin dato"} ·
                      Factura B último: {productionPreflightState.result.sequences?.facturaB?.lastAuthorized ?? "sin dato"}
                    </span>
                  </div>
                  <Badge tone={productionPreflightState.result.sequences?.ready ? "success" : "warning"}>
                    {productionPreflightState.result.sequences?.ready ? "OK" : "Revisar"}
                  </Badge>
                </div>
                <div>
                  <div>
                    <strong>Emisor y TA</strong>
                    <span>
                      Emisor: {productionPreflightState.result.issuer?.keyStatus || "sin estado"} ·
                      TA WSFE: {productionPreflightState.result.cache?.wsfe?.reusable ? "reutilizable" : "no reutilizable"} ·
                      TA Padrón: {productionPreflightState.result.cache?.registry?.reusable ? "reutilizable" : "no reutilizable"}
                    </span>
                  </div>
                  <Badge tone={productionPreflightState.result.issuer?.keyStatus === "ACTIVO" && productionPreflightState.result.cache?.wsfe?.reusable && productionPreflightState.result.cache?.registry?.reusable ? "success" : "warning"}>
                    Verificación
                  </Badge>
                </div>
                {Array.isArray(productionPreflightState.result.failedStages) && productionPreflightState.result.failedStages.length ? (
                  <div>
                    <div>
                      <strong>Etapas con error</strong>
                      <span>
                        {productionPreflightState.result.failedStages
                          .map((item) => `${item.stage}: ${item.code || "error"} · ${item.message}`)
                          .join(" | ")}
                      </span>
                    </div>
                    <Badge tone="warning">{productionPreflightState.result.failedStages.length} error(es)</Badge>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {productionPreflightState.error ? <Toast tone="error">{productionPreflightState.error}</Toast> : null}
        </Panel>
      ) : null}

      {isAdmin && productionEnvironment ? (
        <Panel
          title="Autorización productiva controlada"
          description="Sólo una venta puede quedar armada por código exacto. La autorización consulta correlatividad, solicita CAE y luego verifica el comprobante con FECompConsultar."
          action={(
            <Button variant="secondary" loading={invoiceState.busy} onClick={loadInvoices}>
              Actualizar solicitudes
            </Button>
          )}
        >
          <div className="fm-settings-list">
            {productionInvoices.length ? productionInvoices.map((invoice) => {
              const saleCode = invoice.saleSnapshot?.saleCode || invoice.id;
              const isTarget = Boolean(
                fiscalConfig.productionCaeEnabled
                && productionCaeTargetSaleCode
                && saleCode === productionCaeTargetSaleCode
              );
              const verification = invoice.verification;
              return (
                <div key={invoice.id}>
                  <div>
                    <strong>{saleCode}</strong>
                    <span>
                      {invoice.status} · {invoice.saleSnapshot?.total != null
                        ? Number(invoice.saleSnapshot.total).toLocaleString("es-AR", { style: "currency", currency: "ARS" })
                        : "sin total"}
                      {invoice.authorization?.voucherNumber
                        ? ` · PV ${invoice.authorization.pointOfSale} · tipo ${invoice.authorization.voucherType} · N° ${invoice.authorization.voucherNumber}`
                        : ""}
                    </span>
                    {verification?.checkedAt ? (
                      <span>
                        FECompConsultar: {verification.matched ? "coincide" : "NO coincide"} · {verification.checkedAt}
                      </span>
                    ) : null}
                  </div>
                  <div>
                    {invoice.status === "pending" ? (
                      <Button
                        disabled={!isTarget || invoiceState.actionId === invoice.id}
                        loading={invoiceState.actionId === invoice.id}
                        onClick={() => runInvoiceAction(invoice, "authorize")}
                      >
                        Autorizar venta objetivo
                      </Button>
                    ) : null}
                    {invoice.status === "reconciling" ? (
                      <Button
                        variant="secondary"
                        loading={invoiceState.actionId === invoice.id}
                        onClick={() => runInvoiceAction(invoice, "reconcile")}
                      >
                        Reconciliar
                      </Button>
                    ) : null}
                    {invoice.status === "authorized" ? (
                      <Button
                        variant="secondary"
                        loading={invoiceState.actionId === invoice.id}
                        onClick={() => runInvoiceAction(invoice, "verify-authorized")}
                      >
                        Verificar en ARCA
                      </Button>
                    ) : null}
                    <Badge tone={invoice.status === "authorized" ? "success" : invoice.status === "rejected" || invoice.status === "error" ? "warning" : "neutral"}>
                      {isTarget && invoice.status === "pending" ? "Objetivo armado" : invoice.status}
                    </Badge>
                  </div>
                </div>
              );
            }) : (
              <p>No hay solicitudes fiscales productivas recientes.</p>
            )}
          </div>
          {invoiceState.error ? <Toast tone="error">{invoiceState.error}</Toast> : null}
          {invoiceState.message ? <Toast tone="info">{invoiceState.message}</Toast> : null}
        </Panel>
      ) : null}
      {profile ? <DriveSettings profile={profile} /> : null}
    </div>
  );
}
