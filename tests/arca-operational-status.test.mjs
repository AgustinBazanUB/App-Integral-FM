import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildArcaOperationalStatus } from '../netlify/functions/_lib/arca/readiness.mjs';
import { arcaSafeStatus } from '../netlify/functions/_lib/arca/config.mjs';
import handler from '../netlify/functions/arca-taxpayer.mjs';
import { clearWsaaTicketCache } from '../netlify/functions/_lib/arca/wsaa.mjs';
import { clearFirebaseAdminTokenCache } from '../netlify/functions/_lib/firestoreAdminRest.mjs';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const fixtureDir = mkdtempSync(join(tmpdir(), 'arca-audit-fixture-'));
const keyPath = join(fixtureDir, 'synthetic.key');
writeFileSync(keyPath, key);
let cert;
try {
  cert = execFileSync(process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl', ['req', '-new', '-x509', '-key', keyPath, '-days', '2', '-subj', '/CN=AUDIT-ONLY'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} finally { unlinkSync(keyPath); rmdirSync(fixtureDir); }

const synthetic = {
  ARCA_ENVIRONMENT: 'production', ARCA_ISSUER_CUIT: '20233280799', ARCA_POINT_OF_SALE: '8',
  ARCA_CERTIFICATE_PEM: cert, ARCA_PRIVATE_KEY_PEM: key,
  ARCA_ISSUER_VAT_CONDITION: 'responsable_inscripto', ARCA_ISSUER_LEGAL_NAME: 'AUDIT ONLY',
  ARCA_ISSUER_COMMERCIAL_ADDRESS: 'AUDIT ADDRESS', ARCA_ISSUER_GROSS_INCOME: 'AUDIT',
  ARCA_ISSUER_ACTIVITY_START: '20200101', ARCA_TA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  FIREBASE_ADMIN_CLIENT_EMAIL: 'audit@example.invalid', FIREBASE_ADMIN_PRIVATE_KEY: key,
};
const runtime = {
  wsaa: { status: 'ok' }, wsfe: { status: 'ok' }, firebaseAdmin: { status: 'ok' },
  pointOfSale: { status: 'ok', found: true, operational: true }, taxpayerLookup: { status: 'ok' },
};
test('AUDIT: configured rechaza un punto de venta fuera del rango admitido', () => {
  const status = buildArcaOperationalStatus({ env: { ...synthetic, ARCA_POINT_OF_SALE: '100000' }, runtime });
  assert.equal(status.configured, false);
  assert.equal(status.pointOfSale, null);
});
test('AUDIT: configured rechaza una clave de cache presente pero inválida', () => {
  const status = buildArcaOperationalStatus({ env: { ...synthetic, ARCA_TA_ENCRYPTION_KEY: 'invalid-key' }, runtime });
  assert.equal(status.configured, false);
});
test('AUDIT: un error remoto no devuelve Token, Sign ni TA reflejados', () => {
  const marker = 'SYNTHETIC_SECRET_SENTINEL';
  const status = buildArcaOperationalStatus({ env: synthetic, runtime: {
    ...runtime, wsfe: { status: 'error', error: { status: 500, code: 'SOAP-FAULT', message: '<Token>' + marker + '</Token><Sign>' + marker + '</Sign>' } },
  } });
  assert.equal(JSON.stringify(status).includes(marker), false);
});
test('AUDIT: faltar la clave de cache no equivale a una caída temporal de ARCA', () => {
  const env = { ...synthetic }; delete env.ARCA_TA_ENCRYPTION_KEY;
  const status = buildArcaOperationalStatus({ env, runtime: {
    ...runtime, wsaa: { status: 'error', error: { code: 'arca-wsaa-shared-cache-required', status: 503, message: 'Falta el cache compartido.' } },
  } });
  assert.equal(status.availability, 'degraded');
  assert.equal(status.services.wsaa.temporary, false);
});
for (const [code, statusCode] of [['arca-timeout',504], ['arca-network-error',502], ['arca-soap-http-error',500]]) {
  test('AUDIT: indisponibilidad temporal reconocida: ' + code, () => {
    const status = buildArcaOperationalStatus({env:synthetic,runtime:{...runtime,wsfe:{status:'error',error:{code,status:statusCode,message:'Error simulado'}}}});
    assert.equal(status.configured,true);assert.equal(status.operational,false);
    assert.equal(status.availability,'unavailable');assert.equal(status.services.wsfe.temporary,true);
  });
}

async function withMockedHandler(scenario, operation) {
  const envBefore = {};
  for (const name of Object.keys(process.env).filter(name => /^(ARCA_|FIREBASE_ADMIN_)/.test(name))) {
    envBefore[name] = process.env[name]; delete process.env[name];
  }
  Object.assign(process.env, synthetic, { ARCA_ENVIRONMENT: 'homologation' });
  delete process.env.ARCA_TA_ENCRYPTION_KEY;
  clearWsaaTicketCache(); clearFirebaseAdminTokenCache();
  const previousFetch = globalThis.fetch;
  const calls = [];
  const soap = body => new Response('<Envelope><Body>' + body + '</Body></Envelope>', { status: 200 });
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url); const body = String(options.body || '');
    const action = String(options.headers?.SOAPAction || '');
    calls.push({ host: new URL(target).hostname, method: options.method || 'GET', action });
    if (action.includes('FECAESolicitar')) throw new Error('AUDIT_CAЕ_FORBIDDEN');
    if (target.includes('identitytoolkit')) return Response.json({ users: [{ localId: 'audit-admin' }] });
    if (target.includes('/users/')) return Response.json({ fields: { active: { booleanValue: true }, role: { stringValue: scenario.role || 'admin' } } });
    if (target.includes('oauth2')) return Response.json({ access_token: 'SYNTHETIC_OAUTH', expires_in: 3600 });
    if (target.includes('firestore')) return new Response('{}', { status: 404 });
    if (action.includes('FEDummy')) {
      if (scenario.echoFault) return soap('<Fault><faultcode>SOAP-FAULT</faultcode><faultstring>&lt;Token&gt;SYNTHETIC_REMOTE_SECRET&lt;/Token&gt;</faultstring></Fault>');
      return soap('<FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult>');
    }
    if (target.includes('LoginCms')) return soap('<loginCmsReturn>&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2099-01-01T00:00:00Z&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;SYNTHETIC_TOKEN&lt;/token&gt;&lt;sign&gt;SYNTHETIC_SIGN&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn>');
    if (action.includes('FEParamGetPtosVenta')) {
      if (scenario.points502) return new Response('upstream error', { status: 502 });
      return soap('<FEParamGetPtosVentaResult><ResultGet><PtoVenta><Nro>8</Nro><Bloqueado>N</Bloqueado></PtoVenta></ResultGet>' + (scenario.pointsErrors ? '<Errors><Err><Code>600</Code><Msg>Rejected</Msg></Err></Errors>' : '') + '</FEParamGetPtosVentaResult>');
    }
    if (target.includes('personaServiceA5')) return soap('<getPersona_v2Response><personaReturn><datosGenerales><idPersona>20233280799</idPersona><tipoPersona>FISICA</tipoPersona><estadoClave>ACTIVO</estadoClave></datosGenerales></personaReturn></getPersona_v2Response>');
    throw new Error('Unexpected audit mock route');
  };
  try { await operation(calls); }
  finally {
    globalThis.fetch = previousFetch; clearWsaaTicketCache(); clearFirebaseAdminTokenCache();
    for (const name of Object.keys(process.env).filter(name => /^(ARCA_|FIREBASE_ADMIN_)/.test(name))) delete process.env[name];
    Object.assign(process.env, envBefore);
  }
}
function req(mode, bearer = true) { return new Request('http://localhost/.netlify/functions/arca-taxpayer', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { authorization: 'Bearer SYNTHETIC_SESSION' } : {}) }, body: JSON.stringify({ mode }) }); }

test('AUDIT: status conserva semántica sin contactar ARCA ni OAuth administrativo', async () => {
  await withMockedHandler({}, async calls => {
    const response = await handler(req('status')); const data = await response.json();
    assert.equal(response.status, 200); assert.deepEqual(data.status, arcaSafeStatus(process.env));
    assert.equal(calls.length, 2); assert.equal(calls.some(call => /afip|arca/.test(call.host)), false);
  });
});
test('AUDIT: operational-status requiere un administrador activo', async () => {
  await withMockedHandler({ role: 'seller' }, async calls => {
    const response = await handler(req('operational-status'));
    assert.equal(response.status, 403); assert.equal(calls.length, 2);
  });
});
test('AUDIT: operational-status no emite CAE ni escribe invoices, sales o locks', async () => {
  await withMockedHandler({}, async calls => {
    const response = await handler(req('operational-status')); const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls.some(call => call.action.includes('FECAESolicitar')), false);
    assert.equal(calls.some(call => /firestore/.test(call.host) && call.method !== 'GET'), false);
    for (const value of ['SYNTHETIC_TOKEN', 'SYNTHETIC_SIGN', 'SYNTHETIC_OAUTH', key, cert]) assert.equal(JSON.stringify(data).includes(value), false);
  });
});
test('AUDIT: un 502 de WSFE posterior a autenticar no marca WSAA fallido', async () => {
  await withMockedHandler({ points502: true }, async () => {
    const data = await (await handler(req('operational-status'))).json();
    assert.equal(data.status.services.wsaa.status, 'ok');
  });
});
test('AUDIT: errores de FEParamGetPtosVenta impiden informar OPERATIVO', async () => {
  await withMockedHandler({ pointsErrors: true }, async () => {
    const data = await (await handler(req('operational-status'))).json();
    assert.equal(data.status.operational, false);
  });
});
test('AUDIT: operational-status no serializa secretos reflejados por un SOAP Fault', async () => {
  await withMockedHandler({echoFault:true}, async () => {
    const data = await (await handler(req('operational-status'))).json();
    assert.equal(JSON.stringify(data).includes('SYNTHETIC_REMOTE_SECRET'),false);
  });
});
