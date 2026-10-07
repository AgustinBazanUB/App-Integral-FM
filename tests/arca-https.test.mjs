import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { soapRequest } from "../netlify/functions/_lib/arca/xml.mjs";

const run = promisify(execFile);
const transportModule = new URL("../netlify/functions/_lib/arca/xml.mjs", import.meta.url).href;
let fixtureDirectory, certificatePath, server, port;
const received = [];

before(async () => {
  fixtureDirectory = await mkdtemp(join(tmpdir(), "arca-https-test-"));
  certificatePath = join(fixtureDirectory, "certificate.pem");
  const keyPath = join(fixtureDirectory, "key.pem");
  const configPath = join(fixtureDirectory, "openssl.cnf");
  await writeFile(configPath, "[req]\ndistinguished_name=req_distinguished_name\n[req_distinguished_name]\n");
  const gitOpenSsl = "C:/Program Files/Git/usr/bin/openssl.exe";
  const openssl = process.platform === "win32" && existsSync(gitOpenSsl) ? gitOpenSsl : "openssl";
  execFileSync(openssl, ["req", "-config", configPath, "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", keyPath, "-out", certificatePath], { stdio: "ignore" });
  server = createServer({
    key: await readFile(keyPath), cert: await readFile(certificatePath),
    minVersion: "TLSv1.2", maxVersion: "TLSv1.2", dhparam: "auto",
    ciphers: "DHE-RSA-AES256-GCM-SHA384:AES256-GCM-SHA384", honorCipherOrder: true,
  }, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received.push({ body: Buffer.concat(chunks).toString(), action: request.headers.soapaction, cipher: request.socket.getCipher().standardName });
    if (request.url === "/timeout") return;
    response.writeHead(200, { "Content-Type": "text/xml" });
    response.end("<FEDummyResult><AppServer>OK</AppServer></FEDummyResult>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
});

async function trustedRequest(host, path = "/", timeoutMs = 1000) {
  const script = `import { soapRequest } from ${JSON.stringify(transportModule)};
    try { const xml = await soapRequest({url: process.argv[1], action: "urn:FEDummy", body: "<FEDummy/>", timeoutMs: Number(process.argv[2])}); console.log(JSON.stringify({xml})); }
    catch(error) { console.log(JSON.stringify({code:error.code,causeCode:error.causeCode})); }`;
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script, `https://${host}:${port}${path}`, String(timeoutMs)], { env: { ...process.env, NODE_EXTRA_CA_CERTS: certificatePath }, timeout: 10000 });
  return JSON.parse(stdout.trim());
}

test("SOAP conserva validación de certificados y no envía datos a un servidor sin confianza", async () => {
  const previousCount = received.length;
  await assert.rejects(soapRequest({ url: `https://localhost:${port}/`, body: "<FEDummy/>" }), (error) => error.code === "arca-network-error" && error.causeCode === "DEPTH_ZERO_SELF_SIGNED_CERT");
  assert.equal(received.length, previousCount);
});

test("SOAP negocia TLS sin DHE y conserva cuerpo y acción con certificado confiable", async () => {
  const result = await trustedRequest("localhost");
  assert.match(result.xml, /<AppServer>OK<\/AppServer>/);
  assert.deepEqual(received.at(-1), { body: "<FEDummy/>", action: "urn:FEDummy", cipher: "TLS_RSA_WITH_AES_256_GCM_SHA384" });
});

test("SOAP conserva verificación del nombre del servidor", async () => {
  const previousCount = received.length;
  const result = await trustedRequest("127.0.0.1");
  assert.equal(result.code, "arca-network-error");
  assert.equal(result.causeCode, "ERR_TLS_CERT_ALTNAME_INVALID");
  assert.equal(received.length, previousCount);
});

test("SOAP aborta la espera y mantiene la clasificación de timeout", async () => {
  const result = await trustedRequest("localhost", "/timeout", 100);
  assert.equal(result.code, "arca-timeout");
});
