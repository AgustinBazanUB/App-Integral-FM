import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, start, textResponse, functionResponse } from './helpers/olivia-fixture.mjs';
import { assistiveIntent } from '../src/shared/oliviaAssistiveIntent.mjs';
import { UI_GUIDES, getUiGuide, guideForMessage, UI_GUIDE_VERSION } from '../src/shared/oliviaUiGuides.mjs';
import { screenContext } from '../src/shared/oliviaContracts.mjs';
import { chooseExpression } from '../src/shared/oliviaExpressions.mjs';
import { runTool, toolDefinitions } from '../netlify/functions/_lib/olivia/tools.mjs';
import { discoverSkills, loadSkill } from '../netlify/functions/_lib/olivia/skills.mjs';
import { permissionScope, compatiblePermissionScope } from '../netlify/functions/_lib/olivia/conversations.mjs';
import { capabilities } from '../netlify/functions/_lib/olivia/guards.mjs';
import { readFileSync } from 'node:fs';
import { prepareExtendedOperation, executeExtendedOperation } from '../netlify/functions/_lib/olivia/extendedOperations.mjs';

const turn = (f, id, message, requestId, extra = {}) => { f.advance(1500); return f.engine.chat(f.session, { conversationId: id, requestId, message, screenContext: { module: 'dashboard', route: '/gestion' }, ...extra }); };
for (const message of [
  'Inventame un nombre para una feria cerca de una estación', '¿Qué nombre le podemos poner a una feria de San Martín?',
  'Inventame un código para identificar una feria de San Martín', 'Escribime una función en JavaScript para calcular un descuento',
  'Quiero organizar una feria', 'Redactame un mensaje de WhatsApp para promocionar aceite de oliva',
  'Quiero hacer una promoción para aumentar las ventas de aceite, ¿qué me recomendás?',
]) test(`generación directa: ${message}`, async () => {
  const f = fixture({ role: 'admin', provider: async () => textResponse('1. Feria Andén\n2. Mercado del Encuentro\nSon propuestas, todavía no se guardaron.') }), { conversationId: id } = await start(f);
  const before = [...f.documents].filter(([path]) => /^(locations|products|sales|customers)\//.test(path));
  await turn(f, id, message, 'idea');
  assert.equal(assistiveIntent(message).pure, true);
  assert.equal(f.providerCalls(), 1);
  assert.equal(f.providerRequests[0].tool_choice, 'none');
  assert.deepEqual(f.providerRequests[0].tools, []);
  assert.deepEqual([...f.documents].filter(([path]) => /^(locations|products|sales|customers)\//.test(path)), before);
});

test('contexto creativo: la segunda más corta conserva opciones, y crearla vuelve a permisos y tarjeta', async () => {
  let calls = 0;
  const f = fixture({ role: 'admin', provider: async (_path, body) => {
    calls++;
    if (calls === 1) return textResponse('1. Feria Andén\n2. Paseo de la Estación\n3. Mercado del Encuentro');
    if (calls === 2) {
      assert.match(JSON.parse(body.input[0].content).ideaContext.content, /2\. Paseo de la Estación/);
      assert.deepEqual(body.tools, []);
      return textResponse('La segunda, más corta: Paseo Estación.');
    }
    assert.ok(body.tools.some(tool => tool.name === 'search_tools'));
    return functionResponse('prepare_create_location', { locationId: null, name: 'Paseo Estación', type: 'fair', codePrefix: 'PE', startDate: null, endDate: null });
  } });
  const { conversationId: id } = await start(f);
  await turn(f, id, 'Inventame cinco nombres para una feria', 'names');
  await turn(f, id, 'Me gusta la segunda, pero más corta', 'shorter');
  const prepared = await turn(f, id, 'Me gusta Paseo Estación. Creala en el sistema como feria con prefijo PE, sin fechas', 'create');
  assert.ok(prepared.pendingAction);
  assert.equal([...f.documents.keys()].filter(path => path.startsWith('locations/')).length, 2);
  assert.equal(assistiveIntent('El nombre es Local Centro', { content: 'Una idea anterior' }).pure, false);
});

test('ideas con datos reales conservan herramientas; inventario no se confunde con inventar', () => {
  for (const message of ['Revisá las ventas de esta semana y proponeme tres promociones', '¿Cuánto vendimos hoy?', 'Quiero el inventario de un depósito', 'Creá una feria con el nombre que elegimos', 'Cargame 12 unidades de aceite']) assert.equal(assistiveIntent(message).pure, false, message);
});

test('un modelo no puede ejecutar herramientas en un turno de generación', async () => {
  const f = fixture({ role: 'admin', provider: async () => functionResponse('prepare_stock_load', { locationId: 'local_a', productId: 'oil', quantity: 3, reason: null }) }), { conversationId: id } = await start(f);
  await assert.rejects(turn(f, id, 'Inventame un nombre para una feria', 'malicious'), { code: 'unexpected-tool-call' });
  assert.equal(f.documents.get('locationStock/local_a/items/oil').currentStock, 4);
  assert.equal([...f.documents.keys()].filter(path => path.startsWith('oliviaConfirmations/')).length, 0);
});

test('la creatividad está disponible para vendedor sin conceder altas empresariales', async () => {
  const f = fixture({ provider: async () => textResponse('Podrías llamarla Feria Andén.') }), { conversationId: id } = await start(f);
  await turn(f, id, 'Inventame un nombre para una feria', 'name');
  assert.deepEqual(f.providerRequests[0].tools, []);
  const denied = await turn(f, id, 'Creame una ubicación', 'create');
  assert.equal(denied.state, 'RECHAZADA');
  assert.equal(f.providerCalls(), 1);
});

test('las cuatro skills nuevas cargan su versión real y no conceden permisos', async () => {
  for (const role of ['admin', 'seller']) {
    const f = fixture({ role });
    for (const name of ['guiar-uso-aplicacion', 'guiar-interfaz-visual', 'conversacion-natural-argentina', 'idear-y-crear']) {
      assert.ok(discoverSkills(f.session).some(skill => skill.name === name));
      assert.equal((await loadSkill(f.session, name)).version, '1.0.0');
    }
  }
});

test('guía de mercadería pregunta destino, acepta la respuesta y no consulta stock ni modifica datos', async () => {
  const f = fixture({ role: 'admin' }), { conversationId: id } = await start(f);
  const question = await turn(f, id, '¿Cómo cargo mercadería?', 'how');
  assert.match(question.messages.at(-1).content, /local o en un depósito/);
  const guide = await turn(f, id, 'En un depósito', 'destination');
  assert.equal(guide.guide.guideId, 'stock-warehouse');
  assert.equal(f.providerCalls(), 0);
  assert.equal(guide.pendingAction, null);
});

test('guías y acciones visuales validan permisos y solo aceptan IDs registrados', async () => {
  const f = fixture(), admin = fixture({ role: 'admin' });
  assert.equal(getUiGuide(f.session.profile, 'locations-create'), null);
  assert.ok(getUiGuide(f.session.profile, 'seller-sale'));
  await assert.rejects(runTool({ ...f, name: 'show_ui_guide', args: { guideId: 'locations-create' }, context: {}, now: f.clock() }), { code: 'permission-denied' });
  const result = await runTool({ ...admin, name: 'show_ui_guide', args: { guideId: 'locations-create' }, context: {}, now: admin.clock() });
  assert.deepEqual(result.guide, { guideId: 'locations-create', version: UI_GUIDE_VERSION });
  assert.equal(result.navigation, undefined);
  assert.equal(getUiGuide(admin.session.profile, '<script>alert(1)</script>'), null);
  const tools = toolDefinitions(f.session, { query: 'Mostrame cómo registrar una venta' });
  assert.ok(!tools.find(tool => tool.name === 'show_ui_guide').parameters.properties.guideId.enum.includes('locations-create'));
});

test('el contexto visual excluye valores, selectores y textos de error arbitrarios', () => {
  const value = screenContext({ route: '/gestion/locations', uiGuide: { guideId: 'locations-create', stepId: 'location.name', status: 'active', errors: ['location.form', 'private@example.test'], values: { phone: 'secret' }, selector: 'body' } });
  assert.deepEqual(value.uiGuide, { guideId: 'locations-create', stepId: 'location.name', status: 'active', errors: ['location.form'] });
  assert.equal(screenContext({ uiGuide: { guideId: 'unknown', stepId: 'location.name' } }).uiGuide, undefined);
  assert.equal(screenContext({ uiGuide: { guideId: 'locations-create', stepId: 'sale.submit' } }).uiGuide, undefined);
  const denied = fixture().session.profile;
  assert.equal(guideForMessage('Cancelá la guía', { uiGuide: { guideId: 'locations-create' } }, null, denied), null);
});

test('el prefijo generado se valida al preparar y se reserva al confirmar; no se guarda con la idea', async () => {
  const f = fixture({ role: 'admin' });
  const args = { locationId: null, name: 'Feria QA', type: 'fair', codePrefix: 'LA', startDate: null, endDate: null };
  await assert.rejects(prepareExtendedOperation({ ...f, toolName: 'prepare_create_location', args, now: f.clock() }), { code: 'identifier-in-use' });
  const one = await prepareExtendedOperation({ ...f, toolName: 'prepare_create_location', args: { ...args, codePrefix: 'FQA' }, now: f.clock() });
  const two = await prepareExtendedOperation({ ...f, toolName: 'prepare_create_location', args: { ...args, name: 'Otra feria', codePrefix: 'FQA' }, now: f.clock() });
  assert.equal([...f.documents.keys()].filter(path => path.startsWith('oliviaIdentifierClaims/')).length, 0);
  const execute = (prepared, confirmationId) => f.store.transaction(async transaction => {
    const plan = await executeExtendedOperation({ session: f.session, prepared, transaction, now: f.clock(), correlation: { confirmationId } });
    await transaction.commitDocuments(plan.writes);
  });
  await execute(one, 'first_fair');
  await assert.rejects(execute(two, 'second_fair'), { code: 'identifier-in-use' });
  assert.equal(f.documents.get('oliviaIdentifierClaims/location_FQA').locationId, 'first_fair');
  assert.equal(f.documents.has('locations/second_fair'), false);
});

test('las guías se pueden controlar por conversación sin confirmar acciones comerciales', async () => {
  const f = fixture({ role: 'admin' }), { conversationId: id } = await start(f);
  const result = await turn(f, id, 'Cancelá la guía', 'cancel-guide', { screenContext: { module: 'locations', route: '/gestion/locations', uiGuide: { guideId: 'locations-create', stepId: 'location.name', status: 'active', errors: [] } } });
  assert.deepEqual(result.guideControl, { action: 'cancel', guideId: 'locations-create' });
  assert.equal(f.providerCalls(), 0);
});

test('nuevas herramientas de guía conservan el alcance previo de chats propios; otros permisos no son compatibles', () => {
  const f = fixture({ role: 'admin' });
  const prior = permissionScope(f.session, capabilities(f.session).filter(name => !['get_ui_guide', 'show_ui_guide'].includes(name)));
  assert.ok(compatiblePermissionScope(f.session, prior));
  f.session.profile.permissionDeny = { locations: ['view'] };
  assert.equal(compatiblePermissionScope(f.session, prior), false);
});

test('los objetivos visuales tienen un marcador real y el banco evita repetir la frase reciente', () => {
  const paths = ['src/gestion/pages/LocationsPage.jsx', 'src/gestion/pages/ProductsPage.jsx', 'src/gestion/components/ProductForm.jsx', 'src/gestion/pages/LoyalCustomersPage.jsx', 'src/gestion/pages/QuickSalesPage.jsx', 'src/gestion/pages/WarehousePage.jsx', 'src/gestion/pages/LocationDetailPage.jsx', 'src/gestion/components/InventoryTransferModal.jsx', 'src/gestion/ManagementShell.jsx', 'src/gestion/seller/SellerPanel.jsx'];
  const source = paths.map(path => readFileSync(path, 'utf8')).join('\n');
  for (const guide of Object.values(UI_GUIDES)) for (const step of guide.steps) assert.ok(source.includes(`data-olivia="${step.id}"`), step.id);
  const phrase = chooseExpression('guide');
  assert.notEqual(chooseExpression('guide', [{ role: 'assistant', content: phrase }]), phrase);
});
