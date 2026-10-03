import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/gestion/pages/QuickSalesPage.jsx', import.meta.url), 'utf8');
const handlerSource = source.slice(source.indexOf('  const handleSubmit ='), source.indexOf('\n  return (', source.indexOf('  const handleSubmit =')));
function harness(overrides = {}) {
  const states = []; const noop = () => {};
  const context = { submitRef: { current: false }, selectedLocation: { id: 'local' }, profile: { id: 'admin' }, cart: [{ id: 'p1', qty: 1 }], appliedDiscounts: [], saleSummary: { total: 1210 }, paymentMethod: 'cash', PAYMENT_LABELS: { cash: 'Efectivo' }, channel: 'whatsapp', customerDni: '', invoiceRequested: false, receiverVatConditionId: '5', receiverDocument: '', deliveryMethod: 'pickup', locationId: 'local', formatMoney: String,
    pendingIntent: null, stockOrigin: { type: 'location', id: 'local' }, customer: { phone: '' }, payments: [], prices: {},
    SALES_CHANNELS: [{ value: 'whatsapp' }], normalizePayment: noop, findCustomerByPhone: async () => null, buildCustomerDraft: value => value,
    saveQuickSaleIntent: (_id, sale) => ({ requestId: 'attempt-1', sale }), clearQuickSaleIntent: noop, setPendingIntent: noop,
    setDialog: noop, setPrices: noop, setPayments: noop, setCustomer: noop, setCustomerState: noop, setManualDiscount: noop, SINGLE_PAYMENT_METHODS: ['cash'], refreshStock: async () => {},
    setSubmitState: (s) => states.push(s), setRegisteredInvoice: noop, setQuantities: noop, setCustomerDni: noop, setPaymentMethod: noop, setInvoiceRequested: noop, setReceiverVatConditionId: noop, setReceiverDocument: noop, setDiscountIds: noop, setStock: noop,
    createQuickSale: async () => ({ id: 's1', saleCode: 'QA-1', total: 1210 }), listLocationInventory: async () => [], requestPendingArcaInvoice: async () => ({ id: 'invoice-s1' }), dryRunArcaInvoice: async () => ({ blocked: false }), ...overrides };
  const submit = Function(...Object.keys(context), `${handlerSource}; return handleSubmit;`)(...Object.values(context));
  return { submit: (invoice) => submit({ preventDefault() {} }, invoice), states, context };
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
  const h = harness({ createQuickSale: async () => { calls++; if (calls === 1) throw Object.assign(new Error('Sin stock'), { code: 'seller/insufficient-stock' }); return { id: 's1', saleCode: 'QA-1', total: 1210 }; } });
  await h.submit(); assert.equal(h.context.submitRef.current, false); assert.equal(h.states.at(-1).error, 'Sin stock');
  await h.submit(); assert.equal(calls, 2); assert.equal(h.states.at(-1).error, '');
});


test('confirmación incierta conserva el intento y falla de refresco posterior conserva el éxito comercial', async () => {
  let cleared = 0;
  const uncertain = harness({ clearQuickSaleIntent: () => { cleared++; }, createQuickSale: async () => { throw Object.assign(new Error('Acuse perdido'), { code: 'unavailable' }); } });
  await uncertain.submit(); assert.equal(cleared, 0); assert.equal(uncertain.states.at(-1).error, 'Acuse perdido');
  const confirmed = harness({ refreshStock: async () => { throw new Error('Sin conexión al refrescar'); } });
  await confirmed.submit(); assert.equal(confirmed.states.at(-1).error, ''); assert.match(confirmed.states.at(-1).success, /registrada/);
});


test('botones de cierre eligen facturar o continuar sin checkbox', async () => {
  let fiscalCalls = 0; let requested;
  const createQuickSale = async sale => { requested = sale.invoiceRequested; return { id: 's1', saleCode: 'QA-1', total: 1210 }; };
  const requestPendingArcaInvoice = async () => { fiscalCalls++; return { id: 'i1' }; };
  await harness({ createQuickSale, requestPendingArcaInvoice }).submit(false);
  assert.equal(requested, false); assert.equal(fiscalCalls, 0);
  await harness({ createQuickSale, requestPendingArcaInvoice }).submit(true);
  assert.equal(requested, true); assert.equal(fiscalCalls, 1);
});

test('recuperar confirmacion mantiene la decision fiscal original', async () => {
  let fiscalCalls = 0;
  const pendingIntent = { requestId: 'attempt-1', sale: { invoiceRequested: true } };
  await harness({ pendingIntent, requestPendingArcaInvoice: async () => { fiscalCalls++; return { id: 'i1' }; } }).submit(false);
  assert.equal(fiscalCalls, 1);
});
