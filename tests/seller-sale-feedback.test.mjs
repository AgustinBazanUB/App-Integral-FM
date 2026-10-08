import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sellerErrorMessage, sellerSaleProblem } from "../src/gestion/seller/sellerValidation.js";
import { PAYMENT_LABELS } from "../src/modules/locations/domain/payments.js";
import { isEditableTarget, keyboardEventKeys } from "../src/gestion/seller/sellerDomain.js";

const valid = {
  profile: { id: "seller", role: "seller", active: true },
  location: { id: "local", active: true },
  items: [{ id: "oil", name: "Aceite", qty: 1, price: 1000, stock: 5 }],
  paymentMethod: "cash", payments: [], total: 1000, discounts: [],
  online: true, editing: false, stockStatus: "ready", pendingStatus: "ready", ticketRequested: false,
};

test("continuar explica falta de pago, carrito vacío y ubicación inactiva", () => {
  assert.match(sellerSaleProblem({ ...valid, paymentMethod: "" }), /PAGO-FALTANTE.*forma de pago/);
  assert.match(sellerSaleProblem({ ...valid, items: [] }), /VENTA-VACIA/);
  assert.match(sellerSaleProblem({ ...valid, location: { active: false } }), /VENTA-UBICACION/);
  assert.equal(sellerSaleProblem(valid), "");
});

test("stock cero o negativo sigue permitiendo registrar con aviso; bajas y precios inválidos se explican", () => {
  for (const stock of [0, -10]) assert.equal(sellerSaleProblem({ ...valid, items: [{ ...valid.items[0], stock }] }), "");
  assert.match(sellerSaleProblem({ ...valid, items: [{ ...valid.items[0], unavailable: true }] }), /PRODUCTO-NO-DISPONIBLE.*Aceite/);
  assert.match(sellerSaleProblem({ ...valid, items: [{ ...valid.items[0], price: NaN }] }), /PRODUCTO-PRECIO/);
  assert.match(sellerSaleProblem({ ...valid, stockStatus: "loading" }), /VENTA-CARGANDO/);
});

test("pagos combinados muestran diferencias, negativos, duplicados y medios desconocidos", () => {
  const multiple = { ...valid, paymentMethod: "multiple" };
  for (const payments of [
    [{ method: "cash", amount: 400 }, { method: "alias", amount: 400 }],
    [{ method: "cash", amount: 600 }, { method: "alias", amount: 600 }],
    [{ method: "cash", amount: -1 }, { method: "alias", amount: 1001 }],
    [{ method: "cash", amount: 500 }, { method: "cash", amount: 500 }],
    [{ method: "cash", amount: 500 }, { method: "inventado", amount: 500 }],
  ]) assert.match(sellerSaleProblem({ ...multiple, payments }), /PAGO-DESGLOSE/);
  assert.equal(sellerSaleProblem({ ...multiple, payments: [{ method: "cash", amount: 400 }, { method: "debit", amount: 600 }] }), "");
});

test("offline y permisos específicos se validan antes de guardar", () => {
  const deny = (...actions) => ({ ...valid.profile, permissionDeny: { "quick-sales": actions } });
  assert.match(sellerSaleProblem({ ...valid, profile: deny("create") }), /VENTA-PERMISO/);
  assert.match(sellerSaleProblem({ ...valid, online: false, editing: true }), /VENTA-EDICION-OFFLINE/);
  assert.match(sellerSaleProblem({ ...valid, online: false, profile: deny("useOfflineSales") }), /VENTA-OFFLINE-PERMISO/);
  assert.match(sellerSaleProblem({ ...valid, ticketRequested: true, profile: deny("requestTicket") }), /TICKET-PERMISO/);
  assert.match(sellerSaleProblem({ ...valid, discounts: [{ source: "manual" }], profile: deny("useManualDiscounts") }), /DESCUENTO-MANUAL-PERMISO/);
  assert.equal(sellerSaleProblem({ ...valid, pendingStatus: "error", pendingError: { name: "SecurityError" } }), "");
  assert.match(sellerSaleProblem({ ...valid, online: false, pendingStatus: "error", pendingError: { name: "SecurityError" } }), /SecurityError/);
});

test("errores del servidor y almacenamiento tienen texto coloquial y código copiable", () => {
  assert.match(sellerErrorMessage({ code: "firestore/permission-denied" }), /permission-denied.*permiso/);
  assert.match(sellerErrorMessage({ name: "QuotaExceededError" }), /almacenamiento.*lleno/);
  assert.match(sellerErrorMessage({ code: "unavailable", message: "raw" }), /conectar con el servidor/);
  assert.match(sellerErrorMessage({ code: "deadline-exceeded" }), /Mis ventas.*dos veces/);
  assert.match(sellerErrorMessage(Object.assign(new Error("Aceite ya no está habilitado."), { code: "sale/validation" })), /Aceite ya no está habilitado/);
  assert.doesNotMatch(sellerErrorMessage({ code: "internal", message: "secret debugging details" }), /secret debugging/);
});

// Ejecuta el handler real con servicios locales para comprobar el límite entre
// guardar y refrescar la pantalla. No se conecta a Firebase.
const panel = readFileSync(new URL("../src/gestion/seller/SellerPanel.jsx", import.meta.url), "utf8");
const handler = panel.slice(panel.indexOf("  const submitSale ="), panel.indexOf("  const actionShortcuts ="));
function submission(overrides = {}) {
  const states = [], receipts = [], resets = [];
  const context = {
    useCallback: fn => fn, submitRef: { current: false }, submitState: { busy: false },
    selectedLocation: valid.location, currentItems: valid.items, profile: valid.profile,
    paymentMethod: "cash", payments: [], summary: { total: 1000 }, selectedCustomer: null,
    ticketRequested: false, online: true, editSale: null, appliedDiscounts: [],
    stockResult: { status: "ready" }, pendingSales: { status: "ready" }, PAYMENT_LABELS,
    sellerSaleProblem, sellerErrorMessage, setSubmitState: state => states.push(state),
    resetSale: () => resets.push(true), setReceipt: value => receipts.push(value),
    createSellerSale: async () => ({ id: "qa", saleCode: "QA-1", total: 1000 }),
    updateSellerSale: async () => ({ id: "qa", saleCode: "QA-1", total: 1000 }),
    savePending: async () => {}, dailySales: { refresh: async () => [] }, ...overrides,
  };
  const submit = Function(...Object.keys(context), `${handler}; return submitSale;`)(...Object.values(context));
  return { submit, states, receipts, resets, context };
}

test("dos clicks antes del render registran una sola venta", async () => {
  let calls = 0, finish;
  const h = submission({ createSellerSale: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = h.submit(), second = h.submit();
  assert.equal(calls, 1);
  finish({ id: "qa", saleCode: "QA-1" });
  await Promise.all([first, second]);
  assert.equal(h.receipts.length, 1);
  assert.equal(h.context.submitRef.current, false);
});

test("fallar la consulta después de guardar mantiene recibo y explica que ya se registró", async () => {
  const h = submission({ dailySales: { refresh: async () => { throw Object.assign(new Error("offline"), { code: "unavailable" }); } } });
  await h.submit();
  assert.equal(h.receipts.length, 1);
  assert.equal(h.resets.length, 1);
  assert.equal(h.states.at(-1).tone, "warning");
  assert.match(h.states.at(-1).message, /QA-1 quedó registrada.*No la cargues de nuevo/);
});

test("una venta rechazada conserva el carrito y permite corregir y reintentar", async () => {
  let calls = 0;
  const h = submission({ createSellerSale: async () => { if (++calls === 1) throw Object.assign(new Error("denied"), { code: "permission-denied" }); return { id: "qa", saleCode: "QA-1" }; } });
  await h.submit();
  assert.equal(h.resets.length, 0);
  assert.match(h.states.at(-1).message, /permiso/);
  assert.equal(h.context.submitRef.current, false);
  await h.submit();
  assert.equal(h.receipts.length, 1);
});

test("validación sin medio de pago no llama a guardar ni vacía el carrito", async () => {
  let calls = 0;
  const h = submission({ paymentMethod: "", createSellerSale: async () => { calls++; } });
  await h.submit();
  assert.equal(calls, 0);
  assert.equal(h.resets.length, 0);
  assert.match(h.states.at(-1).message, /PAGO-FALTANTE/);
});

test("un fallo al leer pendientes libera la sincronización y deja un mensaje visible", async () => {
  const start = panel.indexOf("  const syncPending =");
  const syncSource = panel.slice(start, panel.indexOf("\n  useEffect(", start));
  const states = [], busy = [];
  const context = {
    useCallback: fn => fn, syncing: false, syncRef: { current: false }, online: true,
    pendingSales: { refresh: async () => { throw { name: "QuotaExceededError" }; } },
    profile: valid.profile, dailySales: {}, sellerErrorMessage,
    setSubmitState: value => states.push(value), setSyncing: value => busy.push(value),
  };
  const sync = Function(...Object.keys(context), `${syncSource}; return syncPending;`)(...Object.values(context));
  await sync({ manual: true });
  assert.equal(context.syncRef.current, false);
  assert.deepEqual(busy, [true, false]);
  assert.equal(states.at(-1).tone, "error");
  assert.match(states.at(-1).message, /QuotaExceededError/);
});

test("guardar pendiente y fallar su listado conserva la confirmación local", async () => {
  const start = panel.indexOf("  const savePending =");
  const pendingSource = panel.slice(start, panel.indexOf("  const submitSale =", start));
  const saved = [], resets = [], states = [];
  const context = {
    useCallback: fn => fn, selectedLocation: { ...valid.location, name: "Local" }, profile: { ...valid.profile, name: "QA" },
    currentItems: valid.items, appliedDiscounts: [], summary: { total: 1000 }, paymentMethod: "cash", payments: [],
    selectedCustomer: null, ticketRequested: false, PAYMENT_LABELS, sellerErrorMessage,
    pendingSales: { refresh: async () => { throw { name: "QuotaExceededError" }; } },
    resetSale: () => resets.push(true), setSubmitState: value => states.push(value),
    saveSellerPendingSale: async value => saved.push(value),
  };
  const save = Function(...Object.keys(context), `${pendingSource}; return savePending;`)(...Object.values(context));
  await save();
  assert.equal(saved.length, 1); assert.equal(resets.length, 1);
  assert.match(states.at(-1).message, /quedó guardada.*No la cargues de nuevo/);
  assert.equal(states.at(-1).tone, "warning");
});

test("Enter sobre un botón lo activa; NumpadEnter conserva el atajo de venta", () => {
  const hooks = readFileSync(new URL("../src/gestion/seller/hooks.js", import.meta.url), "utf8");
  const start = hooks.indexOf("    const onKeyDown =");
  const source = hooks.slice(start, hooks.indexOf('    window.addEventListener("keydown"', start));
  let calls = 0, prevented = 0;
  const handlers = { current: { enabled: true, onContinue: () => calls++ } };
  const keydown = Function("handlers", "document", "isEditableTarget", "keyboardEventKeys", `${source}; return onKeyDown;`)(handlers, { querySelector: () => null }, isEditableTarget, keyboardEventKeys);
  const target = { matches: () => false, closest: () => ({}) };
  keydown({ key: "Enter", code: "Enter", target, preventDefault: () => prevented++ });
  assert.equal(calls, 0); assert.equal(prevented, 0);
  keydown({ key: "Enter", code: "NumpadEnter", target, preventDefault: () => prevented++ });
  assert.equal(calls, 1); assert.equal(prevented, 1);
});

test("descartar pendiente informa un fallo local y libera el bloqueo", async () => {
  const start = panel.indexOf("  const confirmDeletePending =");
  const source = panel.slice(start, panel.indexOf("  const canReturnAdmin =", start));
  const states = [];
  const context = {
    deletePendingTarget: { localId: "local_qa" }, submitRef: { current: false },
    setDeletePendingTarget: () => {}, setSubmitState: value => states.push(value), sellerErrorMessage,
    deleteSellerPendingSale: async () => { throw { name: "SecurityError" }; }, pendingSales: { refresh: async () => [] },
  };
  const discard = Function(...Object.keys(context), `${source}; return confirmDeletePending;`)(...Object.values(context));
  await discard();
  assert.equal(context.submitRef.current, false);
  assert.equal(states.at(-1).tone, "error"); assert.match(states.at(-1).message, /SecurityError/);
});
