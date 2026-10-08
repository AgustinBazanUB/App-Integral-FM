import test from "node:test";
import assert from "node:assert/strict";
import { calculateDiscountSummary, storedDiscountTotal, storedDiscountTotals } from "../src/modules/locations/domain/discounts.js";
import { buildFiscalAmounts } from "../netlify/functions/_lib/arca/billing.mjs";

const cash = { paymentMethod: "cash", roundCashTotal: true };
const fixed = value => [{ discountId: "manual", source: "manual", type: "fixed", value }];

test("cash discounts round down every remainder under one thousand, including one peso", () => {
  for (const remainder of [0, 1, 50, 99, 100, 200, 300, 400, 500, 600, 700, 800, 900, 999]) {
    const summary = calculateDiscountSummary(fixed(1000), 101000 + remainder, cash);
    assert.equal(summary.total, 100000);
    assert.equal(summary.cashRoundingDiscountTotal, remainder);
    assert.equal(summary.discountTotal, 1000 + remainder);
    assert.equal(summary.total + summary.discountTotal, summary.totalBeforeDiscounts);
  }
  assert.equal(calculateDiscountSummary(fixed(100), 2600, cash).total, 2000);
});

test("rounding follows all fixed and percentage discounts, without changing their values", () => {
  const result = calculateDiscountSummary([{ id: "cash-10", type: "percent", value: 10 }], 17000, cash);
  assert.equal(result.total, 15000);
  assert.equal(result.percentageDiscountTotal, 1700);
  assert.equal(result.cashRoundingDiscountTotal, 300);
  assert.equal(result.discountTotal, 2000);
  assert.equal(result.discounts[0].value, 10);
  assert.equal(result.discounts[0].amountApplied, 1700);
  const mixed = calculateDiscountSummary([...fixed(1000), { id: "ten", type: "percent", value: 10 }], 18000, cash);
  assert.equal(mixed.total, 15000);
  assert.equal(mixed.cashRoundingDiscountTotal, 300);
});

test("no rounding without discounts, in seller pricing or on non-cash payments", () => {
  assert.equal(calculateDiscountSummary([], 15300, cash).total, 15300);
  for (const paymentMethod of ["alias", "credit", "debit", "multiple", ""]) {
    const result = calculateDiscountSummary(fixed(1000), 16300, { ...cash, paymentMethod });
    assert.equal(result.total, 15300);
    assert.equal(result.cashRoundingDiscountTotal, 0);
  }
  assert.equal(calculateDiscountSummary(fixed(1000), 16300).total, 15300);
});

test("rounding cannot produce negative totals and is recomputed without compounding", () => {
  const first = calculateDiscountSummary(fixed(100), 2600, cash);
  assert.deepEqual(calculateDiscountSummary(first.discounts, 2600, cash), first);
  assert.equal(calculateDiscountSummary(first.discounts, 3100, cash).cashRoundingDiscountTotal, 0);
  assert.equal(calculateDiscountSummary(fixed(9999), 2500, cash).total, 0);
  assert.equal(calculateDiscountSummary(fixed(100), 500, cash).total, 0);
});

test("stored accounting and fiscal allocation include the cash adjustment exactly once", () => {
  const sale = calculateDiscountSummary([{ id: "cash-10", type: "percent", value: 10 }], 17000, cash);
  assert.equal(storedDiscountTotal(sale), 2000);
  assert.equal(storedDiscountTotal({ ...sale, discountTotal: undefined }), 2000);
  assert.equal(storedDiscountTotals(sale).discountTotal, 2000);
  const fiscal = buildFiscalAmounts({ items: [{ productId: "p", name: "Producto", qty: 1, unitPrice: 17000, subtotal: 17000 }], discountTotal: sale.discountTotal, vatRateByProduct: { p: 21 } });
  assert.equal(fiscal.total, sale.total);
});
