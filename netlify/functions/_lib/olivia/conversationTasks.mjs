import { updateTask, missingQuestion } from "./tasks.mjs";

const normalize = (text = "") => String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const active = (task) => task && ["collecting", "prepared", "paused"].includes(task.status);
const MAX_PAUSED_TASKS = 5;

// Explicit self-corrections supersede the earlier clause, including its nouns.
// This is intent routing only: it never resolves entities or authorizes writes.
export function latestInstruction(message = "") {
  return normalize(message).split(/\b(?:queria decir(?:te)?|quise decir(?:te)?|en realidad|en vez de eso|mejor dicho)\b/).at(-1).trim();
}

export function requestedTaskIntent(message = "") {
  const text = latestInstruction(message);
  if (!/carg|crea|registra|agrega|ingresa|dar de alta|alta de|quiero.*cliente/.test(text)) return null;
  if (/campana|publicacion|post |reel|anuncio/.test(text)) return null;
  if (/\bcliente\b/.test(text)) return "prepare_customer_create";
  if (/transfer|traslad/.test(text)) return "prepare_stock_transfer";
  if (/\bventa\b/.test(text)) return "prepare_sale";
  if (/\bstock\b|botellas?|mercaderia|unidades/.test(text)) return "prepare_stock_load";
  return null;
}

export function isTaskInterruption(message = "") {
  const text = latestInstruction(message);
  return /\b(?:explic[a-z]*|ensen[a-z]*|instruime|guiame|orientame|ayudame a entender)\b/.test(text)
    || /^(?:antes |otra cosa|ahora |mientras |como |por que |cuant[a-z]* |analiza|estima|compara|pronostica|mostra|decime|consulta|revisa|calcula|quiero saber|necesito saber|que puedo|que podes|que ventas|que paso)/.test(text);
}

function pauseInto(tasks, task, now) {
  if (!active(task)) return tasks;
  // A paused proposal stores data, never a confirmation or an execution token.
  const saved = { id: task.id, intent: task.intent, revision: task.revision || 1, status: "paused", slots: structuredClone(task.slots || {}), missingFields: [...(task.missingFields || [])], ambiguities: structuredClone(task.ambiguities || {}), route: task.route || null, createdAt: task.createdAt || now, updatedAt: now };
  return [...tasks.filter((item) => item.id !== saved.id), saved].slice(-MAX_PAUSED_TASKS);
}

export function manageConversationTask({ task = null, suspendedTasks = [] }, action, taskId = null, now = new Date()) {
  let paused = suspendedTasks.filter(active).slice(-MAX_PAUSED_TASKS);
  if (action === "pause") return { task: null, suspendedTasks: pauseInto(paused, task, now) };
  if (action === "cancel") {
    if (taskId && task?.id !== taskId) return { task, suspendedTasks: paused.filter((item) => item.id !== taskId) };
    return { task: task ? { ...task, status: "cancelled", revision: (task.revision || 0) + 1, updatedAt: now } : null, suspendedTasks: paused };
  }
  if (action !== "resume") throw new Error("Control de tarea inválido.");
  const selected = taskId ? paused.find((item) => item.id === taskId) : paused.at(-1);
  if (!selected) return { task, suspendedTasks: paused, notFound: true };
  paused = pauseInto(paused.filter((item) => item.id !== selected.id), task, now);
  return { task: { ...selected, status: "collecting", revision: selected.revision + 1, updatedAt: now }, suspendedTasks: paused };
}

export const taskManagementTool = () => ({
  type: "function", name: "manage_task", strict: true,
  description: "Pausar, cancelar o retomar una tarea conversacional. Antes de responder una consulta lateral, pausá la operación para conservar sus datos. Para retomar, usá un taskId real de suspendedTasks, o null para la última. Nunca ejecuta operaciones ni restaura una confirmación: hay que preparar una tarjeta nueva. La instrucción más reciente del usuario manda.",
  parameters: { type: "object", additionalProperties: false, required: ["action", "taskId"], properties: { action: { type: "string", enum: ["pause", "resume", "cancel"] }, taskId: { anyOf: [{ type: "string", maxLength: 128 }, { type: "null" }] } } },
});

export function transitionConversationTask(conversation, message, now = new Date()) {
  let task = active(conversation.taskState) ? structuredClone(conversation.taskState) : null;
  let suspendedTasks = (conversation.suspendedTasks || []).filter(active).slice(-MAX_PAUSED_TASKS);
  const text = normalize(message), latest = latestInstruction(message), target = requestedTaskIntent(message);
  const cancelled = /\b(?:no (?:me )?(?:lo )?(?:cargues|cargue|carguen|registres|agregues|hagas|sigas)|(?:ya )?no (?:quiero|necesito|vamos a) (?:cargar|registrar|agregar|seguir|hacer)|cancel[a-z]*|olvidalo|dejalo|dejemos(?:lo)?)\b/.test(text);
  const resume = /\b(?:retom[a-z]*|volvamos|continuemos|sigamos)\b|^(?:segui|continua)(?: |$)/.test(latest);
  const pause = /\b(?:paus[a-z]*|deja(?:lo|la)? (?:para despues|pendiente)|guard[a-z]*.*(?:despues|pendiente))\b/.test(latest);
  let handled = false, content = "", directive = null;
  if (resume && !cancelled) {
    const requested = /stock/.test(latest) ? "prepare_stock_load" : /client/.test(latest) ? "prepare_customer_create" : null;
    const selected = requested ? suspendedTasks.filter((item) => item.intent === requested).at(-1) : suspendedTasks.at(-1);
    const result = manageConversationTask({ task, suspendedTasks }, "resume", selected?.id || (requested ? "missing" : null), now);
    ({ task, suspendedTasks } = result); handled = true; directive = "resume";
    content = result.notFound ? "No encontré esa tarea pausada. Decime qué querés retomar." : `Retomamos la tarea con los datos que habíamos reunido. ${missingQuestion(task.missingFields)}`;
  } else if (cancelled && (!target || target === task?.intent) && latest === text) {
    ({ task, suspendedTasks } = manageConversationTask({ task, suspendedTasks }, "cancel", null, now));
    handled = true; directive = "cancel"; content = "De acuerdo, cancelé esa tarea. ¿Con qué seguimos?";
  } else if (target && target !== task?.intent) {
    if (!cancelled) suspendedTasks = pauseInto(suspendedTasks, task, now);
    task = updateTask(null, target, "{}", now); directive = "switch";
  } else if (pause || (active(task) && isTaskInterruption(message))) {
    ({ task, suspendedTasks } = manageConversationTask({ task, suspendedTasks }, "pause", null, now));
    directive = "pause";
    if (pause && !isTaskInterruption(message)) { handled = true; content = "Guardé los datos de la tarea para retomarla cuando quieras. ¿Con qué seguimos?"; }
  }
  // Bare starts do not need a reasoning round merely to ask for missing data.
  if (target && !cancelled && /(?:stock|cliente)(?: nuevo)?$/.test(latest) && /(?:carg|crea|registra|agrega|ingresa|alta)/.test(latest) && !/\d/.test(latest) && !isTaskInterruption(message)) {
    handled = true; directive ||= "start";
    content = target === "prepare_customer_create" ? "¿Cómo se llama el cliente y cuál es su teléfono?" : "¿Qué producto querés cargar y en qué ubicación?";
  } else if (directive === "switch" && /cliente$/.test(latest)) {
    handled = true; content = "De acuerdo, pasamos al cliente. ¿Cómo se llama y cuál es su teléfono?";
  }
  return { task, suspendedTasks, handled, content, directive };
}
