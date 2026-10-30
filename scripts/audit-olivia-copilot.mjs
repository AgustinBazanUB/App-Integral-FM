import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { OLIVIA_CAPABILITIES } from '../src/shared/oliviaCapabilities.mjs';
import { OLIVIA_TOOL_SCHEMAS } from '../src/shared/oliviaContracts.mjs';
import { OLIVIA_APP_GUIDE } from '../src/shared/oliviaAppGuide.mjs';
import { UI_GUIDES, UI_GUIDE_VERSION } from '../src/shared/oliviaUiGuides.mjs';
import { requiredFields } from '../netlify/functions/_lib/olivia/tasks.mjs';
import { fieldGuidance } from '../src/shared/oliviaOperationGuide.mjs';
import { capabilities } from '../netlify/functions/_lib/olivia/guards.mjs';
import { toolDefinitions } from '../netlify/functions/_lib/olivia/tools.mjs';
import { fixture, start, textResponse } from '../tests/helpers/olivia-fixture.mjs';

const folder = 'docs/olivia/2026-10-30/copiloto';
fs.mkdirSync(folder, { recursive: true });
const coreModules = { prepare_sale: 'quick-sales', prepare_stock_load: 'locations', search_products: 'products', get_stock: 'locations', list_locations: 'locations', get_promotions: 'quick-sales', get_today_sales: 'seller' };
const tools = [...new Set([...Object.keys(OLIVIA_CAPABILITIES), ...Object.keys(OLIVIA_TOOL_SCHEMAS)])].map(name => ({ name,
  module: OLIVIA_CAPABILITIES[name]?.module || coreModules[name] || 'core', action: OLIVIA_CAPABILITIES[name]?.action || null,
  kind: name.startsWith('prepare_') ? 'preparation' : 'read-or-ui', requiresVisualConfirmation: name.startsWith('prepare_'),
  minimumFields: requiredFields(name).map(field => ({ field, explanation: fieldGuidance(name, field) })),
  permittedFor: ['admin', 'seller'].filter(role => capabilities(fixture({ role }).session).includes(name)),
}));
const report = { version: UI_GUIDE_VERSION, source: 'Contratos y componentes del repositorio; sin datos de usuarios ni llamadas a proveedores', tools, modules: OLIVIA_APP_GUIDE.map(row => ({ ...row,
  reads: tools.filter(tool => tool.module === row.module && !tool.requiresVisualConfirmation).map(tool => tool.name),
  preparations: tools.filter(tool => tool.module === row.module && tool.requiresVisualConfirmation).map(tool => tool.name),
  visualGuides: Object.entries(UI_GUIDES).filter(([, guide]) => guide.module === row.module).map(([id, guide]) => ({ id, action: guide.action, steps: guide.steps })),
})) };
const gaps = tools.flatMap(tool => tool.minimumFields.filter(field => !field.explanation));
if (gaps.length) throw new Error('Faltan explicaciones de campos.');
fs.writeFileSync(`${folder}/CAPACIDADES.json`, JSON.stringify(report, null, 2) + '\n');

const durations = [], samples = [];
for (let n = 0; n < 20; n++) {
  const f = fixture({ role: 'admin', provider: async () => textResponse('1. Feria Andén\n2. Paseo Estación\nSon ideas, no están guardadas.') }), { conversationId } = await start(f);
  const t = performance.now();
  const result = await f.engine.chat(f.session, { conversationId, requestId: 'bench_idea', message: 'Inventame un nombre para una feria cerca de una estación', screenContext: { route: '/gestion', module: 'dashboard' } });
  durations.push(performance.now() - t);
  const body = f.providerRequests[0], withTools = { ...body, tools: toolDefinitions(f.session, { query: 'Inventame un nombre para una feria cerca de una estación', context: { module: 'dashboard' } }) };
  samples.push({ modelCalls: f.providerCalls(), businessToolCalls: result.telemetry.toolCalls, requestBytes: Buffer.byteLength(JSON.stringify(body)), counterfactualWithSchemasBytes: Buffer.byteLength(JSON.stringify(withTools)), schemaCount: withTools.tools.length });
}
durations.sort((a, b) => a - b);
const percentile = q => Math.round(durations[Math.ceil(q * durations.length) - 1] * 100) / 100;
const measurements = { environment: 'Adaptador local en memoria y respuesta de modelo simulada. No representa red, proveedor, tokens reales ni audio físico.', n: 20, localTurnMs: { p50: percentile(.5), p90: percentile(.9), p95: percentile(.95) }, sample: samples[0], allSamplesOneModelNoBusinessTools: samples.every(sample => sample.modelCalls === 1 && sample.businessToolCalls === 0), paidProviderCalls: 0,
  counterfactual: 'Mismo cuerpo actual con esquemas que se habrían ofrecido sin la ruta de generación. Es una comparación de bytes, no una medición del modelo anterior ni de tokens.',
  visualGuideModelCalls: 0,
};
const assets = fs.existsSync('dist/gestion/assets') ? fs.readdirSync('dist/gestion/assets').filter(name => name.startsWith('driver.js-') && name.endsWith('.js')) : [];
measurements.driverAssets = assets.map(name => { const bytes = fs.readFileSync(`dist/gestion/assets/${name}`); return { name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, loaded: 'Solo al iniciar guía visual' }; });
fs.writeFileSync(`${folder}/MEDICIONES.json`, JSON.stringify(measurements, null, 2) + '\n');
console.log(JSON.stringify({ tools: tools.length, modules: report.modules.length, guides: Object.keys(UI_GUIDES).length, detailedGuides: Object.keys(UI_GUIDES).filter(id => !id.startsWith('module-')).length, missingFields: gaps.length, measurements }));
