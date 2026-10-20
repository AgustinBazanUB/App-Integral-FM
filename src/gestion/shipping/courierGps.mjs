// Start the browser's location watch inside the departure button gesture. The
// server only enables publication after the shipment has entered its final leg.
export function createCourierGps({ request, onChange, geolocation, secure = true, clock = Date.now, makeId = () => crypto.randomUUID(), every = setInterval, cancelEvery = clearInterval }) {
  let session = null, watch = null, timer = null, pending = null, lastSent = 0, trail = [];
  let visibilityListener = null, onlineListener = null, offlineListener = null;
  let serverActive = false, activation = null, bufferedPosition = null, locationError = "";
  const emit = (phase, message, extra = {}) => onChange({ phase, message, active: Boolean(session) && !locationError, ...extra });
  const send = async (body, options = {}) => {
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await request(body, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); if (pending === controller) pending = null; }
  };
  const clearWatchers = () => {
    if (watch !== null) geolocation?.clearWatch(watch);
    if (timer !== null) cancelEvery(timer);
    if (visibilityListener && typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityListener);
    if (onlineListener && typeof window !== "undefined") window.removeEventListener("online", onlineListener);
    if (offlineListener && typeof window !== "undefined") window.removeEventListener("offline", offlineListener);
    watch = timer = null;
    visibilityListener = onlineListener = offlineListener = null;
  };
  const clear = () => { clearWatchers(); pending?.abort(); pending = null; };
  const stop = async (message = "No estás compartiendo tu ubicación.", notify = true) => {
    const previous = session, stopOnServer = serverActive;
    session = null; serverActive = false; activation = null; bufferedPosition = null; locationError = "";
    clear();
    if (notify) emit("stopped", message);
    if (!previous || !stopOnServer) return;
    try { await request({ mode: "gps_stop", gpsSessionId: previous }, { keepalive: true }); }
    catch { if (notify && !session) emit("error", "Se detuvo el GPS en este teléfono, pero falta confirmar la desconexión con el servidor. La última posición caduca automáticamente."); }
  };
  const errorMessage = error => error.code === 1
    ? "Chrome no tiene permiso de ubicación. En iPhone revisá Ajustes > Chrome > Ubicación, habilitala y volvé a tocar Reintentar ubicación."
    : error.code === 3
      ? "El teléfono tardó demasiado en obtener ubicación. Activá Localización, probá al aire libre y volvé a intentar."
      : "No se pudo obtener ubicación. Revisá que Localización esté activa en el teléfono y volvé a intentar.";
  const located = async (current, position) => {
    if (session !== current) return;
    if (!serverActive) { bufferedPosition = position; return; }
    if (pending || clock() - lastSent < 15000) return;
    emit("sending", "Enviando ubicación al seguimiento…");
    try {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, observedAt: new Date(position.timestamp).toISOString() };
      const acknowledgement = await send({ mode: "position", gpsSessionId: current, point });
      if (acknowledgement?.saved !== true) throw new Error("No se confirmó la posición.");
      if (session !== current) return;
      lastSent = clock();
      trail = [...trail, point].slice(-120);
      emit("sharing", "Estás compartiendo tu ubicación en camino al cliente.", { confirmedAt: new Date(lastSent).toISOString(), accuracy: point.accuracy, position: point, trail });
    } catch (error) {
      if (session !== current) return;
      if ([401, 403, 409].includes(error.status)) { void stop("", false); emit("error", error.message); }
      else emit("error", "No se confirmó el envío de ubicación. Revisá la conexión; volveremos a intentar mientras mantengas abierto este panel.");
    }
  };
  const failed = (current, error) => {
    if (session !== current) return;
    const message = errorMessage(error);
    bufferedPosition = null;
    if (!serverActive) {
      locationError = message;
      clearWatchers();
      emit("error", message);
      return;
    }
    return stop(message, false).then(() => emit("error", message));
  };
  const prepare = () => {
    if (!secure || !geolocation) { emit("error", "GPS no disponible. Abrí el enlace HTTPS en Chrome o Safari del teléfono."); return null; }
    if (session && !locationError) return session;
    if (session) { session = null; serverActive = false; activation = null; clear(); }
    const current = makeId();
    session = current; serverActive = false; activation = null; locationError = ""; bufferedPosition = null; lastSent = 0; trail = [];
    emit("waiting", "Solicitando permiso y ubicación del teléfono…");
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
    const onPosition = position => {
      if (session !== current) return;
      if (!serverActive) { bufferedPosition = position; emit("waiting", "Ubicación obtenida. Activando el seguimiento al cliente…"); }
      else return located(current, position);
    };
    try {
      // This synchronous call must happen before any network await. On mobile,
      // that keeps the native permission prompt attached to the departure tap.
      watch = geolocation.watchPosition(onPosition, error => failed(current, error), options);
      if (locationError) { clearWatchers(); return current; }
      timer = every(() => {
        if (session !== current || pending || !serverActive) return;
        if (clock() - lastSent > 45000) emit("waiting", "Esperando una ubicación actualizada; la señal anterior no confirma seguimiento activo.");
        geolocation.getCurrentPosition(onPosition, error => failed(current, error), options);
      }, 15000);
      if (typeof document !== "undefined") {
        visibilityListener = () => {
          if (session !== current) return;
          if (document.visibilityState === "hidden") emit("background", "El navegador puede pausar el GPS en segundo plano. Mantené el panel abierto y volvé a esta pantalla para actualizar.");
          else if (serverActive) { emit("waiting", "Recuperando una ubicación actual del teléfono…"); geolocation.getCurrentPosition(onPosition, error => failed(current, error), options); }
        };
        document.addEventListener("visibilitychange", visibilityListener);
      }
      if (typeof window !== "undefined") {
        offlineListener = () => { if (session === current) emit("error", "Sin conexión. El GPS local sigue activo, pero la posición no se confirma hasta recuperar Internet."); };
        onlineListener = () => { if (session === current && serverActive) { emit("waiting", "Conexión recuperada; buscando una ubicación nueva…"); geolocation.getCurrentPosition(onPosition, error => failed(current, error), options); } };
        window.addEventListener("offline", offlineListener);
        window.addEventListener("online", onlineListener);
      }
    } catch { failed(current, { code: 2 }); }
    return current;
  };
  const start = async ({ retry = false } = {}) => {
    if (retry && session && serverActive) {
      locationError = "";
      emit("waiting", "Buscando una ubicación nueva del teléfono…");
      try { geolocation.getCurrentPosition(position => void located(session, position), error => failed(session, error), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }); }
      catch { failed(session, { code: 2 }); }
      return true;
    }
    if (retry && session && locationError) { session = null; serverActive = false; activation = null; clear(); }
    const current = session || prepare();
    if (!current || locationError) return false;
    if (serverActive) return true;
    if (activation) return activation;
    const attempt = (async () => {
      emit("waiting", "Conectando el seguimiento del envío…");
      try {
        const acknowledgement = await send({ mode: "gps_start", gpsSessionId: current });
        if (acknowledgement?.started !== true) throw new Error("El servidor no confirmó el inicio del seguimiento.");
      } catch (error) {
        if (session === current) { session = null; serverActive = false; clear(); emit("error", error.name === "AbortError" ? "El servidor no respondió. Revisá tu conexión y volvé a intentar." : error.message); }
        return false;
      }
      if (session !== current) {
        void request({ mode: "gps_stop", gpsSessionId: current }, { keepalive: true });
        return false;
      }
      serverActive = true;
      if (locationError) {
        const message = locationError;
        await stop("", false);
        emit("error", message);
        return false;
      }
      const firstPosition = bufferedPosition;
      bufferedPosition = null;
      if (firstPosition) await located(current, firstPosition);
      return true;
    })();
    activation = attempt;
    const result = await attempt;
    if (activation === attempt && !serverActive) activation = null;
    return result;
  };
  return { prepare, start, stop };
}
