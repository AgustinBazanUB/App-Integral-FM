import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start, textResponse, functionResponse } from './helpers/olivia-fixture.mjs';
import { requiredFields, updateTask } from '../netlify/functions/_lib/olivia/tasks.mjs';
import { transitionConversationTask, requestedTaskIntent } from '../netlify/functions/_lib/olivia/conversationTasks.mjs';
import { isFeedbackCaptureRequest, isSuggestionContinuation } from '../netlify/functions/_lib/olivia/suggestions.mjs';
import { OLIVIA_CAPABILITIES } from '../src/shared/oliviaCapabilities.mjs';
import { OLIVIA_TOOL_SCHEMAS } from '../src/shared/oliviaContracts.mjs';
import { fieldGuidance, operationGuidance } from '../src/shared/oliviaOperationGuide.mjs';
import { buildLocationPayload } from '../src/shared/managementWritePlans.mjs';

const proposal = { ready: true, title: 'Explicar los datos al crear registros', summary: 'Olivia repite requisitos sin explicar para qué sirven.', panel: 'Conversación de Olivia', expectedBehavior: 'Explicar los campos con ejemplos y conservar la tarea si el usuario pide ayuda.', question: '' };
const response = value => textResponse(JSON.stringify(value));
const last = result => result.messages.at(-1).content;
const notifications = f => [...f.documents.keys()].filter(key => key.startsWith('alerts/'));
async function chat(f, id, message, requestId, extra = {}) {
  f.advance(1500);
  return f.engine.chat(f.session, { conversationId: id, message, requestId, screenContext: { module: 'locations', route: '/gestion/locations' }, ...extra });
}

test('la charla observada: inicio de ubicación → ok → explicación → documentar, sin repetir requisitos ni perder tarea', async () => {
  const requests = [];
  const f = fixture({ role: 'admin', provider: async (path, body) => { requests.push(body); return response(proposal); } });
  const { conversationId: id } = await start(f);
  const first = await chat(f, id, '¿Podés crearme una nueva ubicación?', 'start');
  assert.match(last(first), /Dale, vamos a crear una ubicación/);
  assert.match(last(first), /Local Centro/);
  assert.match(last(first), /8 letras o números/);
  assert.doesNotMatch(last(first), /DNI|Me falta/);
  const taskId = f.documents.get(`oliviaConversations/${id}`).taskState.id;
  await chat(f, id, 'Ok', 'ack');
  const explanation = await chat(f, id, '¿Podés repetirme más detalladamente qué necesitás de mí para hacer la ubicación?', 'explain');
  assert.match(last(explanation), /Claro, te lo explico/);
  assert.match(last(explanation), /local permanente, una feria o un evento/);
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.id, taskId);
  assert.equal(requests.length, 0);
  const draft = await chat(f, id, '¿Podés documentar y registrar que me tenés que decir eso cada vez que quiera crear una ubicación o un producto, con más detalles para entenderlo?', 'document');
  assert.match(last(draft), /documentada en este chat, como borrador/);
  assert.match(last(draft), /Lo que le propondría a Agustín/);
  assert.match(last(draft), /Todavía no envié nada/);
  assert.equal(notifications(f).length, 0);
  const saved = f.documents.get(`oliviaConversations/${id}`);
  assert.equal(saved.suspendedTasks.at(-1).id, taskId);
  assert.equal(saved.draft.proposal.expectedBehavior, proposal.expectedBehavior);
  const input = JSON.parse(requests[0].input[0].content);
  assert.ok(input.recentConversation.some(row => /repetirme/.test(row.content)));
  assert.equal(input.pendingTask.id, taskId);
  // A reformulation is another draft, never permission to send the first one.
  const second = await chat(f, id, '¿Me lo podés decir de otra manera para entenderlo mejor?', 'reword');
  assert.match(last(second), /Lo que le propondría a Agustín/);
  assert.equal(notifications(f).length, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].input[0].content).previousProposal, proposal);
  await chat(f, id, 'Retomemos la ubicación', 'resume');
  assert.equal(f.documents.get(`oliviaConversations/${id}`).taskState.id, taskId);
  assert.match(last(await chat(f, id, '¿Me lo explicás de nuevo?', 'explain_again')), /Local Centro/);
});

test('reformular cambia lo que se envía, aceptación no usa modelo, rechazar no envía', async () => {
  let count = 0;
  const revised = { ...proposal, expectedBehavior: 'Usar ejemplos cortos al pedir datos de una ubicación.' };
  const f = fixture({ role: 'admin', provider: async () => response(++count === 1 ? proposal : revised) });
  f.documents.set('users/agustin', { name: 'Agustín', email: 'agsreserva@gmail.com', role: 'admin', active: true });
  const { conversationId: id } = await start(f);
  await chat(f, id, 'Documentá esta mejora: explicame los campos con ejemplos para entenderlos', 'draft');
  await chat(f, id, 'Decímelo de otra manera, más simple', 'revise');
  assert.equal(notifications(f).length, 0);
  // A bare punctuation mark is never approval.
  await chat(f, id, '...', 'punctuation');
  assert.equal(notifications(f).length, 0);
  // The unrelated turn clears the pending offer; make a new reviewed draft.
  await chat(f, id, 'Documentá esta mejora: explicar los campos con ejemplos', 'redraft');
  const before = count;
  const sent = await chat(f, id, 'Sí, enviáselo a Agustín', 'send');
  assert.match(last(sent), /Le envié tu sugerencia/);
  assert.equal(count, before);
  assert.equal(notifications(f).length, 1);
  assert.equal(f.documents.get(notifications(f)[0]).expectedBehavior, revised.expectedBehavior);
  await chat(f, id, 'Documentá que necesito más detalles para entender los campos', 'another');
  await chat(f, id, 'No, no lo envíes', 'cancel');
  assert.equal(notifications(f).length, 1);
});

test('documentar una mejora no se confunde con registrar stock, y un borrador no secuestra tareas nuevas', () => {
  for (const text of ['Documentá que me expliques mejor lo que necesitás', 'Registrá que necesito más detalles para entender la charla']) {
    assert.equal(isFeedbackCaptureRequest(text), true, text);
    assert.equal(requestedTaskIntent(text), null);
  }
  for (const text of ['Registrá un cliente', 'Cargá 12 botellas', 'Registrá una venta', 'Explicá el documento', 'Recordá el teléfono del cliente para registrar la venta']) assert.equal(isFeedbackCaptureRequest(text), false);
  const conversation = { draft: { kind: 'app-suggestion', proposal } };
  for (const text of ['Cargame stock', 'Quiero crear un cliente', 'Retomemos la ubicación']) assert.equal(isSuggestionContinuation(conversation, text), false, text);
  assert.equal(isSuggestionContinuation(conversation, '¿Me lo decís con otras palabras?'), true);
});

test('los contratos vigentes de todas las operaciones tienen explicación humana de cada dato mínimo', () => {
  for (const intent of new Set([...Object.keys(OLIVIA_CAPABILITIES), ...Object.keys(OLIVIA_TOOL_SCHEMAS)])) {
    for (const field of requiredFields(intent)) assert.ok(fieldGuidance(intent, field), `${intent}: ${field}`);
  }
  assert.match(operationGuidance('prepare_product_create', requiredFields('prepare_product_create'), { detail: true }), /precio de venta en pesos/);
  assert.match(operationGuidance('prepare_expense_create', ['amountCents']), /en pesos/);
  assert.doesNotMatch(operationGuidance('prepare_stock_load', ['productId', 'locationId']), /productId|locationId/);
});

test('ubicación no solicita ni escribe DNI; editar conserva valores históricos sin migrarlos', () => {
  assert.ok(!requiredFields('prepare_create_location').includes('dniMode'));
  assert.ok(!Object.hasOwn(OLIVIA_CAPABILITIES.prepare_create_location.parameters.properties, 'dniMode'));
  const values = { name: 'Local QA', codePrefix: 'LQA', type: 'store', dniMode: 'required' };
  const previous = { ...values, dniMode: 'recommended' };
  for (const prior of [null, previous]) {
    const payload = buildLocationPayload({ values, previous: prior, profile: { id: 'qa', name: 'QA' }, stamp: new Date() });
    assert.ok(!Object.hasOwn(payload, 'dniMode'));
  }
  const old = updateTask(null, 'prepare_create_location', JSON.stringify({ name: 'Centro' }));
  old.slots.dniMode = 'optional'; old.missingFields.push('dniMode');
  const transition = transitionConversationTask({ taskState: old }, '¿Me lo explicás mejor?');
  assert.equal(transition.directive, 'explain');
  assert.ok(!transition.task.missingFields.includes('dniMode'));
  assert.ok(!Object.hasOwn(transition.task.slots, 'dniMode'));
});

test('las guías no otorgan permisos de alta de ubicación al vendedor', async () => {
  const f = fixture({ role: 'seller' }), { conversationId: id } = await start(f);
  const result = await chat(f, id, '¿Podés crearme una nueva ubicación?', 'denied');
  assert.match(last(result), /no está habilitada/);
  assert.equal(result.pendingAction, null);
  assert.equal(f.providerCalls(), 0);
});

test('un dato parcial tras el inicio conserva la intención; explicar un campo no borra el nombre reunido', async () => {
  const f = fixture({ role: 'admin', provider: async () => functionResponse('update_task', { intent: 'prepare_create_location', slotsJson: JSON.stringify({ name: 'Local QA Centro' }) }) });
  const { conversationId: id } = await start(f);
  await chat(f, id, 'Creame una ubicación', 'start');
  const taskId = f.documents.get(`oliviaConversations/${id}`).taskState.id;
  const next = await chat(f, id, 'El nombre es Local QA Centro', 'name');
  assert.match(last(next), /código corto/);
  assert.doesNotMatch(last(next), /cómo querés que se llame/);
  const clarification = await chat(f, id, '¿Qué es el prefijo?', 'prefix');
  assert.match(last(clarification), /identificar sus ventas/);
  const saved = f.documents.get(`oliviaConversations/${id}`).taskState;
  assert.equal(saved.id, taskId);
  assert.equal(saved.slots.name, 'Local QA Centro');
  assert.equal(f.providerCalls(), 1);
});
