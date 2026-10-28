import { request as httpsRequest } from "node:https";
import { DEFAULT_CIPHERS } from "node:tls";

// WSFE currently negotiates an undersized DHE group with Node's default offer.
// Exclude DHE while retaining the default accepted suites, TLS >= 1.2 and
// certificate/hostname verification. Do not lower OpenSSL's security level.
export const WSFE_TLS_OPTIONS = Object.freeze({
  ciphers: `${DEFAULT_CIPHERS}:!DHE`,
  minVersion: "TLSv1.2",
  rejectUnauthorized: true,
});

export function requiresWsfeTransport(url) {
  const parsed = new URL(url);
  return parsed.protocol === "https:" && parsed.hostname === "servicios1.afip.gov.ar"
    && parsed.pathname.toLowerCase() === "/wsfev1/service.asmx";
}

export async function arcaSoapFetch(url, options = {}, requestImpl = httpsRequest) {
  if (!requiresWsfeTransport(url)) return fetch(url, options);
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      ...WSFE_TLS_OPTIONS,
      method: options.method,
      headers: options.headers,
      signal: options.signal,
    }, (response) => {
      const chunks = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("error", reject);
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers,
      })));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}
