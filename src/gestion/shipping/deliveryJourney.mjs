const EXCEPTION_MESSAGES = {
  cancelado: "Este envío fue cancelado.",
  devuelto: "El pedido está en proceso de devolución.",
  no_entregado: "La entrega no se pudo completar. Flor Mía revisará el próximo paso.",
  rechazado: "La solicitud de envío fue rechazada.",
};

const DIRECT_CHECKPOINTS = [
  { id: "received", label: "Pedido recibido", icon: "store" },
  { id: "ready", label: "Listo para retirar", icon: "package" },
  { id: "picked-up", label: "Repartidor lo retiró", icon: "bike" },
  { id: "delivered", label: "Entregado", icon: "home" },
];

const REPOSITORY_CHECKPOINTS = [
  DIRECT_CHECKPOINTS[0],
  DIRECT_CHECKPOINTS[1],
  DIRECT_CHECKPOINTS[2],
  { id: "at-repository", label: "Entregado en repositorio", icon: "warehouse" },
  { id: "left-repository", label: "Salió del repositorio", icon: "bike" },
  DIRECT_CHECKPOINTS[3],
];

const ACTIVE_STATES = new Set(["solicitud_pendiente", "approved", "aprobado", "en_preparacion", "listo_retirar", "retirado_origen", "hacia_repositorio", "recibido_repositorio", "reparto_final", "entregado"]);

const phase = (id, label, detail) => ({ id, label, detail });

export function deliveryJourney(deliveryType, status) {
  const repository = deliveryType === "repository";
  const checkpoints = repository ? REPOSITORY_CHECKPOINTS : DIRECT_CHECKPOINTS;
  const exceptionalMessage = EXCEPTION_MESSAGES[status];

  if (exceptionalMessage) return paused(checkpoints, exceptionalMessage);
  if (!ACTIVE_STATES.has(status)) return paused(checkpoints, "El estado de este envío está en revisión.");

  if (status === "entregado") {
    return { checkpoints, completedCount: checkpoints.length, scene: "delivered", packageAt: "home", message: "Tu pedido llegó a destino.", activePhase: null, inMotion: false, exception: false };
  }

  if (status === "solicitud_pendiente") {
    return {
      checkpoints,
      completedCount: 1,
      scene: "received",
      packageAt: "store",
      message: "Recibimos tu pedido y Flor Mía está confirmando los datos.",
      activePhase: phase("confirming", "Confirmando tu pedido", "En cuanto quede aprobado, el equipo empieza a prepararlo."),
      inMotion: false,
      exception: false,
    };
  }

  if (["approved", "aprobado", "en_preparacion"].includes(status)) {
    return {
      checkpoints,
      completedCount: 1,
      scene: "preparing",
      packageAt: "store",
      message: "Estamos preparando tu pedido con mucho cuidado.",
      activePhase: phase("preparing", "Preparando tu pedido", "El equipo lo está armando para dejarlo listo para el repartidor."),
      inMotion: false,
      exception: false,
    };
  }

  if (status === "listo_retirar") {
    return {
      checkpoints,
      completedCount: 2,
      scene: "ready",
      packageAt: "courier",
      message: "Tu pedido está listo para retirar.",
      activePhase: phase("waiting-at-origin", "Esperando al repartidor", "El pedido queda listo en Flor Mía hasta que confirmen el retiro."),
      inMotion: false,
      exception: false,
    };
  }

  if (repository && ["retirado_origen", "hacia_repositorio"].includes(status)) {
    return {
      checkpoints,
      completedCount: 3,
      scene: "to-repository",
      packageAt: "courier",
      message: "El repartidor ya retiró tu pedido y va hacia el repositorio.",
      activePhase: phase("to-repository", "En camino al repositorio", "El siguiente hito será la recepción del pedido en el repositorio."),
      inMotion: true,
      exception: false,
    };
  }

  if (repository && status === "recibido_repositorio") {
    return {
      checkpoints,
      completedCount: 4,
      scene: "waiting-courier",
      packageAt: "repository",
      message: "Tu pedido llegó al repositorio.",
      activePhase: phase("waiting-final-courier", "Esperando al repartidor", "Cuando retiren tu pedido, comenzará el tramo hacia tu domicilio."),
      inMotion: false,
      exception: false,
    };
  }

  if (repository && status === "reparto_final") {
    return {
      checkpoints,
      completedCount: 5,
      scene: "to-customer",
      packageAt: "courier",
      message: "Tu pedido salió del repositorio y va hacia tu domicilio.",
      activePhase: phase("to-customer", "Hacia tu domicilio", "El último hito se confirma cuando el repartidor entrega el pedido."),
      inMotion: true,
      exception: false,
    };
  }

  if (!repository && ["retirado_origen", "reparto_final"].includes(status)) {
    return {
      checkpoints,
      completedCount: 3,
      scene: "to-customer",
      packageAt: "courier",
      message: "El repartidor retiró tu pedido y va hacia tu domicilio.",
      activePhase: phase("to-customer", "Hacia tu domicilio", "El último hito se confirma cuando el repartidor entrega el pedido."),
      inMotion: true,
      exception: false,
    };
  }

  return paused(checkpoints, "El estado de este envío está en revisión.");
}

function paused(checkpoints, message) {
  return { checkpoints, completedCount: 0, scene: "paused", message, activePhase: null, inMotion: false, exception: true };
}
