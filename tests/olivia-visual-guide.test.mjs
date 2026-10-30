import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualGuide } from '../src/gestion/olivia/visualGuide.mjs';
import { UI_GUIDE_VERSION } from '../src/shared/oliviaUiGuides.mjs';

function setup() {
  const elements = new Map(), events = new Map(), progress = [], highlights = [];
  let observerCallback, disconnected = false, closed = 0, clicks = 0;
  const element = id => ({ id, getClientRects: () => [{}], closest: () => null, getAttribute: name => name === 'data-olivia' ? id : null, click: () => clicks++ });
  const document = { body: {}, querySelectorAll: selector => selector === '[data-olivia-error]' ? [] : elements.has(selector) ? [elements.get(selector)] : [], addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const runtime = createVisualGuide({ guide: { id: 'locations-create', version: UI_GUIDE_VERSION }, document,
    driver: config => ({ highlight: value => highlights.push({ ...value, config }), destroy() {} }),
    observe: callback => { observerCallback = callback; return { observe() {}, disconnect() { disconnected = true; } }; },
    onProgress: value => progress.push(value), onClose: () => closed++,
  });
  const show = async id => { elements.set(`[data-olivia="${id}"]`, element(id)); observerCallback(); await new Promise(resolve => queueMicrotask(resolve)); };
  return { runtime, progress, highlights, events, show, element, closed: () => closed, disconnected: () => disconnected, clicks: () => clicks };
}

test('espera un control ausente, avanza cuando se abre el formulario y nunca hace clic ni guarda', async () => {
  const f = setup();
  assert.equal(f.progress.at(-1).status, 'waiting');
  await f.show('location.create');
  assert.equal(f.highlights.at(-1).element.id, 'location.create');
  await f.show('location.name');
  assert.equal(f.progress.at(-1).stepId, 'location.name');
  assert.equal(f.progress.at(-1).index, 1);
  f.runtime.next();
  assert.equal(f.progress.at(-1).status, 'waiting');
  assert.equal(f.progress.at(-1).stepId, 'location.prefix');
  assert.equal(f.clicks(), 0);
  f.runtime.destroy();
  assert.equal(f.disconnected(), true);
  assert.equal(f.closed(), 1);
});

test('pausar, retomar y cancelar no pierde el paso y limpia observadores/eventos', async () => {
  const f = setup();
  await f.show('location.create');
  f.runtime.pause();
  assert.equal(f.progress.at(-1).status, 'paused');
  f.runtime.resume();
  assert.equal(f.progress.at(-1).stepId, 'location.create');
  assert.equal(f.progress.at(-1).status, 'active');
  f.runtime.destroy(); f.runtime.destroy();
  assert.equal(f.closed(), 1);
  assert.equal(f.events.size, 0);
});

test('validación nativa comparte solo el identificador del campo y se limpia al corregirlo', async () => {
  const f = setup();
  await f.show('location.name');
  const field = f.element('location.name'); field.value = 'dato que no se debe copiar';
  f.events.get('invalid')({ target: field });
  assert.deepEqual(f.progress.at(-1).errors, ['location.name']);
  assert.ok(!JSON.stringify(f.progress).includes(field.value));
  field.validity = { valid: true }; f.events.get('input')({ target: field });
  assert.deepEqual(f.progress.at(-1).errors, []);
  f.runtime.destroy();
});
