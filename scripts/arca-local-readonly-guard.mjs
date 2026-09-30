// Defense in depth for the local diagnostics launcher. Never installed in production.
import { appendFileSync } from "node:fs";
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const request = input instanceof Request ? input : new Request(input, options);
  const body = request.method === "GET" || request.method === "HEAD" ? "" : await request.clone().text();
  const action = request.headers.get("SOAPAction") || "";
  const event = { method: request.method, host: new URL(request.url).hostname,
    operation: /FECAESolicitar/i.test(action + body) ? "blocked-cae"
      : ["FEDummy", "FEParamGetPtosVenta", "getPersona_v2", "loginCms"].find(value => action.includes(value) || body.includes(`<${value}`) || body.includes(`:${value}>`)) || "other-request" };
  const fiscalWrite = new URL(request.url).hostname === "firestore.googleapis.com"
    && request.method !== "GET" && /(?:invoices|sales|arcaSequenceLocks)\//.test(request.url + body);
  if (/FECAESolicitar/i.test(action + body) || fiscalWrite) {
    if (process.env.ARCA_LOCAL_AUDIT_LOG) appendFileSync(process.env.ARCA_LOCAL_AUDIT_LOG, JSON.stringify({ ...event, blocked: true }) + "\n");
    throw Object.assign(new Error("El lanzador local de diagnóstico bloquea emisión y escrituras fiscales."), { code: "arca-local-readonly", status: 409 });
  }
  if (process.env.ARCA_LOCAL_AUDIT_LOG) appendFileSync(process.env.ARCA_LOCAL_AUDIT_LOG, JSON.stringify({ ...event, blocked: false }) + "\n");
  return originalFetch(input, options);
};
