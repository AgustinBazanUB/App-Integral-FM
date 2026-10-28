// Local-only browser fixture. Never imported by the production entry point.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const root = process.cwd();
const fixture = path.join(root, 'tests/fixtures/olivia-orb');
const server = await createServer({ configFile: false, root, optimizeDeps: { entries: [path.join(fixture, "index.html")] }, plugins: [{ name: 'olivia-fixture', enforce: 'pre', resolveId(source, importer) {
  if (source.endsWith('/router') || (importer?.endsWith('/OliviaAssistant.jsx') && ['../AuthContext', './ScreenContext', './LauncherHost'].includes(source))) return path.join(fixture, 'mocks.jsx');
  if (importer?.endsWith('/OliviaAssistant.jsx') && source === './service') return path.join(fixture, 'service.mjs');
} }, react()], server: { host: '127.0.0.1', port: 4179, strictPort: true } });
await server.listen(); console.log('Olivia fixture: http://127.0.0.1:4179/tests/fixtures/olivia-orb/index.html');
