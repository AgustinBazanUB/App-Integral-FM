import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SALES_CHANNELS } from "../src/modules/locations/domain/channels.js";

// Execute the page's real context handlers. Canceling or invalid drafts must
// never change the source of stock or erase an in-progress sale.
const source = readFileSync(new URL("../src/gestion/pages/QuickSalesPage.jsx", import.meta.url), "utf8");
const handlers = source.slice(source.indexOf("  const switchOrigin ="), source.indexOf("  const paymentStatus ="));
function harness(extra = {}) {
  const state = { channel: SALES_CHANNELS[0].value, stockType: "location", locationId: "local", quantities: { jam: 2 }, prices: { jam: 7000 }, discountIds: ["cash"], stock: { status: "ready", data: [{}] }, openCategoryId: "jam", originDraft: null, originError: "", dialog: "", ...extra };
  const bind = () => {
    const context = { ...state, SALES_CHANNELS, locations: [{ id: "local" }], warehousesResult: { data: [{ id: "warehouse" }] } };
    for (const key of Object.keys(state)) context[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === "function" ? value(state[key]) : value; };
    return Function(...Object.keys(context), `${handlers}\nreturn { openOriginDialog, confirmOrigin };`)(...Object.values(context));
  };
  return { state, open: () => bind().openOriginDialog(), confirm: () => bind().confirmOrigin() };
}
test("opening and editing the context draft leaves the current sale and source untouched", () => {
  const h = harness(); h.open();
  assert.deepEqual(h.state.originDraft, { channel: SALES_CHANNELS[0].value, stockType: "location", locationId: "local" });
  h.state.originDraft.stockType = "warehouse"; h.state.originDraft.locationId = "warehouse";
  assert.equal(h.state.stockType, "location"); assert.equal(h.state.locationId, "local");
  assert.deepEqual(h.state.quantities, { jam: 2 });
  // The real cancel handler only closes the dialog; reopening discards its draft.
  h.state.dialog = ""; h.open();
  assert.equal(h.state.originDraft.stockType, "location"); assert.equal(h.state.originDraft.locationId, "local");
});
test("invalid channel or a removed location reports a readable error without committing partial changes", () => {
  for (const draft of [
    { channel: "", stockType: "location", locationId: "local" },
    { channel: "unknown", stockType: "location", locationId: "local" },
    { channel: SALES_CHANNELS[0].value, stockType: "warehouse", locationId: "removed" },
  ]) {
    const h = harness({ originDraft: draft, dialog: "origin" }); h.confirm();
    assert.match(h.state.originError, /Elegí el canal/); assert.equal(h.state.dialog, "origin");
    assert.equal(h.state.stockType, "location"); assert.equal(h.state.locationId, "local");
    assert.deepEqual(h.state.quantities, { jam: 2 });
  }
});
test("confirming all three settings changes the source together and clears quantities from the previous source", () => {
  const h = harness({ originDraft: { channel: SALES_CHANNELS.at(-1).value, stockType: "warehouse", locationId: "warehouse" }, dialog: "origin" }); h.confirm();
  assert.equal(h.state.channel, SALES_CHANNELS.at(-1).value); assert.equal(h.state.stockType, "warehouse"); assert.equal(h.state.locationId, "warehouse");
  assert.deepEqual(h.state.quantities, {}); assert.deepEqual(h.state.prices, {}); assert.deepEqual(h.state.discountIds, []);
  assert.equal(h.state.openCategoryId, null); assert.equal(h.state.stock.status, "idle");
  assert.equal(h.state.dialog, ""); assert.equal(h.state.originError, "");
});
test("confirming the same source preserves products, prices and discounts already entered", () => {
  const h = harness(); h.open(); h.confirm();
  assert.deepEqual(h.state.quantities, { jam: 2 }); assert.deepEqual(h.state.prices, { jam: 7000 }); assert.deepEqual(h.state.discountIds, ["cash"]);
  assert.equal(h.state.stock.status, "ready"); assert.equal(h.state.dialog, "");
});
