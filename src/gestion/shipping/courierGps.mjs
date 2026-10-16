// A green confirmation means a real position was acknowledged by the server.
// A session prevents late requests from publishing again after stop/restart.
export function createCourierGps({ request, onChange, geolocation, secure = true, clock = Date.now, makeId = () => crypto.randomUUID(), every = setInterval, cancelEvery = clearInterval }) {
  let session = null, watch = null, timer = null, pending = null, lastSent = 0;
  const emit = (phase, message, extra = {}) => onChange({ phase, message, active: Boolean(session), ...extra });
  const send = async (body, options = {}) => {
    const controller = new AbortController();
    pending = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await request(body, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); if (pending === controller) pending = null; }
  };
  const clear = () => {
    if (watch !== null) geolocation?.clearWatch(watch);
    if (timer !== null) cancelEvery(timer);
    watch = timer = null;
    pending?.abort(); pending = null;
  };
  const stop = async (message = "No estás compartiendo tu ubicación.", notify = true) => {
    const previous = session; session = null; clear();
    if (notify) emit("stopped", message);
    if (!previous) return;
    try { await request({ mode: "gps_stop", gpsSessionId: previous }, { keepalive: true }); }
    catch { if (notify && !session) emit("error", "Se detuvo el GPS en este teléfono, pero falta confirmar la desconexión con el servidor. La última posición caduca automáticamente."); }
  };
  const start = async () => {
    if (session) return;
    if (!secure || !geolocation) { emit("error", "GPS no disponible. Abrí el enlace HTTPS en Chrome o Safari del teléfono."); return; }
    const current = makeId(); session = current; lastSent = 0;
    emit("waiting", "Esperando permiso y ubicación del teléfono…");
    try { await send({ mode: "gps_start", gpsSessionId: current }); }
    catch (error) { if (session === current) { session = null; emit("error", error.name === "AbortError" ? "El servidor no respondió. Revisá tu conexión y volvé a intentar." : error.message); } return; }
    if (session !== current) return;
    const failed = error => {
      if (session !== current) return;
      const message = error.code === 1 ? "Permiso de ubicación denegado. Habilitá Ubicación para este sitio en el navegador y volvé a intentar."
        : error.code === 3 ? "El teléfono tardó demasiado en obtener ubicación. Activá la ubicación del equipo y volvé a intentar al aire libre."
        : "No se pudo obtener ubicación. Revisá que la ubicación del teléfono esté activa y volvé a intentar.";
      void stop(message, false); emit("error", message);
    };
    const located = async position => {
      if (session !== current || pending || clock() - lastSent < 15000) return;
      emit("sending", "Enviando ubicación al seguimiento…");
      try {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, observedAt: new Date(position.timestamp).toISOString() };
        const acknowledgement = await send({ mode: "position", gpsSessionId: current, point });
        if (acknowledgement?.saved !== true) throw new Error("No se confirmó la posición.");
        if (session !== current) return;
        lastSent = clock();
        emit("sharing", "Estás compartiendo tu ubicación en camino al cliente.", { confirmedAt: new Date(lastSent).toISOString(), accuracy: point.accuracy });
      } catch (error) {
        if (session !== current) return;
        if ([401, 403, 409].includes(error.status)) { void stop("", false); emit("error", error.message); }
        else emit("error", "No se confirmó el envío de ubicación. Revisá la conexión; volveremos a intentar mientras mantengas abierto este panel.");
      }
    };
    const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
    try {
      watch = geolocation.watchPosition(located, failed, options);
      // Refresh even when stationary; never manufacture a new GPS timestamp.
      timer = every(() => {
        if (session !== current || pending) return;
        if (clock() - lastSent > 45000) emit("waiting", "Esperando una ubicación actualizada; la señal anterior no confirma seguimiento activo.");
        geolocation.getCurrentPosition(located, failed, options);
      }, 20000);
    } catch { failed({ code: 2 }); }
  };
  return { start, stop };
}
