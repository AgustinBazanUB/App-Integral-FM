import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const designSystem = read("src/design-system/index.jsx");
const focusTrap = read("src/hooks/useFocusTrap.js");
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

test("el focus trap extraído tolera re-renders y restaura el foco", () => {
  assert.match(focusTrap, /const previousFocus = document\.activeElement;/);
  assert.match(focusTrap, /container\.querySelectorAll\(FOCUSABLE_SELECTOR\)/);
  assert.match(focusTrap, /event\.key !== "Tab"/);
  assert.match(focusTrap, /returnFocusRef\?\.current \?\? previousFocus/);
  assert.match(focusTrap, /document\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(focusTrap, /document\.removeEventListener\("keydown", onKeyDown\)/);
});

test("los formularios con cierres inline quedan cubiertos por el fix global", () => {
  assert.match(locations, /<Modal open=\{modalOpen\} onClose=\{\(\) => !saveState\.busy && setModalOpen\(false\)\}/);
  assert.match(administration, /<Modal open=\{modalOpen\} onClose=\{\(\) => setModalOpen\(false\)\}/);
  assert.match(genericModule, /<Modal open=\{modalOpen\} onClose=\{\(\) => setModalOpen\(false\)\}/);
  assert.match(locationDetail, /<Modal open=\{Boolean\(configProduct\)\} onClose=\{\(\) => !configState\.busy && setConfigProduct\(null\)\}/);
  assert.match(locationDetail, /<Modal open=\{sellerModalOpen\} onClose=\{\(\) => !sellerState\.busy && setSellerModalOpen\(false\)\}/);
  assert.match(locationProductForm, /onClose=\{\(\) => !state\.busy && onClose\?\.\(\)\}/);
});

test("los campos controlados siguen actualizando sólo su estado y no el overlay", () => {
  assert.match(locations, /value=\{form\.name\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, name: event\.target\.value \}\)\}/);
  assert.match(administration, /value=\{form\.email\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, email: event\.target\.value \}\)\}/);
  assert.match(genericModule, /value=\{form\.notes\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, notes: event\.target\.value \}\)\}/);
  assert.match(locationProductForm, /value=\{form\.description\} onChange=\{\(event\) => setForm\(\{ \.\.\.form, description: event\.target\.value \}\)\}/);
});
