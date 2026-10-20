const EXCEPTION_MESSAGES = {
  cancelado: "Este envío fue cancelado.",
  devuelto: "El pedido está en proceso de devolución.",
  no_entregado: "La entrega no se pudo completar. Flor Mía revisará el próximo paso.",
  rechazado: "La solicitud de envío fue rechazada.",
};

const DIRECT_STEPS = ["Pedido recibido", "Preparando", "Listo para salir", "En camino", "Entregado"];
const REPOSITORY_STEPS = ["Pedido recibido", "Preparando", "Listo para salir", "Hacia el repositorio", "En repositorio", "Hacia tu domicilio", "Entregado"];
const KNOWN_STATES = new Set(["solicitud_pendiente", "approved", "aprobado", "en_preparacion", "listo_retirar", "retirado_origen", "hacia_repositorio", "recibido_repositorio", "reparto_final", "entregado", ...Object.keys(EXCEPTION_MESSAGES)]);

export function deliveryJourney(deliveryType, status) {
  const repository = deliveryType === "repository";
  const steps = repository ? REPOSITORY_STEPS : DIRECT_STEPS;
  const exception = EXCEPTION_MESSAGES[status];
  if (exception) return { steps, index: -1, scene: "paused", message: exception, inMotion: false, exception: true };
  if (!KNOWN_STATES.has(status)) return { steps, index: -1, scene: "paused", message: "El estado de este envío está en revisión.", inMotion: false, exception: true };

  if (repository) {
    const index = ({ en_preparacion: 1, listo_retirar: 2, retirado_origen: 3, hacia_repositorio: 3, recibido_repositorio: 4, reparto_final: 5, entregado: 6 })[status] ?? 0;
    const messages = {
      solicitud_pendiente: "Recibimos tu pedido y Flor Mía lo está revisando.",
      approved: "Recibimos tu pedido.",
      aprobado: "Recibimos tu pedido.",
      en_preparacion: "Estamos preparando tu pedido con mucho cuidado.",
      listo_retirar: "Tu pedido está listo para salir de Flor Mía.",
      retirado_origen: "El pedido salió del local rumbo al repositorio.",
      hacia_repositorio: "El pedido salió del local rumbo al repositorio.",
      recibido_repositorio: "El pedido llegó al repositorio y espera el siguiente tramo.",
      reparto_final: "El pedido salió del repositorio y va hacia tu domicilio.",
      entregado: "Tu pedido llegó a destino.",
    };
    return { steps, index, scene: repositoryScene(status), message: messages[status] || "Recibimos tu pedido.", inMotion: ["hacia_repositorio", "reparto_final"].includes(status), exception: false };
  }

  const index = ({ en_preparacion: 1, listo_retirar: 2, retirado_origen: 3, reparto_final: 3, entregado: 4 })[status] ?? 0;
  const messages = {
    solicitud_pendiente: "Recibimos tu pedido y Flor Mía lo está revisando.",
    approved: "Recibimos tu pedido.",
    aprobado: "Recibimos tu pedido.",
    en_preparacion: "Estamos preparando tu pedido con mucho cuidado.",
    listo_retirar: "Tu pedido está listo para salir de Flor Mía.",
    retirado_origen: "El pedido salió de Flor Mía y va hacia tu domicilio.",
    reparto_final: "El pedido salió de Flor Mía y va hacia tu domicilio.",
    entregado: "Tu pedido llegó a destino.",
  };
  return { steps, index, scene: directScene(status), message: messages[status] || "Recibimos tu pedido.", inMotion: ["retirado_origen", "reparto_final"].includes(status), exception: false };
}

function repositoryScene(status) {
  if (status === "hacia_repositorio" || status === "retirado_origen") return "to-repository";
  if (status === "recibido_repositorio") return "at-repository";
  if (status === "reparto_final") return "to-customer";
  if (status === "entregado") return "delivered";
  if (status === "listo_retirar") return "ready";
  if (status === "en_preparacion") return "preparing";
  return "received";
}

function directScene(status) {
  if (status === "reparto_final" || status === "retirado_origen") return "to-customer";
  if (status === "entregado") return "delivered";
  if (status === "listo_retirar") return "ready";
  if (status === "en_preparacion") return "preparing";
  return "received";
}
