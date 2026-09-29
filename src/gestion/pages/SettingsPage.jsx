import { useEffect, useState } from "react";
import { Badge, Button, PageHeader, Panel, Toast } from "../../design-system";
import { useAuth } from "../AuthContext";
import { canAccessAdministration } from "../permissions";
import {
  authorizeArcaInvoice,
  dryRunArcaInvoice,
  getArcaSafeStatus,
  getArcaWsaaCacheStatus,
  listRecentArcaInvoices,
  reconcileArcaInvoice,
  recoverPreCaeArcaInvoice,
  runArcaDiagnostics,
  runArcaProductionReadonlyPreflight,
  runArcaWsaaRegistrySharedSmoke,
  runArcaWsaaSharedSmoke,
  verifyAuthorizedArcaInvoice,
} from "../services/arcaService";
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
      const items = await listRecentArcaInvoices({ pageSize: 10 });
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
    setInvoiceState((current) => ({
      ...current,
      actionId: invoice.id,
      error: "",
      message: "",
    }));
    try {
      if (mode === "dry-run") {
        const result = await dryRunArcaInvoice({ invoiceId: invoice.id });
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          dryRuns: { ...current.dryRuns, [invoice.id]: result },
          message: `Dry-run fiscal completado para ${invoice.saleSnapshot?.saleCode || invoice.id}.`,
        }));
        return;
      }

      if (mode === "authorize") {
        const result = await authorizeArcaInvoice({ invoiceId: invoice.id });
        await loadInvoices();
        setInvoiceState((current) => ({
          ...current,
          actionId: "",
          message: result?.status === "authorized"
            ? `ARCA autorizó ${invoice.saleSnapshot?.saleCode || invoice.id}.`
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
          {invoiceState.message ? <Toast tone="success">{invoiceState.message}</Toast> : null}

          {invoiceState.items.length ? (
            <div className="fm-settings-list">
              {invoiceState.items.map((invoice) => {
                const dryRun = invoiceState.dryRuns[invoice.id];
                const plan = dryRun?.plan;
                return (
                  <div key={invoice.id}>
                    <div>
                      <strong>{invoice.saleSnapshot?.saleCode || invoice.id}</strong>
                      <span>
                        {invoice.status} · {invoice.sourceType}
                        {invoice.saleSnapshot?.total != null ? ` · ${Number(invoice.saleSnapshot.total).toLocaleString("es-AR", { style: "currency", currency: "ARS" })}` : ""}
                      </span>
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
                      <Button
                        variant="secondary"
                        loading={invoiceState.actionId === invoice.id}
                        onClick={() => runInvoiceAction(invoice, "dry-run")}
                      >
                        Dry-run
                      </Button>
                      {invoice.status === "pending" ? (
                        <Button
                          disabled={!caeEnabled || invoiceState.actionId === invoice.id}
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
                <span>Bloqueado por código. Este preflight no puede emitir comprobantes.</span>
              </div>
              <Badge tone="success">Bloqueado</Badge>
            </div>
            {productionPreflightState.result ? (
              <div>
                <div>
                  <strong>Resultado</strong>
                  <span>
                    PV {productionPreflightState.result.pointOfSale?.selected}: {productionPreflightState.result.pointOfSale?.found ? "OK" : "no encontrado"} ·
                    Emisor: {productionPreflightState.result.issuer?.keyStatus || "sin estado"} ·
                    TA WSFE: {productionPreflightState.result.cache?.wsfe?.reusable ? "reutilizable" : "no reutilizable"} ·
                    TA Padrón: {productionPreflightState.result.cache?.registry?.reusable ? "reutilizable" : "no reutilizable"}
                  </span>
                </div>
                <Badge tone={productionPreflightState.result.pointOfSale?.found && productionPreflightState.result.issuer?.keyStatus === "ACTIVO" ? "success" : "warning"}>
                  Preflight
                </Badge>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
