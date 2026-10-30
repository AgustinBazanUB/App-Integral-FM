// Local-only browser fixture. Never imported by the production entry point.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fixture as engineFixture, textResponse } from './helpers/olivia-fixture.mjs';
const root = process.cwd();
const copilot = process.argv.includes('--copilot');
const fixture = path.join(root, copilot ? 'tests/fixtures/olivia-copilot' : 'tests/fixtures/olivia-orb');
// Optional UI integration uses the real engine with an in-memory store and a
// stub for suggestion wording. It never reaches Firebase or paid providers.
const guide = engineFixture({ role: 'admin', provider: async (_path, body) => {
  if (body.text?.format?.name === 'app_suggestion') {
    const input = JSON.parse(body.input[0].content), simple = /otra manera|mas simple/i.test(input.message);
    return textResponse(JSON.stringify({ ready: true, title: 'Explicar los datos con ejemplos', panel: 'Conversación de Olivia', summary: 'La lista de campos no explica qué información dar.', expectedBehavior: simple ? 'Preguntar con ejemplos fáciles y conservar lo que ya conversamos.' : 'Explicar el nombre, el código de ventas y el tipo de ubicación; hacer lo mismo al pedir datos de otros registros.', question: '' }));
  }
  if (copilot) {
    const query = body.input?.filter(row => row.role === 'user').at(-1)?.content || '';
    return textResponse(/funci[oó]n|JavaScript/.test(query) ? 'Podés usar esta función:\n\n```js\nfunction descuento(precio, porcentaje) {\n  return precio * (1 - porcentaje / 100);\n}\n```\n\nEs un ejemplo; no se ejecutó.' : /segunda|corta/.test(query) ? 'La segunda, más corta: Paseo Estación. Sigue siendo una propuesta.' : '1. Feria Andén\n2. Paseo de la Estación\n3. Mercado del Encuentro\n\nMe gusta Feria Andén: es corto y conecta con el lugar. Son ideas, todavía no se guardó ninguna.');
  }
  return textResponse('Esta prueba usa datos ficticios. Podés pedir crear una ubicación o explicar sus campos.');
} });
let guideId;
const guideJobs = new Map();
const server = await createServer({ configFile: false, root, optimizeDeps: { entries: [path.join(fixture, "index.html")] }, plugins: [{ name: 'olivia-context-fixture', configureServer(dev) {
  dev.middlewares.use('/__qa/olivia-context', async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 100000) throw new Error('Fixture body too large'); }
      const body = JSON.parse(raw), operation = body.operation;
      guideId ||= (await guide.engine.state(guide.session, null)).conversationId;
      const state = async () => ({ ...await guide.engine.state(guide.session, guideId), voiceConversationAvailable: false });
      let result;
      if (operation === 'estimate') result = { estimate: null };
      else if (['state', 'resume'].includes(operation)) result = await state();
      else if (operation === 'startChat') {
        if (!guideJobs.has(body.requestId)) {
          guide.advance(1500);
          const reply = await guide.engine.chat(guide.session, { ...body, conversationId: guideId, screenContext: copilot ? body.screenContext : { route: '/gestion', module: 'dashboard' } });
          guideJobs.set(body.requestId, { status: 'completed', text: '', phase: 'Lista', accepted: reply.messages.filter(message => message.role === 'user').at(-1), conversationId: guideId, result: { ...reply, voiceConversationAvailable: false } });
        }
        result = { jobId: body.requestId, conversationId: guideId };
      } else if (operation === 'chatStatus') result = guideJobs.get(body.jobId);
      else if (operation === 'history') result = body.conversationId ? { selectedConversation: { messages: [], nextCursor: null } } : { conversations: [], conversationsCursor: null };
      else result = await state();
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ message: error.message })); }
  });
  if (copilot) dev.middlewares.use((req, _res, next) => { if (req.url?.startsWith('/gestion') && req.headers.accept?.includes('text/html')) req.url = '/tests/fixtures/olivia-copilot/index.html'; next(); });
} }, { name: 'olivia-fixture', enforce: 'pre', resolveId(source, importer) {
  if (copilot) {
    if (source.endsWith('/AuthContext') || source.endsWith('/connection') || (importer?.endsWith('/LocationsPage.jsx') && /services\//.test(source))) return path.join(fixture, 'mocks.jsx');
    if (importer?.endsWith('/OliviaAssistant.jsx') && source === './service') return path.join(fixture, 'service.mjs');
    return;
  }
  if (source.endsWith('/router') || (importer?.endsWith('/OliviaAssistant.jsx') && ['../AuthContext', './ScreenContext', './LauncherHost'].includes(source))) return path.join(fixture, 'mocks.jsx');
  if (importer?.endsWith('/OliviaAssistant.jsx') && source === './service') return path.join(fixture, 'service.mjs');
} }, react()], server: { host: '127.0.0.1', port: 4179, strictPort: true } });
await server.listen(); console.log('Olivia fixture: http://127.0.0.1:4179/tests/fixtures/olivia-orb/index.html');
