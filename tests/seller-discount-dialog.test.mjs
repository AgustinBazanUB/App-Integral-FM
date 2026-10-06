import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Renderiza el componente real con un adaptador mínimo de hooks y elementos.
// Los eventos ejecutan sus handlers originales; no se conecta a servicios.
const bundle = await build({ entryPoints: ["src/gestion/seller/DiscountDialog.jsx"], bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", plugins: [{ name: "discount-local-render", setup(b) {
  b.onResolve({ filter: /^react$|^react\/jsx-runtime$|design-system$|formatters$|components\/icons$/ }, args => ({ path: args.path, namespace: "qa" }));
  b.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "react" ? `
    export const useState=value=>globalThis.__sellerDiscountHooks.state(value);
    export const useEffect=(fn,deps)=>globalThis.__sellerDiscountHooks.effect(fn,deps);
  ` : path === "react/jsx-runtime" ? `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`
    : path.endsWith("design-system") ? `export const Button='Button';export const Modal='Modal';`
    : path.endsWith("formatters") ? `export const formatMoney=value=>'$'+value;`
    : `export const Icon='Icon';` }));
} }] });
const { default: DiscountDialog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const discounts = [{ id: "cash", name: "Efectivo", type: "percent", value: 10 }, { id: "promo", name: "Promo 2", type: "fixed", value: 1000 }];

function harness(extra = {}) {
  const values = [], dependencies = [], effects = [], applied = [];
  let cursor = 0, tree;
  const host = {
    state(value) { const index = cursor++; if (!(index in values)) values[index] = value; return [values[index], next => { values[index] = typeof next === "function" ? next(values[index]) : next; }]; },
    effect(fn, deps) { const index = cursor++; if (!dependencies[index] || deps.some((dep, i) => dep !== dependencies[index][i])) { dependencies[index] = deps; effects.push(fn); } },
  };
  const props = { open: true, availableDiscounts: discounts, selectedDiscountIds: [], initialManualDiscounts: [], manualAllowed: true, onApply: value => applied.push(value), onClose: () => { props.open = false; }, ...extra };
  const render = () => { globalThis.__sellerDiscountHooks = host; cursor = 0; tree = DiscountDialog(props); const pending = effects.splice(0); if (pending.length) { pending.forEach(fn => fn()); cursor = 0; tree = DiscountDialog(props); } return tree; };
  const text = element => element == null || typeof element === "boolean" ? "" : typeof element === "string" || typeof element === "number" ? String(element) : Array.isArray(element) ? element.map(text).join(" ") : text(element.props?.children);
  const elements = element => element == null || typeof element !== "object" ? [] : Array.isArray(element) ? element.flatMap(elements) : [element, ...elements(element.props?.children)];
  const click = label => { const button = elements(tree).find(element => ["button", "Button"].includes(element.type) && text(element).trim() === label); assert.ok(button, `Botón ${label}`); button.props.onClick(); render(); };
  render();
  return { props, applied, render, click, text: () => text(tree), input: value => { elements(tree).find(element => element.type === "input").props.onChange({ target: { value } }); render(); } };
}

test("seleccionar promociones no aplica nada; confirmar entrega la selección completa", () => {
  const h = harness(); h.click("Efectivo 10 % Porcentaje");
  assert.equal(h.applied.length, 0);
  assert.match(h.text(), /Seleccionado · falta confirmar/);
  h.click("Promo 2 $1000 Monto fijo"); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied, [{ savedIds: ["cash", "promo"], manual: [] }]);
});

test("cancelar y reabrir conserva únicamente los descuentos ya aplicados", () => {
  const h = harness({ selectedDiscountIds: ["promo"] });
  h.click("Efectivo 10 % Porcentaje"); h.click("Cancelar");
  h.props.open = true; h.render(); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied, [{ savedIds: ["promo"], manual: [] }]);
});

test("se puede deseleccionar y confirmar para quitar el último descuento", () => {
  const h = harness({ selectedDiscountIds: ["cash"] });
  h.click("Efectivo 10 % Seleccionado · falta confirmar"); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied, [{ savedIds: [], manual: [] }]);
});

test("confirmar sin elegir explica el motivo y no cierra ni aplica", () => {
  const h = harness(); h.click("Confirmar descuentos");
  assert.match(h.text(), /DESCUENTO-FALTANTE/); assert.equal(h.applied.length, 0);
});

test("manual inválido se explica; un valor válido se agrega junto a los guardados", () => {
  const h = harness({ selectedDiscountIds: ["promo"] });
  h.click("Porcentaje"); h.input("101"); h.click("Confirmar descuentos");
  assert.match(h.text(), /DESCUENTO-PORCENTAJE/); assert.equal(h.applied.length, 0);
  h.input("15"); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied[0].savedIds, ["promo"]);
  assert.equal(h.applied[0].manual[0].value, 15);
});

test("permisos manuales no impiden confirmar un descuento guardado", () => {
  const h = harness({ manualAllowed: false }); h.click("Porcentaje");
  assert.match(h.text(), /DESCUENTO-MANUAL-PERMISO/);
  h.click("Efectivo 10 % Porcentaje"); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied, [{ savedIds: ["cash"], manual: [] }]);
});

test("una promo que deja de estar disponible se explica antes de aplicar", () => {
  const h = harness(); h.click("Efectivo 10 % Porcentaje");
  h.props.availableDiscounts = [discounts[1]]; h.render(); h.click("Confirmar descuentos");
  assert.match(h.text(), /DESCUENTO-NO-DISPONIBLE/); assert.equal(h.applied.length, 0);
});

test("atajo de descuento abre una propuesta, no agrega otro manual ni lo aplica", () => {
  const manual = { discountId: "manual", source: "manual", name: "Manual", type: "fixed", value: 500 };
  const h = harness({ suggestedDiscountId: "cash", initialManualDiscounts: [manual] });
  assert.equal(h.applied.length, 0); h.click("Confirmar descuentos");
  assert.deepEqual(h.applied, [{ savedIds: ["cash"], manual: [manual] }]);
});
