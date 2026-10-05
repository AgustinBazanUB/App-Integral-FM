import { useEffect, useRef, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { Badge, Button, FormField, Modal, Panel, Skeleton, Toast } from "../../design-system";
import { quotaPeriod, validateConfiguration } from "../../shared/oliviaContracts.mjs";
import { useAuth } from "../AuthContext";
import { canAccessAdministration } from "../permissions";
import { formatDateTime } from "../formatters";
import { operationLabel, prependHistoryMessages, requestId } from "./client.mjs";
import { oliviaClient } from "./service";
import OliviaKnowledgeManager from "./OliviaKnowledgeManager";
import { formatOliviaCost } from "../../shared/oliviaVoicePricing.mjs";
import "./olivia.css";

const frequencies = { daily: "Diaria", weekly: "Semanal", monthly: "Mensual" };
const profileLabels = { adminDefault: "Operación habitual · Luna HIGH", adminComplex: "Análisis complejo · misma Luna XHIGH", seller: "Vendedor · Luna HIGH", creative: "Creatividad en Marketing / Redes · Sol HIGH", creativeComplex: "Creatividad compleja · Sol XHIGH", live: "Conversación · GPT-Live", transcription: "Dictado grabado", liveTranscription: "Transcripción de voz anterior", realtime: "Protocolo de voz anterior (opcional)" };
const usageLabels = { text: "Texto", chat: "Consulta", realtime: "Voz anterior", live: "GPT-Live (duración)", transcription: "Dictado", confirm: "Confirmación" };
const roleLabel = (role) => role === "seller" ? "Vendedor" : ["admin", "general_admin"].includes(role) ? "Administrador" : "Usuario";

export default function OliviaSettings() {
  const { user, profile } = useAuth();
  const [state, setState] = useState({ loading: true, data: null, error: "" });
  const [configuration, setConfiguration] = useState(null);
  const [users, setUsers] = useState([]);
  const [quotaUser, setQuotaUser] = useState("");
  const [quotaTokens, setQuotaTokens] = useState(100000);
  const [quotaFrequency, setQuotaFrequency] = useState("monthly");
  const [quotaExtra, setQuotaExtra] = useState(0);
  const [advanced, setAdvanced] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyUser, setHistoryUser] = useState("");
  const [history, setHistory] = useState(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0);
  const quotaExtraRef = useRef(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  const isAdmin = canAccessAdministration(profile);

  const load = async () => {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await oliviaClient.request({ operation: "configuration", requestId: requestId() });
      if (!mounted.current) return;
      setConfiguration(data.configuration);
      setUsers(data.users || []);
      setState({ loading: false, data, error: "" });
    } catch (failure) { if (mounted.current) setState({ loading: false, data: null, error: failure.message }); }
  };

  useEffect(() => {
    mounted.current = true;
    if (isAdmin) {
      load();
    }
    return () => { mounted.current = false; };
  }, [user.uid, isAdmin]);

  if (!isAdmin) return null;
  if (state.loading) return <Panel title="Olivia · Configuración de IA"><Skeleton lines={4}/></Panel>;
  if (!configuration) return <Panel title="Olivia · Configuración de IA"><p role="alert" className="fm-form-error">{state.error || "No se pudo leer la configuración de Olivia."}</p><Button variant="secondary" onClick={load}>Reintentar</Button></Panel>;

  const edit = (fields) => { setConfiguration((current) => ({ ...current, ...fields })); setNotice(""); };
  const changeProfile = (key, fields) => {
    const profiles = { ...configuration.profiles, [key]: { ...configuration.profiles[key], ...fields } };
    const pair = { adminDefault: "adminComplex", adminComplex: "adminDefault", creative: "creativeComplex", creativeComplex: "creative" }[key];
    if (fields.model && pair) profiles[pair] = { ...profiles[pair], model: fields.model };
    edit({ profiles });
  };
  const preview = () => {
    try {
      const candidate = validateConfiguration(structuredClone(configuration));
      setPending({ configuration: candidate, requestId: requestId() });
      setNotice("");
    } catch (failure) { setNotice(failure.message); }
  };
  const save = async () => {
    if (locked.current || !pending) return;
    // Configuration is a sensitive manual operation. Credentials never enter a chat request.
    const token = await user.getIdTokenResult();
    if (Date.now() / 1000 - Number(token.claims.auth_time || 0) > 300) { setReauthOpen(true); return; }
    locked.current = true; setBusy(true);
    try {
      const result = await oliviaClient.request({ operation: "saveConfiguration", configuration: pending.configuration, requestId: pending.requestId, confirmed: true });
      setConfiguration(result.configuration || pending.configuration);
      setState((current) => ({ ...current, data: { ...current.data, ...result } }));
      setPending(null);
      setNotice("La configuración de Olivia quedó guardada y registrada en Auditoría.");
      window.dispatchEvent(new Event("flor-mia:olivia-configuration-updated"));
    } catch (failure) {
      if (failure.code === "reauthentication-required" || failure.code === "olivia-reauthentication-required") setReauthOpen(true);
      setNotice(failure.message);
    } finally { locked.current = false; setBusy(false); }
  };
  const reauthenticate = async () => {
    if (locked.current) return;
    locked.current = true; setBusy(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      setPassword("");
      await user.getIdToken(true);
      setReauthOpen(false);
      setNotice("Identidad verificada. Confirmá el cambio de configuración para guardarlo.");
    } catch { setPassword(""); setNotice("No se pudo verificar la identidad. Revisá tus datos e intentá nuevamente."); }
    finally { locked.current = false; setBusy(false); }
  };
  const quotaRows = Object.entries(configuration.userQuotas || {}).filter(([uid]) => !canAccessAdministration(users.find((item) => item.id === uid) || {}));
  const loadHistory = async (conversationId, messagesCursor) => {
    if (!historyUser) return;
    const sequence = ++historyRequest.current;
    setHistoryBusy(true); setHistoryError("");
    try {
      const result = await oliviaClient.request({ operation: "history", userId: historyUser, ...(conversationId ? { conversationId } : {}), ...(messagesCursor ? { messagesCursor } : {}), requestId: requestId() });
      if (mounted.current && historyRequest.current === sequence) setHistory((current) => {
        if (messagesCursor && current?.selectedConversation?.id === conversationId && result.selectedConversation) {
          return { ...result, selectedConversation: { ...result.selectedConversation, messages: prependHistoryMessages(result.selectedConversation.messages, current.selectedConversation.messages) } };
        }
        return result;
      });
    } catch (failure) { if (mounted.current && historyRequest.current === sequence) setHistoryError(failure.message); }
    finally { if (mounted.current && historyRequest.current === sequence) setHistoryBusy(false); }
  };

  return <Panel title="Olivia · Configuración de IA" description="Administrá modelos, cupos y retención. Los administradores no tienen límite de tokens. Los vendedores tienen cupos y ven sus costos en pesos." action={<Badge tone={state.data?.providerConfigured ? "success" : "warning"}>{state.data?.providerConfigured ? "Proveedor configurado" : "Falta configurar el proveedor"}</Badge>}>
    <div className="fm-olivia-settings">
      <OliviaKnowledgeManager />
      {notice ? <Toast>{notice}</Toast> : null}
      {!state.data?.providerConfigured ? <p>Olivia necesita una conexión con OpenAI configurada en el servidor para responder. Tu aplicación y los paneles manuales continúan disponibles.</p> : null}
      <div className="fm-olivia-settings-grid">
        <FormField label="Estado de Olivia"><select value={configuration.enabled ? "enabled" : "disabled"} onChange={(event) => edit({ enabled: event.target.value === "enabled" })}><option value="enabled">Habilitada</option><option value="disabled">Deshabilitada</option></select></FormField>
        <FormField label="Retención del historial (meses)"><input type="number" min="1" max="12" value={configuration.retentionMonths} onChange={(event) => edit({ retentionMonths: Number(event.target.value) })}/></FormField>
        <FormField label="Cupo predeterminado de vendedores (tokens)"><input type="number" min="1000" step="1000" value={configuration.defaultQuota?.tokens || ""} onChange={(event) => edit({ defaultQuota: { ...configuration.defaultQuota, tokens: Number(event.target.value) } })}/></FormField>
        <FormField label="Renovación predeterminada"><select value={configuration.defaultQuota?.frequency || "monthly"} onChange={(event) => edit({ defaultQuota: { ...configuration.defaultQuota, frequency: event.target.value } })}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      </div>
      <fieldset><legend>Política de modelos</legend><p>La operación habitual usa Luna. El análisis complejo aumenta su razonamiento; Sol se reserva para creatividad en Marketing o Redes. Los cambios requieren confirmación y quedan en Auditoría.</p><div className="fm-olivia-settings-grid">
        {Object.entries(configuration.profiles || {}).map(([key, value]) => <div key={key} className="fm-olivia-model-profile"><FormField label={profileLabels[key] || key}><input value={value.model || ""} onChange={(event) => changeProfile(key, { model: event.target.value })}/></FormField>{value.reasoningEffort != null ? <FormField label="Razonamiento"><select value={value.reasoningEffort} onChange={(event) => changeProfile(key, { reasoningEffort: event.target.value })}>{["high", "xhigh"].map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></FormField> : null}{value.voice != null ? <FormField label="Voz"><input value={value.voice} onChange={(event) => changeProfile(key, { voice: event.target.value })}/></FormField> : null}</div>)}
      </div></fieldset>
      <fieldset><legend>Enrutamiento y límites</legend><div className="fm-olivia-settings-grid">
        <FormField label="Protocolo de conversación"><select value={configuration.voiceProtocol} onChange={(event) => edit({ voiceProtocol: event.target.value })}><option value="live">GPT-Live · delegación al backend</option><option value="realtime">Realtime · compatibilidad anterior</option></select></FormField>
        <FormField label="Tarifa GPT-Live (USD / minuto)"><input type="number" step="0.001" min="0.001" value={configuration.liveUsdPerMinute} onChange={(event) => edit({ liveUsdPerMinute: Number(event.target.value) })}/></FormField>
        {Object.entries({ toolThreshold: "Herramientas para análisis complejo", entityThreshold: "Entidades para análisis complejo", rowThreshold: "Filas para análisis complejo", documentThreshold: "Documentos para análisis complejo" }).map(([key, label]) => <FormField key={key} label={label}><input type="number" value={configuration.routing[key]} onChange={(event) => edit({ routing: { ...configuration.routing, [key]: Number(event.target.value) } })}/></FormField>)}
        {Object.entries({ maxOutputTokens: "Máximo de tokens de respuesta", maxToolCalls: "Máximo de herramientas", maxRounds: "Máximo de rondas", timeoutMs: "Tiempo total máximo (ms)", providerTimeoutMs: "Tiempo por llamada (ms)" }).map(([key, label]) => <FormField key={key} label={label}><input type="number" value={configuration.responseLimits[key]} onChange={(event) => edit({ responseLimits: { ...configuration.responseLimits, [key]: Number(event.target.value) } })}/></FormField>)}
      </div></fieldset>
      {state.data?.routeUsage?.length ? <fieldset><legend>Distribución de llamadas</legend><p>Últimos 500 registros de consumo. Los costos sin medición no se convierten en cero.</p><div className="fm-data-table-wrap"><table className="fm-data-table"><thead><tr><th>Ruta</th><th>Llamadas</th><th>Porcentaje</th><th>Tokens</th><th>USD conocidos</th><th>Costos pendientes</th></tr></thead><tbody>{state.data.routeUsage.map((row) => <tr key={row.route}><td>{row.route}</td><td>{row.calls}</td><td>{row.percentage.toFixed(1)}%</td><td>{row.tokens}</td><td>{formatOliviaCost(row.costUsd, "USD")}</td><td>{row.unknownCosts}</td></tr>)}</tbody></table></div></fieldset> : null}
      <fieldset><legend>Cupos por usuario</legend><div className="fm-olivia-settings-grid">
        <FormField label="Usuario"><select value={quotaUser} onChange={(event) => { const uid = event.target.value; setQuotaUser(uid); const quota = configuration.userQuotas?.[uid] || configuration.defaultQuota; setQuotaTokens(quota?.tokens || 100000); setQuotaFrequency(quota?.frequency || "monthly"); setQuotaExtra(quota?.temporaryPeriod === quotaPeriod(quota?.frequency || "monthly").key ? quota?.temporaryExtraTokens || 0 : 0); }}><option value="">Elegí un usuario</option>{users.filter((item) => item.active !== false && !canAccessAdministration(item)).map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></FormField>
        <FormField label="Cupo habitual (tokens)"><input type="number" min="1000" value={quotaTokens} onChange={(event) => setQuotaTokens(Number(event.target.value))}/></FormField>
        <FormField label="Renovación"><select value={quotaFrequency} onChange={(event) => setQuotaFrequency(event.target.value)}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
        <FormField label="Ampliación del período actual (tokens)" hint="Vence al comenzar el siguiente período. No cambia el cupo habitual."><input ref={quotaExtraRef} type="number" min="0" value={quotaExtra} onChange={(event) => setQuotaExtra(Number(event.target.value))}/></FormField>
      </div><Button variant="secondary" disabled={!quotaUser || quotaTokens < 1000 || quotaExtra < 0} onClick={() => edit({ userQuotas: { ...configuration.userQuotas, [quotaUser]: { tokens: quotaTokens, frequency: quotaFrequency, ...(quotaExtra > 0 ? { temporaryExtraTokens: quotaExtra, temporaryPeriod: quotaPeriod(quotaFrequency).key } : {}) } } })}>Agregar cupo al cambio</Button>
        {quotaRows.length ? <ul className="fm-olivia-quota-list">{quotaRows.map(([uid, quota]) => <li key={uid}><span><strong>{users.find((item) => item.id === uid)?.name || uid}</strong> · {quota.tokens.toLocaleString("es-AR")} tokens · {frequencies[quota.frequency]}{quota.temporaryExtraTokens ? ` · +${quota.temporaryExtraTokens.toLocaleString("es-AR")} temporales` : ""}</span><Button variant="secondary" onClick={() => { const next = { ...configuration.userQuotas }; delete next[uid]; edit({ userQuotas: next }); }}>Usar cupo predeterminado</Button></li>)}</ul> : null}
        {state.data?.quotaRequests?.length ? <><h3>Solicitudes de ampliación pendientes</h3><ul className="fm-olivia-quota-list">{state.data.quotaRequests.map((request) => <li key={request.id}><span><strong>{request.userName}</strong> · {formatDateTime(request.createdAt)} · Período actual</span><Button variant="secondary" onClick={() => { setQuotaUser(request.userId); const quota = configuration.userQuotas?.[request.userId] || configuration.defaultQuota; setQuotaTokens(quota.tokens); setQuotaFrequency(quota.frequency); setQuotaExtra(0); quotaExtraRef.current?.focus(); }}>Preparar ampliación</Button></li>)}</ul><p className="fm-field__hint">Ingresá la ampliación, agregala al cambio y revisá la configuración antes de guardarla.</p></> : null}
      </fieldset>
      <fieldset className="fm-olivia-supervision"><legend>Consumo e historial por usuario</legend>
        <div className="fm-olivia-supervision-actions"><FormField label="Usuario a supervisar"><select value={historyUser} onChange={(event) => { historyRequest.current++; setHistoryUser(event.target.value); setHistory(null); setHistoryBusy(false); setHistoryError(""); }}><option value="">Elegí un usuario</option>{users.map((item) => <option key={item.id} value={item.id}>{item.name || item.id} · {roleLabel(item.role)}</option>)}</select></FormField><Button variant="secondary" loading={historyBusy} disabled={!historyUser} onClick={() => loadHistory()}>Consultar historial</Button></div>
        {historyError ? <p className="fm-form-error" role="alert">{historyError}</p> : null}
        {history?.usage ? <p>Cupo disponible: <strong>{history.usage.unlimited ? "Sin límite" : `${history.usage.remainingPercent}%`}</strong> · Consumo del período: {Number(history.usage.usedTokens || 0).toLocaleString("es-AR")} tokens{history.usage.renewsAt ? ` · Renovación: ${formatDateTime(history.usage.renewsAt)}` : ""}</p> : null}
        {history ? <><h3>Conversaciones conservadas</h3>{history.conversations?.length ? <ul className="fm-olivia-quota-list">{history.conversations.map((conversation) => <li key={conversation.id}><span>{formatDateTime(conversation.updatedAt)} · {conversation.messageCount} mensajes · {operationLabel(conversation.state)}</span><Button variant="secondary" disabled={historyBusy} onClick={() => loadHistory(conversation.id)}>Ver conversación</Button></li>)}</ul> : <p>No hay conversaciones dentro del período de retención.</p>}
          {history.selectedConversation ? <section className="fm-olivia-history-transcript" aria-label="Historial de conversación"><h4>Conversación seleccionada</h4>{history.selectedConversation.nextCursor || history.nextCursor ? <Button variant="secondary" loading={historyBusy} onClick={() => loadHistory(history.selectedConversation.id, history.selectedConversation.nextCursor || history.nextCursor)}>Cargar mensajes anteriores</Button> : null}{history.selectedConversation.messages?.filter((message) => ["user", "assistant"].includes(message.role)).map((message, index) => <article key={message.id || index} className={`fm-olivia-message fm-olivia-message--${message.role}`}><strong>{message.role === "assistant" ? "Olivia" : users.find((item) => item.id === historyUser)?.name || "Usuario"}</strong><p>{message.content}</p></article>)}</section> : null}
          <h3>Consumo reciente</h3>{history.usageEvents?.length ? <div className="fm-data-table-wrap"><table className="fm-data-table"><thead><tr><th>Fecha</th><th>Uso</th><th>Modelo</th><th>Tokens</th><th>Costo calculado</th><th>Resultado</th></tr></thead><tbody>{history.usageEvents.map((event, index) => <tr key={event.id || index}><td>{formatDateTime(event.createdAt)}</td><td>{usageLabels[event.operation] || "Consulta"}{event.measurement === "reserved-estimate" ? " (estimado)" : ""}</td><td>{event.model}</td><td>{Number(event.totalTokens || 0).toLocaleString("es-AR")}</td><td>{event.actualCostUsd != null ? formatOliviaCost(event.actualCostUsd, "USD") : "Sin tarifa configurada"}{event.actualCostArs != null ? ` · ${formatOliviaCost(event.actualCostArs)}` : ""}</td><td>{event.success === false ? event.errorCode || "Error" : "Completado"}</td></tr>)}</tbody></table></div> : <p>No hay consumo registrado para este usuario.</p>}</> : null}
        <p className="fm-field__hint">Se consulta una cantidad acotada de registros. Solo se muestran conversaciones vigentes según la retención configurada.</p>
      </fieldset>
      <details open={advancedOpen} onToggle={(event) => { setAdvancedOpen(event.currentTarget.open); if (event.currentTarget.open) setAdvanced(JSON.stringify(configuration, null, 2)); }}><summary>Configuración avanzada</summary><p>Precios por modelo, umbrales de complejidad, límites y cotización oficial se validan en el servidor. Sin cotización manual se consulta la cotización fechada del BNA. Si esa referencia no está disponible o venció, el costo en pesos queda sin calcular.</p><label htmlFor="fm-olivia-config-json">Configuración completa</label><textarea id="fm-olivia-config-json" className="fm-olivia-config-json" rows="14" value={advanced} onChange={(event) => setAdvanced(event.target.value)}/><Button variant="secondary" onClick={() => { try { setConfiguration(validateConfiguration(JSON.parse(advanced))); setNotice("La configuración avanzada se agregó al cambio. Revisala antes de guardar."); } catch (failure) { setNotice(failure.message || "El JSON de configuración no es válido."); } }}>Aplicar al borrador</Button></details>
      <div className="fm-dialog-actions"><Button variant="secondary" onClick={load} disabled={busy}>Restablecer</Button><Button onClick={preview} disabled={busy}>Revisar y guardar</Button></div>
    </div>
    <Modal open={Boolean(pending) && !reauthOpen} title="Confirmar configuración de Olivia" onClose={() => { if (!busy) setPending(null); }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>Cancelar</Button><Button loading={busy} onClick={() => save().catch(() => setNotice("No se pudo verificar la sesión. Volvé a iniciar sesión."))}>Confirmar cambio</Button></div>}>
      {pending ? <><p>Olivia quedará {pending.configuration.enabled ? "habilitada" : "deshabilitada"}. Retención: {pending.configuration.retentionMonths} meses. Cupo predeterminado: {pending.configuration.defaultQuota?.tokens?.toLocaleString("es-AR")} tokens, renovación {frequencies[pending.configuration.defaultQuota?.frequency]?.toLowerCase()}.</p><details><summary>Ver todos los cambios propuestos</summary><pre className="fm-olivia-config-preview">{JSON.stringify(pending.configuration, null, 2)}</pre></details><p>Los cambios se registrarán en Actividad / Auditoría.</p>{notice ? <p role="status">{notice}</p> : null}</> : null}
    </Modal>
    <Modal open={reauthOpen} title="Verificar tu identidad" description="La configuración de IA requiere una sesión verificada recientemente." onClose={() => { if (!busy) { setReauthOpen(false); setPassword(""); } }} footer={<div className="fm-dialog-actions"><Button variant="secondary" disabled={busy} onClick={() => { setReauthOpen(false); setPassword(""); }}>Cancelar</Button><Button loading={busy} disabled={!password} onClick={reauthenticate}>Verificar</Button></div>}>
      <p>{user.email}</p><FormField label="Contraseña"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}/></FormField><p className="fm-field__hint">Esta verificación se realiza directamente con Firebase. La contraseña no se envía a Olivia.</p>{notice ? <p role="alert">{notice}</p> : null}
    </Modal>
  </Panel>;
}
