const XML_ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });

export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function decodeXml(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    }
    return XML_ENTITIES[entity.toLowerCase()] ?? _;
  });
}

function tagPattern(tagName) {
  const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escaped}>`, "i");
}

export function xmlTag(xml, tagName, { required = false } = {}) {
  const match = tagPattern(tagName).exec(String(xml ?? ""));
  if (!match) {
    if (!required) return null;
    const error = new Error(`La respuesta XML no contiene ${tagName}.`);
    error.code = "arca-xml-missing-tag";
    error.tagName = tagName;
    throw error;
  }
  return decodeXml(match[1].trim());
}

export function xmlTags(xml, tagName) {
  const source = String(xml ?? "");
  const escaped = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_.-]+:)?${escaped}>`, "gi");
  return [...source.matchAll(regex)].map((match) => decodeXml(match[1].trim()));
}

export function soapFault(xml) {
  const fault = xmlTag(xml, "Fault");
  if (!fault) return null;
  return {
    code: xmlTag(fault, "faultcode") || xmlTag(fault, "Code") || "SOAP-FAULT",
    message: xmlTag(fault, "faultstring") || xmlTag(fault, "Reason") || "ARCA devolvió un error SOAP.",
    detail: xmlTag(fault, "detail") || null,
  };
}

export async function soapRequest({ url, action = "", body, timeoutMs = 20000, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: action,
        Accept: "text/xml, application/xml",
      },
      body,
      signal: controller.signal,
    });
    const text = await response.text();
    const fault = soapFault(text);
    if (!response.ok || fault) {
      const error = new Error(fault?.message || `ARCA respondió HTTP ${response.status}.`);
      error.code = fault?.code || "arca-soap-http-error";
      error.status = response.status;
      error.detail = fault?.detail || null;
      throw error;
    }
    return text;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("ARCA tardó demasiado en responder.");
      timeoutError.code = "arca-timeout";
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
