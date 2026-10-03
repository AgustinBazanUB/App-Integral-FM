import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const designSystem = read("src/design-system/index.jsx");
const locations = read("src/gestion/pages/LocationsPage.jsx");
const administration = read("src/gestion/pages/AdministrationPage.jsx");
const genericModule = read("src/gestion/pages/GenericModulePage.jsx");
const locationDetail = read("src/gestion/pages/LocationDetailPage.jsx");
const locationProductForm = read("src/gestion/components/LocationProductForm.jsx");

test("useOverlay conserva el foco aunque onClose cambie en cada render", () => {
  assert.match(designSystem, /const onCloseRef = useRef\(onClose\);/);
  assert.match(designSystem, /onCloseRef\.current = onClose;/);
  assert.match(designSystem, /onCloseRef\.current\?\.\(\);/);
  assert.match(designSystem, /\}, \[initialFocusRef, open\]\);/);
  assert.doesNotMatch(designSystem, /\[initialFocusRef, onClose, open\]/);
});

test("el focus trap tolera re-renders sin perder el elemento activo", () => {
  assert.match(designSystem, /returnFocusRef\.current = document\.activeElement;/);
  assert.match(designSystem, /containerRef\.current\?\.querySelectorAll/);
  assert.match(designSystem, /event\.key !== "Tab"/);
  assert.match(designSystem, /if \(wasTop\) window\.requestAnimationFrame/);
  assert.match(designSystem, /returnFocusRef\.current\?\.isConnected/);
  assert.match(designSystem, /returnFocusRef\.current\.focus\?\.\(\)/);
});

test("los formularios con cierres inline quedan cubiertos por el fix global", () => {
  assert.match(locations, /<Modal open=\{modalOpen\} onClose=\{\(\) => !saveState\.busy && setModalOpen\(false\)\}/);
  assert.match(administration, /<Modal open=\{modalOpen\} onClose=\{\(\) => setModalOpen\(false\)\}/);
  assert.match(genericModule, /<Modal open=\{modalOpen\} onClose=\{\(\) => setModalOpen\(false\)\}/);
  assert.match(locationDetail, /<Modal open=\{open\} onClose=\{\(\) => !state\.busy && onClose\?\.\(\)\}/);
  assert.match(locationDetail, /<Modal open=\{sellerModalOpen\} onClose=\{\(\) => !sellerState\.busy && setSellerModalOpen\(false\)\}/);
  assert.match(locationProductForm, /onClose=\{\(\) => !state\.busy && onClose\?\.\(\)\}/);
});

test("los campos controlados siguen actualizando sólo su estado y no el overlay", () => {
  assert.match(locations, /value=\{form\.name\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, name: event\.target\.value \}\)\}/);
  assert.match(administration, /value=\{form\.email\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, email: event\.target\.value \}\)\}/);
  assert.match(genericModule, /value=\{form\.notes\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, notes: event\.target\.value \}\)\}/);
  assert.match(locationProductForm, /value=\{form\.description\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, description: event\.target\.value \}\)\}/);
});

test("dos overlays: Escape sólo cierra el superior y restaura foco sin desbloquear el padre", () => {
  const hook = designSystem.slice(designSystem.indexOf("const overlayStack = []"), designSystem.indexOf("export function Modal"));
  const listeners = new Set(); const cleanups = []; let locked = false; let restored = 0;
  const target = { isConnected: true, focus: () => { restored++; } };
  const document = { activeElement: target, body: { classList: { add: () => { locked = true; }, remove: () => { locked = false; } } }, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
  const window = { requestAnimationFrame: (fn) => { fn(); return 1; }, cancelAnimationFrame: () => {} };
  const node = () => ({ parentElement: { style: {}, inert: false }, setAttribute(key, value) { this[key] = value; }, querySelector() { return null; }, querySelectorAll() { return []; } });
  const useOverlay = Function("useRef", "useEffect", "document", "window", `${hook}; return useOverlay;`)((value) => ({ current: value === null ? node() : value }), (fn) => cleanups.push(fn()), document, window);
  let parentClosed = 0; let childClosed = 0;
  const parent = useOverlay(true, () => { parentClosed++; }); const child = useOverlay(true, () => { childClosed++; });
  assert.ok(Number(child.current.parentElement.style.zIndex) > Number(parent.current.parentElement.style.zIndex));
  assert.equal(parent.current.parentElement.inert, true); assert.equal(child.current.parentElement.inert, false);
  listeners.forEach((fn) => fn({ key: "Escape", preventDefault() {} }));
  assert.equal(parentClosed, 0); assert.equal(childClosed, 1);
  cleanups[1](); assert.equal(locked, true); assert.equal(restored, 1);
  assert.equal(parent.current.parentElement.inert, false); assert.equal(parent.current["aria-modal"], "true");
  listeners.forEach((fn) => fn({ key: "Escape", preventDefault() {} }));
  assert.equal(parentClosed, 1); cleanups[0](); assert.equal(locked, false); assert.equal(restored, 2);
});
