import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { calculateDiscountSummary } from "../src/modules/locations/domain/discounts.js";

// Exercise the real administrator-page boundary, which previously supplied
// obsolete callbacks to the shared discount dialog and crashed on confirmation.
const source = readFileSync(new URL("../src/gestion/pages/QuickSalesPage.jsx", import.meta.url), "utf8");
const element = source.match(/<DiscountDialog\s[^\n]+\/>/)[0];
const compiled = transformSync(`return (${element});`, { loader: "jsx", jsxFactory: "render" }).code;
function boundary(extra = {}) {
  const state = { ids: [], manual: [], dialog: "discount", ...extra };
  const context = {
    render: (_type, props) => props, DiscountDialog: "DiscountDialog", dialog: state.dialog,
    availableDiscounts: [{ id: "cash", name: "Efectivo", type: "percent", value: 10 }],
    discountIds: state.ids, manualDiscounts: state.manual, profile: { role: "admin" }, can: () => true,
    setDiscountIds: value => { state.ids = value; }, setManualDiscounts: value => { state.manual = value; }, setDialog: value => { state.dialog = value; },
  };
  return { state, props: Function(...Object.keys(context), compiled)(...Object.values(context)), context };
}
test("administrative discount confirmation passes saved and multiple manual drafts and closes the dialog", () => {
  const existing = { discountId: "manual", source: "manual", type: "fixed", value: 1000 };
  const h = boundary({ manual: [existing] });
  assert.equal(typeof h.props.onApply, "function"); assert.deepEqual(h.props.initialManualDiscounts, [existing]);
  const manual = [existing, { discountId: "manual", source: "manual", type: "percent", value: 10 }];
  h.props.onApply({ savedIds: ["cash"], manual });
  assert.deepEqual(h.state.ids, ["cash"]); assert.deepEqual(h.state.manual, manual); assert.equal(h.state.dialog, "");
});
test("cancel leaves applied discounts unchanged; confirming cash 10% uses the rounded summary", () => {
  const h = boundary(); h.props.onClose(); assert.deepEqual(h.state.ids, []); assert.deepEqual(h.state.manual, []);
  h.props.onApply({ savedIds: ["cash"], manual: [] });
  const applied = h.context.availableDiscounts.filter(discount => h.state.ids.includes(discount.id));
  assert.equal(calculateDiscountSummary(applied, 17000, { paymentMethod: "cash", roundCashTotal: true }).total, 15000);
});
