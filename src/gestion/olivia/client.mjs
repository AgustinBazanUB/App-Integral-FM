import { readEventStream } from "../../shared/oliviaStream.mjs";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestId() {
  return globalThis.crypto.randomUUID();
}

// Only an opaque identifier is persisted locally. Messages and credentials stay out of storage.
export function conversationForUser(userId, storage) {
  const key = `flor-mia-olivia:${userId}`;
  let id;
  try { storage ??= globalThis.sessionStorage; id = storage?.getItem(key); } catch { /* Storage may be unavailable. */ }
  return UUID_PATTERN.test(id || "") ? id : null;
}

export function rememberConversation(userId, id, storage) {
  if (!UUID_PATTERN.test(id || "")) return;
  try { storage ??= globalThis.sessionStorage; storage?.setItem(`flor-mia-olivia:${userId}`, id); } catch { /* Optional persistence. */ }
}

export function forgetConversation(userId, storage) {
  try { storage ??= globalThis.sessionStorage; storage?.removeItem(`flor-mia-olivia:${userId}`); } catch { /* Optional persistence. */ }
}

export function safeNavigation(path, origin = "https://flor-mia.invalid") {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  try {
    const url = new URL(path, origin);
    if (url.origin !== origin || !/^\/(gestion|vendedor)(\/|$)/.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return null; }
}

export const OPERATION_LABELS = {
  information: "Consulta", consulta: "Consulta", INFORMACION: "Consulta", INFORMACIÓN: "Consulta",
  preparing: "Preparando acción", PREPARANDO_ACCION: "Preparando acción", PREPARANDO_ACCIÓN: "Preparando acción",
  needs_input: "Faltan datos", DATOS_INCOMPLETOS: "Faltan datos",
  awaiting_confirmation: "Esperando confirmación", ESPERANDO_CONFIRMACION: "Esperando confirmación",
  executing: "Ejecutando", EJECUTANDO: "Ejecutando",
  completed: "Acción completada", COMPLETADA: "Acción completada",
  rejected: "Acción rechazada", RECHAZADA: "Acción rechazada",
  cancelled: "Acción cancelada", CANCELADA: "Acción cancelada", error: "Error", ERROR: "Error",
};

export function operationLabel(state, pendingAction) {
  if (pendingAction) return "Esperando confirmación";
  return OPERATION_LABELS[typeof state === "string" ? state : state?.status] || "Consulta";
}

export function pendingExpired(action, now = Date.now()) {
  if (!action?.expiresAt) return false;
  const expires = typeof action.expiresAt === "number"
    ? (action.expiresAt < 1e12 ? action.expiresAt * 1000 : action.expiresAt)
    : Date.parse(action.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

export function prependHistoryMessages(older, current) {
  const messages = new Map();
  for (const message of [...(older || []), ...(current || [])]) {
    const key = message.id || `${message.role}:${message.createdAt}:${message.content}`;
    messages.set(key, message);
  }
  return [...messages.values()];
}

export function createOliviaTransport({ getToken, fetchImpl = globalThis.fetch, timeoutMs = 60000 }) {
  const send = async (endpoint, body, { signal, isForm = false, keepalive = false, onEvent } = {}) => {
    const token = await getToken();
    if (!token) throw new Error("Iniciá sesión para usar Olivia.");
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST", signal: controller.signal, keepalive,
        headers: { Authorization: `Bearer ${token}`, ...(!isForm ? { "Content-Type": "application/json" } : {}) },
        body: isForm ? body : JSON.stringify(body),
      });
      if (response.ok && onEvent && response.headers.get("content-type")?.includes("text/event-stream")) {
        let result;
        await readEventStream(response.body, (event) => {
          onEvent(event);
          if (event.type === "completed") result = event.result;
          if (event.type === "failed") throw Object.assign(new Error(event.message), { code: event.code });
        }, { signal: controller.signal });
        if (!result) throw Object.assign(new Error("La respuesta quedó incompleta. Recuperá el chat antes de reintentar."), { code: "stream-incomplete" });
        return result;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        const error = new Error(data.message || data.error?.message || "Olivia no pudo completar la solicitud. Podés continuar en el panel.");
        error.code = data.code || data.error?.code || "olivia-request-failed";
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (failure) {
      if (timedOut) throw Object.assign(new Error("La solicitud tardó demasiado. Podés reintentar; los cambios no se duplican."), { code: "olivia-timeout" });
      if (failure instanceof TypeError) throw Object.assign(new Error("No pudimos conectar con Olivia. Revisá tu conexión y reintentá."), { code: "olivia-network-error" });
      throw failure;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  };
  return {
    request: (payload, options) => send("/.netlify/functions/olivia", payload, options),
    knowledge: (payload, options) => send("/.netlify/functions/olivia-knowledge", payload, options),
    publishKnowledge: (file, payload, options) => {
      const form = new FormData(); form.set("file", file, file.name);
      Object.entries(payload).forEach(([key, value]) => form.set(key, String(value)));
      return send("/.netlify/functions/olivia-knowledge", form, { ...options, isForm: true });
    },
    upload: (file, payload, options) => {
      if (!file?.size || file.size > 4 * 1024 * 1024) throw new Error("Elegí un archivo de hasta 4 MB.");
      const form = new FormData(); form.set("file", file, file.name);
      Object.entries(payload).forEach(([key, value]) => { if (value != null) form.set(key, String(value)); });
      return send("/.netlify/functions/olivia-attachment", form, { ...options, isForm: true });
    },
    transcribe: (audio, payload, options) => {
      if (!audio?.size || audio.size > 4 * 1024 * 1024) throw new Error("El audio debe ocupar entre 1 byte y 4 MB. Grabá un mensaje más corto.");
      const form = new FormData();
      const extension = audio.type?.includes("mp4") ? "mp4" : audio.type?.includes("ogg") ? "ogg" : "webm";
      form.set("audio", audio, `olivia.${extension}`);
      Object.entries(payload).forEach(([key, value]) => { if (value != null) form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value)); });
      return send("/.netlify/functions/olivia-transcribe", form, { ...options, isForm: true });
    },
  };
}
