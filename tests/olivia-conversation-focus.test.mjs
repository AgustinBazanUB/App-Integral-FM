import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptConversationTask,
  classifyConversationFocus,
  initialConversationFocus,
  isCurrentFocusResponse,
  transitionConversationFocus,
} from '../src/shared/oliviaConversationFocus.mjs';

const stockDraft = {
  activeIntentId: 'stock-load', intentEpoch: 3, activeDraftId: 'draft-stock', draftStatus: 'collecting',
  turnId: 'turn-3', sessionId: 'session-a', turnIndex: 3, targetType: 'location', targetId: 'local-1',
};
const collection = { intent: 'stock-load', status: 'collecting', targetType: 'location', pendingQuestion: 'items-and-quantities', itemsMentioned: [] };

test('a quick business read suspends a draft and does not resume it implicitly', () => {
  const transition = transitionConversationFocus(stockDraft, {
    text: '¿Cuánto vendimos hoy?', turnId: 'turn-4', sessionId: 'session-a', turnIndex: 4,
    context: { voiceCollection: collection }, now: new Date('2026-11-10T12:00:00Z'),
  });
  assert.equal(transition.decision.kind, 'INDEPENDENT_READ');
  assert.equal(transition.focus.activeDraftId, 'draft-stock');
  assert.equal(transition.focus.draftStatus, 'suspended');
  assert.equal(transition.focus.activeIntentId, 'read:today-sales');
});

test('an explicit resume restores a suspended draft without changing its target', () => {
  const previous = { ...stockDraft, draftStatus: 'suspended' };
  const transition = transitionConversationFocus(previous, {
    text: 'Volvamos a la carga de stock', turnId: 'turn-5', sessionId: 'session-a', turnIndex: 5,
    context: { voiceCollection: { ...collection, status: 'collecting' } },
  });
  assert.equal(transition.decision.kind, 'RESUME_DRAFT');
  assert.equal(transition.focus.activeDraftId, 'draft-stock');
  assert.equal(transition.focus.draftStatus, 'collecting');
  assert.equal(transition.focus.targetId, 'local-1');
});

test('changing from a local to a warehouse clears the incompatible target ID', () => {
  const transition = transitionConversationFocus(stockDraft, {
    text: 'No, no en un local, en un depósito', turnId: 'turn-4', sessionId: 'session-a', turnIndex: 4,
    context: { voiceCollection: collection },
  });
  assert.equal(transition.decision.kind, 'CHANGE_TARGET');
  assert.equal(transition.focus.activeDraftId, 'draft-stock');
  assert.equal(transition.focus.targetType, 'warehouse');
  assert.equal(transition.focus.targetId, null);
  assert.equal(transition.focus.awaitingField, 'warehouseId');
});

test('a correction stays with the current draft', () => {
  const transition = transitionConversationFocus(stockDraft, {
    text: 'No, eran 15 de Aceite Arbequina', turnId: 'turn-4', sessionId: 'session-a', turnIndex: 4,
    context: { voiceCollection: collection },
  });
  assert.equal(transition.decision.kind, 'CORRECT_CURRENT');
  assert.equal(transition.focus.activeDraftId, 'draft-stock');
  assert.equal(transition.focus.draftStatus, 'collecting');
});

test('discarding a draft removes its active identity', () => {
  const transition = transitionConversationFocus(stockDraft, {
    text: 'Dejá eso, me confundí', turnId: 'turn-4', sessionId: 'session-a', turnIndex: 4,
    context: { voiceCollection: collection },
  });
  assert.equal(transition.decision.kind, 'DISCARD_DRAFT');
  assert.equal(transition.focus.activeDraftId, null);
  assert.equal(transition.focus.draftStatus, 'discarded');
});

test('ambiguous cancellation with multiple accepted tasks asks which one', () => {
  const decision = classifyConversationFocus('Cancelá la tarea', {
    tasks: [{ id: 'task-a', status: 'running' }, { id: 'task-b', status: 'queued' }],
  });
  assert.equal(decision.kind, 'AMBIGUOUS');
  assert.equal(decision.reason, 'multiple-accepted-tasks');
});

test('accepted work is retained when a newer turn changes the focus', () => {
  const accepted = acceptConversationTask(stockDraft, { id: 'task-stock', status: 'running', createdAt: '2026-11-10T12:00:00Z' }, { intentEpoch: 3 });
  assert.equal(accepted.stale, false);
  const newer = transitionConversationFocus(accepted.focus, {
    text: 'Hola, ¿cómo estás?', turnId: 'turn-4', sessionId: 'session-a', turnIndex: 4,
  });
  assert.equal(newer.focus.taskId, 'task-stock');
  assert.equal(accepted.focus.taskId, 'task-stock');
  assert.equal(accepted.focus.draftStatus, 'running');
});

test('an out-of-order turn cannot take focus back', () => {
  const current = initialConversationFocus({ ...stockDraft, intentEpoch: 8, turnId: 'turn-8', turnIndex: 8 });
  const older = transitionConversationFocus(current, {
    text: 'Cargá stock en el local', turnId: 'turn-7', sessionId: 'session-a', turnIndex: 7,
  });
  assert.equal(older.stale, true);
  assert.equal(older.focus.intentEpoch, 8);
  assert.equal(older.focus.turnId, 'turn-8');
});

test('response correlation rejects stale output and accepts the current turn', () => {
  assert.equal(isCurrentFocusResponse({ ...stockDraft, intentEpoch: 9, turnId: 'turn-9' }, { intentEpoch: 8, turnId: 'turn-8' }), false);
  assert.equal(isCurrentFocusResponse({ ...stockDraft, intentEpoch: 9, turnId: 'turn-9' }, { intentEpoch: 9, turnId: 'turn-9' }), true);
});
