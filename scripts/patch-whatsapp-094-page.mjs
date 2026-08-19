import { readFile, writeFile } from "node:fs/promises";

async function patch(path, replacements) {
  let source = await readFile(path, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) throw new Error(`Expected source not found in ${path}: ${from.slice(0, 100)}`);
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) await writeFile(path, source);
  return changed;
}

const pageChanged = await patch("src/gestion/pages/WhatsAppCampaignsPage.jsx", [
  [
`function ExtensionStatus({ status, refreshing, onRefresh }) {\n  const primary = extensionPrimaryStatus(status);`,
`function ExtensionStatus({ status, refreshing, onRefresh, onReconnect }) {\n  const primary = extensionPrimaryStatus(status);\n  const reconnect = status.connectionState && status.connectionState !== "connected";`
  ],
  [
`      <Button variant="secondary" icon="RefreshCw" loading={refreshing} onClick={onRefresh}>Revisar conexión</Button>`,
`      <Button variant="secondary" icon="RefreshCw" loading={refreshing} onClick={reconnect ? (onReconnect || onRefresh) : onRefresh}>{reconnect ? "Reconectar" : "Revisar conexión"}</Button>`
  ],
  [
`  const [error, setError] = useState("");\n  useEffect(() => { listCampaignEvents(profile, campaign.id).then(setEvents).catch((cause) => setError(cause.message)); }, [campaign.id, profile.id]);\n\n  const runControl = async (kind) => {\n    if (pendingControl) return;\n    setPendingControl(kind);`,
`  const [error, setError] = useState("");\n  const controlInFlightRef = useRef(false);\n  useEffect(() => { listCampaignEvents(profile, campaign.id).then(setEvents).catch((cause) => setError(cause.message)); }, [campaign.id, profile.id]);\n\n  const runControl = async (kind) => {\n    if (controlInFlightRef.current || pendingControl) return;\n    controlInFlightRef.current = true;\n    setPendingControl(kind);`
  ],
  [
`    } catch (cause) {\n      setError(cause.message || "No se pudo aplicar el control. Revisá la conexión e intentá nuevamente.");\n      setPendingControl("");\n    }\n  };`,
`    } catch (cause) {\n      controlInFlightRef.current = false;\n      setError(cause.message || "No se pudo aplicar el control. Revisá la conexión e intentá nuevamente.");\n      setPendingControl("");\n    }\n  };`
  ],
  [
`  const [extensionStatus, setExtensionStatus] = useState({ operational: false, message: "Comprobando conexión…", configuredLimit: 0, sentToday: 0, availableToday: 0 });`,
`  const [extensionStatus, setExtensionStatus] = useState({ operational: false, connectionState: "reconnecting", message: "Comprobando conexión…", configuredLimit: 0, sentToday: 0, availableToday: 0 });`
  ],
  [
`  const refreshExtension = async () => {\n    const status = await pingWhatsAppExtension();\n    setExtensionStatus(status);\n  };`,
`  const refreshExtension = async () => {\n    const status = await pingWhatsAppExtension();\n    setExtensionStatus(status);\n    return status;\n  };\n\n  const reconnectExtension = async () => {\n    if (extensionStatus.connectionState === "needs_page_reload") {\n      window.location.reload();\n      return;\n    }\n    setExtensionStatus((current) => ({ ...current, operational: false, connectionState: "reconnecting", message: "Reconectando la extensión…" }));\n    await refreshExtension();\n  };`
  ],
  [
`  useEffect(() => {\n    refreshExtension();\n    loadCampaigns();\n    const refreshWhenVisible = () => {\n      if (document.visibilityState === "visible") refreshExtension();\n    };\n    document.addEventListener("visibilitychange", refreshWhenVisible);\n    window.addEventListener("focus", refreshWhenVisible);`,
`  useEffect(() => {\n    let cancelled = false;\n    let heartbeatTimer = null;\n    let heartbeatController = null;\n    let reconnectAttempt = 0;\n    const retryDelays = [1000, 3000, 10000, 30000];\n\n    const scheduleHeartbeat = (delay) => {\n      window.clearTimeout(heartbeatTimer);\n      if (cancelled || document.visibilityState !== "visible") return;\n      heartbeatTimer = window.setTimeout(runHeartbeat, delay);\n    };\n    const runHeartbeat = async () => {\n      if (cancelled || document.visibilityState !== "visible") return;\n      heartbeatController?.abort();\n      heartbeatController = new AbortController();\n      try {\n        const status = await pingWhatsAppExtension({ signal: heartbeatController.signal });\n        if (cancelled) return;\n        if (status.connectionState === "connected") {\n          reconnectAttempt = 0;\n          setExtensionStatus(status);\n          scheduleHeartbeat(30000);\n          return;\n        }\n        if (status.connectionState === "needs_page_reload") {\n          setExtensionStatus(status);\n          return;\n        }\n        const delay = retryDelays[Math.min(reconnectAttempt, retryDelays.length - 1)];\n        reconnectAttempt += 1;\n        setExtensionStatus({ ...status, connectionState: "reconnecting", message: "Reconectando la extensión…" });\n        scheduleHeartbeat(delay);\n      } catch (cause) {\n        if (cause?.name !== "AbortError" && !cancelled) scheduleHeartbeat(retryDelays[Math.min(reconnectAttempt++, retryDelays.length - 1)]);\n      }\n    };\n\n    runHeartbeat();\n    loadCampaigns();\n    const refreshWhenVisible = () => {\n      if (document.visibilityState === "visible") {\n        reconnectAttempt = 0;\n        runHeartbeat();\n      } else {\n        heartbeatController?.abort();\n        window.clearTimeout(heartbeatTimer);\n      }\n    };\n    document.addEventListener("visibilitychange", refreshWhenVisible);\n    window.addEventListener("focus", refreshWhenVisible);`
  ],
  [
`    return () => {\n      document.removeEventListener("visibilitychange", refreshWhenVisible);\n      window.removeEventListener("focus", refreshWhenVisible);\n      unsubscribe();\n    };`,
`    return () => {\n      cancelled = true;\n      heartbeatController?.abort();\n      window.clearTimeout(heartbeatTimer);\n      document.removeEventListener("visibilitychange", refreshWhenVisible);\n      window.removeEventListener("focus", refreshWhenVisible);\n      unsubscribe();\n    };`
  ],
  [
`          errorCode: message.payload.errorCode || "",\n          extensionVersion: message.payload.extensionVersion || "",`,
`          errorCode: message.payload.errorCode || "",\n          connectionState: message.payload.operational === true ? "connected" : message.payload.errorCode === "EXTENSION_CONTEXT_INVALIDATED" ? "needs_page_reload" : "disconnected",\n          extensionVersion: message.payload.extensionVersion || "",\n          bridgeInstanceId: message.payload.bridgeInstanceId || "",\n          bridgeGeneration: Number(message.payload.bridgeGeneration || 0),`
  ],
  [
`    <ExtensionStatus status={extensionStatus} refreshing={extensionBusy} onRefresh={diagnoseExtension} />`,
`    <ExtensionStatus status={extensionStatus} refreshing={extensionBusy} onRefresh={diagnoseExtension} onReconnect={reconnectExtension} />`
  ]
]);

const domainChanged = await patch("src/gestion/marketing/whatsapp/campaignDomain.js", [
  [
`  if (code === "WHATSAPP_NOT_OPEN") return "WhatsApp Web no está abierto. Abrilo para continuar.";`,
`  if (code === "EXTENSION_CONTEXT_INVALIDATED") return "Necesitamos reconectar la extensión.";\n  if (code === "WHATSAPP_NOT_OPEN") return "WhatsApp Web no está abierto. Abrilo para continuar.";`
  ],
  [
`export function extensionPrimaryStatus(status = {}) {\n  if (status.operational === true) {`,
`export function extensionPrimaryStatus(status = {}) {\n  if (status.connectionState === "needs_page_reload") {\n    return { operational: false, label: "Necesitamos reconectar la extensión", tone: "warning", message: "Usá Reconectar para actualizar esta pantalla y volver a enlazar la extensión." };\n  }\n  if (status.connectionState === "reconnecting") {\n    return { operational: false, label: "Reconectando…", tone: "info", message: status.message || "Restableciendo la conexión con la extensión." };\n  }\n  if (status.connectionState === "disconnected") {\n    return { operational: false, label: "Extensión desconectada", tone: "error", message: status.message || "No pudimos contactar la extensión." };\n  }\n  if (status.operational === true) {`
  ]
]);

console.log(JSON.stringify({ pageChanged, domainChanged }));
