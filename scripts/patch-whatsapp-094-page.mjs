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
`    let heartbeatController = null;\n    let reconnectAttempt = 0;\n    const retryDelays = [1000, 3000, 10000, 30000];`,
`    let heartbeatController = null;\n    let heartbeatRunning = false;\n    let reconnectAttempt = 0;\n    const retryDelays = [1000, 3000, 10000, 30000];`
  ],
  [
`    const runHeartbeat = async () => {\n      if (cancelled || document.visibilityState !== "visible") return;\n      heartbeatController?.abort();\n      heartbeatController = new AbortController();\n      try {\n        const status = await pingWhatsAppExtension({ signal: heartbeatController.signal });\n        if (cancelled) return;\n        if (status.connectionState === "connected") {\n          reconnectAttempt = 0;\n          setExtensionStatus(status);\n          scheduleHeartbeat(30000);\n          return;\n        }\n        if (status.connectionState === "needs_page_reload") {\n          setExtensionStatus(status);\n          return;\n        }\n        const delay = retryDelays[Math.min(reconnectAttempt, retryDelays.length - 1)];\n        reconnectAttempt += 1;\n        setExtensionStatus({ ...status, connectionState: "reconnecting", message: "Reconectando la extensión…" });\n        scheduleHeartbeat(delay);\n      } catch (cause) {\n        if (cause?.name !== "AbortError" && !cancelled) scheduleHeartbeat(retryDelays[Math.min(reconnectAttempt++, retryDelays.length - 1)]);\n      }\n    };`,
`    const runHeartbeat = async () => {\n      if (cancelled || document.visibilityState !== "visible" || heartbeatRunning) return;\n      heartbeatRunning = true;\n      const controller = new AbortController();\n      heartbeatController = controller;\n      try {\n        const status = await pingWhatsAppExtension({ signal: controller.signal });\n        if (cancelled || controller.signal.aborted) return;\n        if (status.connectionState === "connected") {\n          reconnectAttempt = 0;\n          setExtensionStatus(status);\n          scheduleHeartbeat(60000);\n          return;\n        }\n        if (status.connectionState === "needs_page_reload") {\n          setExtensionStatus(status);\n          return;\n        }\n        if (reconnectAttempt >= retryDelays.length) {\n          setExtensionStatus({ ...status, connectionState: "disconnected", message: status.message || "No pudimos contactar la extensión." });\n          return;\n        }\n        const delay = retryDelays[reconnectAttempt];\n        reconnectAttempt += 1;\n        setExtensionStatus({ ...status, connectionState: "reconnecting", message: "Reconectando la extensión…" });\n        scheduleHeartbeat(delay);\n      } catch (cause) {\n        if (cause?.name === "AbortError" || cancelled) return;\n        if (reconnectAttempt >= retryDelays.length) {\n          setExtensionStatus((current) => ({ ...current, operational: false, connectionState: "disconnected", message: "No pudimos contactar la extensión." }));\n          return;\n        }\n        scheduleHeartbeat(retryDelays[reconnectAttempt]);\n        reconnectAttempt += 1;\n      } finally {\n        if (heartbeatController === controller) heartbeatController = null;\n        heartbeatRunning = false;\n      }\n    };`
  ]
]);

const bridgeChanged = await patch("src/gestion/marketing/whatsapp/extensionBridge.js", [
  [
`  pingInFlight = operation;\n  void operation.finally(() => {\n    if (pingInFlight === operation) pingInFlight = null;\n  });\n  return operation;`,
`  pingInFlight = operation;\n  const clear = () => {\n    if (pingInFlight === operation) pingInFlight = null;\n  };\n  operation.then(clear, clear);\n  return operation;`
  ]
]);

console.log(JSON.stringify({ pageChanged, bridgeChanged }));
