import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/gestion/pages/QuickSalesPage.jsx', import.meta.url), 'utf8');
const handlerSource = source.slice(source.indexOf('  const handleSubmit ='), source.indexOf('\n  return (', source.indexOf('  const handleSubmit =')));
function harness(overrides = {}) {
  const states = []; const noop = () => {};
  const context = { submitRef: { current: false }, selectedLocation: { id: 'local' }, profile: { id: 'admin' }, cart: [{ id: 'p1', qty: 1 }], appliedDiscounts: [], paymentMethod: 'cash', PAYMENT_LABELS: { cash: 'Efectivo' }, channel: 'manual', customerDni: '', invoiceRequested: false, receiverVatConditionId: '5', receiverDocument: '', deliveryMethod: 'pickup', locationId: 'local', formatMoney: String,
    setSubmitState: (s) => states.push(s), setQuantities: noop, setCustomerDni: noop, setPaymentMethod: noop, setInvoiceRequested: noop, setReceiverVatConditionId: noop, setReceiverDocument: noop, setDiscountIds: noop, setStock: noop,
    createQuickSale: async () => ({ id: 's1', saleCode: 'QA-1', total: 1210 }), listLocationInventory: async () => [], requestPendingArcaInvoice: async () => ({ id: 'invoice-s1' }), dryRunArcaInvoice: async () => ({ blocked: false }), ...overrides };
  const submit = Function(...Object.keys(context), `${handlerSource}; return handleSubmit;`)(...Object.values(context));
  return { submit: () => submit({ preventDefault() {} }), states, context };
}
test('Venta Rápida: dos submits antes del render registran una sola venta', async () => {
  let calls = 0; let finish;
  const h = harness({ createQuickSale: () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  const first = h.submit(); const second = h.submit();
  assert.equal(calls, 1); assert.equal(h.context.submitRef.current, true);
  finish({ id: 's1', saleCode: 'QA-1', total: 1210 }); await Promise.all([first, second]);
  assert.equal(h.context.submitRef.current, false); assert.equal(h.states.at(-1).error, '');
});
test('error fiscal mantiene venta y bloqueo comercial hasta finalizar preparación', async () => {
  let sales = 0; let rejectFiscal;
  const h = harness({ invoiceRequested: true, createQuickSale: async () => { sales++; return { id: 's1', saleCode: 'QA-1', total: 1210 }; }, requestPendingArcaInvoice: () => new Promise((_, reject) => { rejectFiscal = reject; }) });
  const first = h.submit(); await Promise.resolve(); const second = h.submit();
  assert.equal(sales, 1); rejectFiscal(new Error('Datos fiscales incompletos'));
  await Promise.all([first, second]); assert.equal(sales, 1);
  assert.match(h.states.at(-1).success, /La venta quedó registrada/);
});
test('fallo comercial libera bloqueo para corregir y volver a intentar', async () => {
  let calls = 0;
  const h = harness({ createQuickSale: async () => { calls++; if (calls === 1) throw new Error('Sin stock'); return { id: 's1', saleCode: 'QA-1', total: 1210 }; } });
  await h.submit(); assert.equal(h.context.submitRef.current, false); assert.equal(h.states.at(-1).error, 'Sin stock');
  await h.submit(); assert.equal(calls, 2); assert.equal(h.states.at(-1).error, '');
});
