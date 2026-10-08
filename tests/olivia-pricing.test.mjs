import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOfficialDollar, createPricingResolver } from '../netlify/functions/_lib/olivia/pricing.mjs';
import { costForUsage, defaultOliviaConfiguration } from '../src/shared/oliviaContracts.mjs';
const now = new Date('2026-10-04T15:00:00Z');
const html = '<h2>Cotización Billetes</h2><p>2/10/2026</p><td>Compra</td><td>Venta</td><td>Dolar U.S.A</td><td>1.490,00</td><td>1.540,00</td>';
test('official quote parsing rejects stale, future, invalid and unrelated rates', () => {
  assert.deepEqual(parseOfficialDollar(html, now), { rate:1540, date:'2026-10-02' });
  for (const date of ['2/9/2026','5/10/2026','31/9/2026']) assert.equal(parseOfficialDollar(html.replace('2/10/2026',date),now),null);
  assert.equal(parseOfficialDollar(html.replace('Cotización Billetes','Other'),now),null);
});
test('pricing caches dated official quotes, preserves configured model rates and manual exchange rates', async () => {
  let calls=0;
  const resolve = createPricingResolver({ fetchImpl: async()=>{calls++;return {ok:true,text:async()=>html};} });
  const cfg=defaultOliviaConfiguration(); cfg.pricing={'custom':{inputUsdPerMillion:3,outputUsdPerMillion:4}};
  const effective=await resolve(cfg,now);
  assert.equal(effective.officialDollarSellRate,1540);
  assert.equal(effective.pricing.custom.inputUsdPerMillion,3);
  assert.equal(effective.pricing['gpt-6-luna'].inputUsdPerMillion,0.1);
  await resolve(cfg,now); assert.equal(calls,1);
  const manual=await resolve({...cfg,officialDollarSellRate:1200},now);
  assert.equal(manual.officialDollarSellRate,1200); assert.equal(calls,1);
  assert.ok(Math.abs(costForUsage({model:'gpt-6-luna',inputTokens:1000000,outputTokens:1000000},effective).actualCostArs - 970.2) < 1e-9);
});
test('unavailable exchange quote leaves peso amounts unavailable instead of zero', async()=>{
  const resolve=createPricingResolver({fetchImpl:async()=>{throw Error('offline');}});
  const cfg=await resolve(defaultOliviaConfiguration(),now);
  assert.equal(cfg.officialDollarSellRate,null);
  assert.equal(costForUsage({model:'gpt-6-luna',inputTokens:100},cfg).actualCostArs,null);
});
