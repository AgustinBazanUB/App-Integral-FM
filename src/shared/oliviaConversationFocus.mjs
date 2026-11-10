import { classifyGeminiLiveTurn, quickReadPlan } from './oliviaConversationRouter.mjs';
import { normalizeSpeech } from './oliviaSpeechText.mjs';
import { isIndependentBusinessRead } from './oliviaBusinessRead.mjs';

export const CONVERSATION_FOCUS_KINDS = Object.freeze([
  'ANSWER_SLOT', 'CORRECT_CURRENT', 'CHANGE_TARGET', 'NEW_INTENT',
  'INDEPENDENT_READ', 'PAUSE_DRAFT', 'DISCARD_DRAFT', 'RESUME_DRAFT',
  'TASK_STATUS', 'CANCEL_ACCEPTED_TASK', 'SOCIAL/GENERAL', 'AMBIGUOUS',
]);

const terminalDraft = new Set(['discarded', 'delegated', 'completed', 'cancelled', 'superseded']);
const textOf = value => String(value || '').trim().slice(0, 12000);
const hasPendingDraft = (focus = {}, context = {}) => {
  const status = focus.activeDraftId ? focus.draftStatus : context.voiceCollection?.status || context.taskState?.status || focus.draftStatus;
  return Boolean((focus.activeDraftId || context.voiceCollection || context.taskState?.status === 'collecting') && !terminalDraft.has(status));
};

function taskReference(text, tasks = []) {
  const normalized = normalizeSpeech(text);
  if (tasks.length === 1) return tasks[0];
  return tasks.find(task => task.id && normalized.includes(normalizeSpeech(task.id))) || null;
}

export function classifyConversationFocus(text, context = {}) {
  const raw = textOf(text), normalized = normalizeSpeech(raw);
  const focus = context.conversationFocus || context.focus || {};
  const voiceCollection = context.voiceCollection || null;
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const liveTasks = tasks.filter(task => !['completed', 'failed', 'cancelled'].includes(task.status));
  const pendingDraft = hasPendingDraft(focus, { ...context, voiceCollection });
  if (!normalized) return { kind: 'AMBIGUOUS', reason: 'empty-turn' };

  if (/\b(?:como va|como viene|estado|estado de|que paso con|ya termino|ya termino|en que quedo|que falta de)\b/.test(normalized) && /\b(?:tarea|solicitud|carga|stock|producto|cliente|envio|operacion)\b/.test(normalized))
    return { kind: 'TASK_STATUS' };

  if (/\b(?:cancel|cancela|cancelar|detene|detener|para|frena)\w*\b/.test(normalized) && /\b(?:tarea|solicitud|proceso)\b/.test(normalized)) {
    const task = taskReference(raw, liveTasks);
    return task ? { kind: 'CANCEL_ACCEPTED_TASK', taskId: task.id } : liveTasks.length > 1 ? { kind: 'AMBIGUOUS', reason: 'multiple-accepted-tasks' } : liveTasks.length === 1 ? { kind: 'CANCEL_ACCEPTED_TASK', taskId: liveTasks[0].id } : { kind: 'AMBIGUOUS', reason: 'no-accepted-task' };
  }

  if (/^(?:(?:no|me confundi)\s*,?\s*)?(?:deja(?:lo)?(?: eso)?|dejemos eso|olvida(?:lo)?|descarta(?:lo)?|no sigas con eso|no hagas eso|cancela(?:lo)?|dejalo)(?:\s*,?\s*(?:me confundi|nada))?$/.test(normalized) && pendingDraft)
    return { kind: 'DISCARD_DRAFT' };
  if (/^(?:espera|pausa(?:lo)?|dejalo para despues|despues seguimos|pone(?:lo)? en pausa)$/.test(normalized) && pendingDraft)
    return { kind: 'PAUSE_DRAFT' };
  if (/^(?:volvamos|volvamos a|retomemos|retoma|sigamos con|volvamos con)\b/.test(normalized) && ['suspended','paused'].includes(focus.draftStatus))
    return { kind: 'RESUME_DRAFT' };

  if (pendingDraft && /^(?:mejor )?(?:otra cosa|cambiemos de tema|hablemos de otra cosa)$/.test(normalized))
    return { kind: 'NEW_INTENT', route: { route: 'direct', routeCategory: 'DIRECT', kind: 'intent-switch-clarification' }, clarification: true };

  const changesTarget = pendingDraft && /\b(?:no|mejor|cambia|cambiemos|en vez de|pasemos|vayamos)\b/.test(normalized);
  const mentionsWarehouse = /\bdepositos?\b/.test(normalized);
  const mentionsLocation = /\b(?:local(?:es)?|ubicaciones?|sucursales?|ferias?)\b/.test(normalized);
  if (changesTarget && (mentionsWarehouse || mentionsLocation)) {
    const targetType = mentionsWarehouse && (!mentionsLocation || normalized.lastIndexOf('deposito') > normalized.lastIndexOf('local')) ? 'warehouse' : 'location';
    return { kind: 'CHANGE_TARGET', targetType, clearTargetId: true };
  }

  const route = context.routeDecision || classifyGeminiLiveTurn(raw, {
    ...context,
    voiceCollection,
    pendingAction: Boolean(context.pendingAction || context.pendingActionId),
    collectingTask: Boolean(context.collectingTask || context.taskState?.status === 'collecting'),
    activeTask: Boolean(context.activeTask || liveTasks.length),
  });
  const fastRead = quickReadPlan(raw);
  if (fastRead || isIndependentBusinessRead(raw)) return { kind: 'INDEPENDENT_READ', route, readKind: fastRead?.kind || null };

  const correction = /^(?:no\b|mejor\b|corrijo\b|corregi\b|en realidad\b|quise decir\b|eran\b|que sean\b|cambia\b)/.test(normalized);
  if (correction && pendingDraft) return { kind: 'CORRECT_CURRENT', route };
  if (voiceCollection && ['collecting', 'ready', 'paused'].includes(voiceCollection.status) && route.collection)
    return { kind: 'ANSWER_SLOT', route, collection: route.collection };
  if (pendingDraft && route.routeCategory === 'TASK' && route.newTask)
    return { kind: 'NEW_INTENT', route };
  if (pendingDraft && route.routeCategory === 'DIRECT' && !/[?¿]/.test(raw))
    return { kind: 'ANSWER_SLOT', route };
  if (route.kind === 'task-status') return { kind: 'TASK_STATUS', route };
  if (route.routeCategory === 'TASK') return { kind: 'NEW_INTENT', route };
  if (/\b(?:ahi|alla|ese|esa|lo mismo)\b/.test(normalized) && liveTasks.length > 1)
    return { kind: 'AMBIGUOUS', reason: 'unresolved-reference', route };
  if (route.routeCategory === 'DIRECT') return { kind: 'SOCIAL/GENERAL', route };
  return { kind: 'AMBIGUOUS', reason: 'unclassified-turn', route };
}

export function initialConversationFocus(value = {}) {
  return {
    version: 1,
    activeIntentId: null,
    intentEpoch: 0,
    activeDraftId: null,
    draftStatus: 'none',
    turnId: null,
    sourceTurnId: null,
    lastFinalUserTurn: null,
    taskId: null,
    targetType: null,
    targetId: null,
    awaitingField: null,
    acceptedAt: null,
    classification: null,
    sessionId: null,
    turnIndex: 0,
    updatedAt: null,
    ...value,
  };
}

export function transitionConversationFocus(previousValue, { text, turnId, sourceTurnId = null, sessionId = null, turnIndex = 0, context = {}, now = new Date() } = {}) {
  const previous = initialConversationFocus(previousValue || {});
  const identity = String(turnId || '').slice(0, 128);
  if (Number.isInteger(turnIndex) && turnIndex > 0 && turnIndex <= previous.turnIndex && identity !== previous.turnId)
    return { focus: previous, stale: true, decision: { kind: 'AMBIGUOUS', reason: 'older-turn' } };

  const decision = classifyConversationFocus(text, { ...context, conversationFocus: previous });
  const sameTurn = Boolean(identity && identity === previous.turnId && (!sessionId || sessionId === previous.sessionId));
  const intentEpoch = sameTurn ? previous.intentEpoch : previous.intentEpoch + 1;
  const stamp = now instanceof Date ? now.toISOString() : String(now);
  const next = {
    ...previous,
    intentEpoch,
    turnId: identity || previous.turnId,
    sourceTurnId: String(sourceTurnId || identity || '').slice(0, 128) || null,
    sessionId: String(sessionId || previous.sessionId || '').slice(0, 128) || null,
    turnIndex: Number.isInteger(turnIndex) && turnIndex > 0 ? Math.max(previous.turnIndex, turnIndex) : previous.turnIndex,
    lastFinalUserTurn: { turnId: identity || null, sessionId: sessionId || null, turnIndex: Number.isInteger(turnIndex) ? turnIndex : 0, kind: decision.kind, receivedAt: stamp },
    classification: decision.kind,
    updatedAt: stamp,
  };
  const route = decision.route;
  const collection = decision.collection || route?.collection;
  const hasDraft = hasPendingDraft(previous, context);
  const preserveDraft = () => {
    if (hasDraft && previous.activeDraftId) next.activeDraftId = previous.activeDraftId;
    next.draftStatus = previous.draftStatus || context.voiceCollection?.status || context.taskState?.status || 'collecting';
  };

  if (collection) {
    next.activeDraftId = previous.activeDraftId || `draft_${String(sessionId || 'session').replace(/[^A-Za-z0-9_-]/g, '_')}_${String(identity || turnIndex || intentEpoch).replace(/[^A-Za-z0-9_-]/g, '_')}`;
    next.activeIntentId = collection.collection?.intent || collection.intent || route?.kind || 'operational-draft';
    next.draftStatus = collection.collection?.status || collection.status || 'collecting';
    next.awaitingField = collection.collection?.pendingQuestion || collection.pendingQuestion || null;
    next.targetType = collection.collection?.targetType || context.voiceCollection?.targetType || previous.targetType || null;
    next.targetId = next.targetType === previous.targetType ? previous.targetId : null;
  } else if (decision.kind === 'DISCARD_DRAFT') {
    next.activeIntentId = 'conversation:discarded'; next.activeDraftId = null; next.draftStatus = 'discarded';
    next.targetType = null; next.targetId = null; next.awaitingField = null; next.taskId = null;
  } else if (decision.kind === 'PAUSE_DRAFT') {
    next.activeIntentId = previous.activeIntentId; preserveDraft(); next.draftStatus = 'paused';
  } else if (decision.kind === 'RESUME_DRAFT') {
    next.activeIntentId = previous.activeIntentId; next.activeDraftId = previous.activeDraftId; next.draftStatus = context.voiceCollection?.status === 'ready' ? 'ready' : 'collecting';
  } else if (decision.kind === 'CHANGE_TARGET') {
    next.activeIntentId = previous.activeIntentId || 'stock-load'; preserveDraft();
    next.targetType = decision.targetType; next.targetId = null;
    next.awaitingField = decision.targetType === 'warehouse' ? 'warehouseId' : 'locationId';
  } else if (decision.kind === 'INDEPENDENT_READ') {
    next.activeIntentId = `read:${decision.readKind || 'business'}`;
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
    next.awaitingField = null;
  } else if (decision.kind === 'CORRECT_CURRENT' || decision.kind === 'ANSWER_SLOT') {
    next.activeIntentId = previous.activeIntentId || route?.kind || 'operational-draft'; preserveDraft();
    next.awaitingField = context.voiceCollection?.pendingQuestion || previous.awaitingField || null;
    next.targetType = context.voiceCollection?.targetType || previous.targetType;
    next.targetId = next.targetType === previous.targetType ? previous.targetId : null;
  } else if (decision.kind === 'CANCEL_ACCEPTED_TASK') {
    next.activeIntentId = 'task:cancel'; next.taskId = decision.taskId || previous.taskId || null;
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
  } else if (decision.kind === 'TASK_STATUS') {
    next.activeIntentId = 'task:status'; next.taskId = decision.taskId || previous.taskId || null;
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
  } else if (decision.kind === 'NEW_INTENT') {
    next.activeIntentId = `intent:${route?.kind || route?.routeCategory || 'business'}`;
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
    else { next.activeDraftId = null; next.draftStatus = 'none'; }
    next.taskId = null; next.awaitingField = null;
    if (route?.collection?.targetType) next.targetType = route.collection.targetType;
  } else if (decision.kind === 'SOCIAL/GENERAL') {
    next.activeIntentId = 'conversation:social';
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
    next.awaitingField = null;
  } else {
    next.activeIntentId = 'conversation:clarification';
    if (hasDraft) { next.activeDraftId = previous.activeDraftId; next.draftStatus = 'suspended'; }
    next.taskId = null;
  }
  return { focus: next, stale: false, decision };
}

export function acceptConversationTask(focusValue, task, { intentEpoch, now = new Date() } = {}) {
  const focus = initialConversationFocus(focusValue || {});
  if (Number.isInteger(intentEpoch) && intentEpoch !== focus.intentEpoch) return { focus, stale: true };
  const acceptedAt = task?.createdAt || (now instanceof Date ? now.toISOString() : String(now));
  const preserveSuspendedDraft=Boolean(focus.activeDraftId&&['suspended','paused'].includes(focus.draftStatus));
  return { stale: false, focus: {
    ...focus,
    taskId: task?.id || focus.taskId,
    activeDraftId: preserveSuspendedDraft ? focus.activeDraftId : null,
    draftStatus: preserveSuspendedDraft ? focus.draftStatus : task?.status === 'awaiting-confirmation' ? 'awaiting-confirmation' : task?.status === 'needs-input' ? 'needs-input' : task?.status || 'accepted',
    acceptedAt,
    awaitingField: task?.status === 'needs-input' ? task.summary || null : null,
    updatedAt: acceptedAt,
  } };
}

export function isCurrentFocusResponse(focusValue, { intentEpoch, turnId } = {}) {
  const focus = initialConversationFocus(focusValue || {});
  return Number.isInteger(intentEpoch) && intentEpoch === focus.intentEpoch && (!turnId || !focus.turnId || turnId === focus.turnId);
}

export function normalizeConversationFocus(value) {
  const focus = initialConversationFocus(value || {});
  return {
    version: 1,
    activeIntentId: typeof focus.activeIntentId === 'string' ? focus.activeIntentId.slice(0, 120) : null,
    intentEpoch: Number.isInteger(focus.intentEpoch) && focus.intentEpoch >= 0 ? focus.intentEpoch : 0,
    activeDraftId: typeof focus.activeDraftId === 'string' ? focus.activeDraftId.slice(0, 128) : null,
    draftStatus: ['none','collecting','ready','suspended','paused','discarded','superseded','delegated','accepted','queued','dispatching','running','needs-input','awaiting-confirmation','completed','cancelled','failed'].includes(focus.draftStatus) ? focus.draftStatus : 'none',
    turnId: typeof focus.turnId === 'string' ? focus.turnId.slice(0, 128) : null,
    sourceTurnId: typeof focus.sourceTurnId === 'string' ? focus.sourceTurnId.slice(0, 128) : null,
    lastFinalUserTurn: focus.lastFinalUserTurn && typeof focus.lastFinalUserTurn === 'object' ? { turnId: focus.lastFinalUserTurn.turnId || null, sessionId: focus.lastFinalUserTurn.sessionId || null, turnIndex: Number(focus.lastFinalUserTurn.turnIndex || 0), kind: CONVERSATION_FOCUS_KINDS.includes(focus.lastFinalUserTurn.kind) ? focus.lastFinalUserTurn.kind : 'AMBIGUOUS', receivedAt: focus.lastFinalUserTurn.receivedAt || null } : null,
    taskId: typeof focus.taskId === 'string' ? focus.taskId.slice(0, 128) : null,
    targetType: ['location','warehouse'].includes(focus.targetType) ? focus.targetType : null,
    targetId: typeof focus.targetId === 'string' ? focus.targetId.slice(0, 128) : null,
    awaitingField: typeof focus.awaitingField === 'string' ? focus.awaitingField.slice(0, 120) : null,
    acceptedAt: focus.acceptedAt || null,
    classification: CONVERSATION_FOCUS_KINDS.includes(focus.classification) ? focus.classification : null,
    sessionId: typeof focus.sessionId === 'string' ? focus.sessionId.slice(0, 128) : null,
    turnIndex: Number.isInteger(focus.turnIndex) && focus.turnIndex >= 0 ? focus.turnIndex : 0,
    updatedAt: focus.updatedAt || null,
  };
}
