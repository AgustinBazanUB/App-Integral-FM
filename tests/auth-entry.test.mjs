import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const appSource = read("src/App.jsx");
const gateSource = read("src/gestion/StorePreviewGate.jsx");
const loginSource = read("src/gestion/pages/LoginPage.jsx");
const firebaseSource = read("src/gestion/services/firebase.js");
const shellSource = read("src/gestion/ManagementShell.jsx");

test("la raíz abre la gestión y la tienda queda en /tienda", () => {
  assert.match(appSource, /location\.pathname === "\/"/);
  assert.match(appSource, /path="\/tienda" element=\{<HomePage \/>\}/);
  assert.match(appSource, /<StorePreviewGate>/);
});

test("la vista de tienda requiere un administrador", () => {
  assert.match(gateSource, /normalizedRole\(profile\) === "admin"/);
  assert.match(gateSource, /navigate\("\/gestion", \{ replace: true \}\)/);
  assert.match(shellSource, /normalizedRole\(profile\) === "admin"/);
  assert.match(shellSource, /to="\/tienda"/);
});

test("el login permite ver la contraseña y espera la persistencia local", () => {
  assert.match(loginSource, /showPassword/);
  assert.match(loginSource, /type=\{showPassword \? "text" : "password"\}/);
  assert.match(loginSource, /La sesión quedará iniciada en este dispositivo/);
  assert.match(firebaseSource, /browserLocalPersistence/);
  assert.match(firebaseSource, /await persistenceReady/);
  assert.match(firebaseSource, /signInWithEmailAndPassword/);
});
