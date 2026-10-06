import { randomUUID } from "node:crypto";
import { normalizedRole } from "../../../../src/gestion/permissions.js";
import { oliviaError, safeId } from "../../../../src/shared/oliviaContracts.mjs";
import { sessionBinding } from "./conversations.mjs";
import { assertOliviaAccess } from "./guards.mjs";
import { OLIVIA_CAPABILITIES } from "../../../../src/shared/oliviaCapabilities.mjs";
import { OLIVIA_TOOL_SCHEMAS } from "../../../../src/shared/oliviaContracts.mjs";
const descriptions = {
  "assistant-timeout": "La consulta necesitó más tiempo del disponible.",
  "provider-timeout": "El servicio de IA tardó demasiado en responder.",
  "openai-timeout": "El servicio de IA tardó demasiado en responder.",
  "openai-unavailable": "El servicio de IA no está disponible en este momento.",
  "openai-error": "El servicio de IA no pudo completar la respuesta.",
  "openai-incomplete": "El servicio de IA devolvió una respuesta incompleta.",
  "openai-rate-limit": "El servicio de IA alcanzó su límite temporal. Intentá más tarde.",
  "openai-key-missing": "La conexión de Olivia necesita revisión del administrador.",
  "invalid-input": "No pude interpretar uno de los datos. Revisá productos, cantidades y formas de pago.",
  "provider-error": "El servicio de IA no pudo completar la respuesta.",
  "tool-limit": "La consulta necesitó más pasos de los permitidos.",
  "permission-denied": "Tu usuario no tiene permiso para realizar esta acción.",
  "context-changed": "Los datos cambiaron mientras revisabas la propuesta. Pedile a Olivia que la prepare nuevamente.",
  "context-unavailable": "El producto o la ubicación ya no está disponible.",
  "backend-not-configured": "La configuración de Olivia necesita revisión.",
  "seller/insufficient-stock": "El depósito no tiene stock suficiente para toda la lista.",
  "assistant-error": "No pude completar esta solicitud por un problema interno.",
  "chat-job-expired": "No pude terminar esta consulta a tiempo. Los datos del chat se conservan.",
  "chat-dispatch-failed": "No pude iniciar esta consulta. Podés volver a intentarlo.",
};
export function publicOliviaFailure(error) {
  const code = /^[a-zA-Z0-9_/-]{1,80}$/.test(error?.code || "") ? error.code : "assistant-error";
  const message = descriptions[code] || (error?.status >= 400 && error.status < 500 ? String(error.message).slice(0, 500) : descriptions["assistant-error"]);
  return { code, message: `Olivia no pudo realizar la solicitud. ${message}`, ...(error?.reportId ? { reportId: error.reportId } : {}) };
}
export async function captureOliviaFailure({ store, session, error, operation, conversationId, requestId, now = new Date() }) {
  if (error.reportId) return publicOliviaFailure(error);
  const failure = publicOliviaFailure(error), reportId = randomUUID();
  const diagnostics = { version: 1, error: { name: failure.code, code: failure.code, status: Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500, description: descriptions[failure.code] || "Una operación de Olivia falló; revisar el código y la traza técnica.", frames: String(error.stack || "").split("\n").slice(1, 7).map(line => line.match(/(?:[\\/])([A-Za-z0-9_.-]+\.(?:mjs|js|jsx)):(\d+):(\d+)/)?.slice(1).join(":")).filter(Boolean) }, operation: ["chat", "confirm", "startChat", "chatStatus", "background-chat"].includes(operation) ? operation : "assistant", conversationId: /^[A-Za-z0-9_-]{1,128}$/.test(conversationId || "") ? conversationId : null, requestId: /^[A-Za-z0-9_-]{1,128}$/.test(requestId || "") ? requestId : null, occurredAt: now.toISOString(), reporterId: session.uid };
  if (Object.hasOwn(OLIVIA_CAPABILITIES, error.oliviaToolName || "") || Object.hasOwn(OLIVIA_TOOL_SCHEMAS, error.oliviaToolName || "") || error.oliviaToolName === "update_task") diagnostics.tool = error.oliviaToolName;
  if ([400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504].includes(error.providerStatus)) diagnostics.error.providerStatus = error.providerStatus;
  if (["invalid_api_key", "insufficient_quota", "rate_limit_exceeded", "model_not_found", "unsupported_parameter", "invalid_value", "invalid_request_error", "context_length_exceeded", "server_error"].includes(error.providerErrorCode)) diagnostics.error.providerCode = error.providerErrorCode;
  await store.commit([{ type: "create", path: `oliviaErrorReports/${reportId}`, data: { userId: session.uid, sessionBinding: sessionBinding(session), status: "ready", diagnostics, createdAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000) } }]);
  error.reportId = reportId;
  return { ...failure, reportId };
}
export async function sendOliviaErrorReport({ store, session, body, now = new Date() }) {
  assertOliviaAccess(session);
  const reportId = safeId(body.reportId), path = `oliviaErrorReports/${reportId}`;
  const own = await store.get(path);
  if (!own || own.userId !== session.uid || own.sessionBinding !== sessionBinding(session) || new Date(own.expiresAt) <= now) throw oliviaError("report-not-found", "Este error ya no está disponible para enviar.", 404);
  if (own.status === "sent") return { reported: true, message: "Error enviado a Agustín." };
  const users = await store.list("users");
  const recipients = users.filter(user => user.active === true && user.deleted !== true && ["admin", "general_admin"].includes(normalizedRole(user)) && String(user.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().split(/\s+/)[0] === "agustin");
  if (recipients.length !== 1) throw oliviaError("report-recipient-unavailable", "No encontré una cuenta administradora única de Agustín. El error sigue guardado para revisarlo.", 409);
  const recipientId = safeId(recipients[0].id), alertId = `olivia_error_${reportId}`;
  await store.transaction(async tx => {
    const current = (await tx.getDocument(path))?.data;
    const recipient = (await tx.getDocument(`users/${recipientId}`))?.data;
    if (!current || current.userId !== session.uid || current.sessionBinding !== sessionBinding(session) || new Date(current.expiresAt) <= now) throw oliviaError("report-not-found", "Este error ya no está disponible.", 404);
    if (current.status === "sent") return;
    if (!recipient?.active || !["admin", "general_admin"].includes(normalizedRole(recipient)) || String(recipient.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().split(/\s+/)[0] !== "agustin") throw oliviaError("report-recipient-unavailable", "La cuenta de Agustín necesita revisión.", 409);
    const diagnosticJson = JSON.stringify(current.diagnostics, null, 2);
    const codexDescription = `Revisá este error de Olivia en App Integral FM: ${current.diagnostics.error.code}. ${current.diagnostics.error.description}\nBuscá la causa con el identificador de consulta y la traza; preservá los permisos, la confirmación de acciones y evitá registros duplicados. No hay mensajes, credenciales ni datos de clientes en este reporte.\n\nJSON del error:\n${diagnosticJson}`;
    await tx.commitDocuments([{ type: "create", path: `alerts/${alertId}`, data: { name: `Olivia necesita revisión: ${current.diagnostics.error.code}`, notes: "Olivia detectó una función que no pudo completar. Revisá el detalle para corregirla.", moduleId: "ai", source: "olivia_error_report", active: true, status: "new", severity: "red", responsibleId: recipientId, responsibleName: recipient.name, createdBy: session.uid, createdAt: now, updatedAt: now, errorCode: current.diagnostics.error.code, diagnosticJson, codexDescription, reportId } }, { type: "update", path, data: { status: "sent", alertId, sentAt: now } }]);
  });
  return { reported: true, message: "Error enviado a Agustín." };
}
