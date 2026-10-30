import { createOliviaTransport } from '../../../src/gestion/olivia/client.mjs';
export const oliviaClient = createOliviaTransport({ getToken: async () => 'synthetic-only', pollIntervalMs: 100, fetchImpl: (_url, init) => fetch('/__qa/olivia-context', init) });
