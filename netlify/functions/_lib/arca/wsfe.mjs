import { loadArcaPublicConfig } from "./config.mjs";
import { escapeXml, soapRequest, xmlTag, xmlTags } from "./xml.mjs";
import { requestAccessTicket } from "./wsaa.mjs";

const NS = "http://ar.gov.afip.dif.FEV1/";

function envelope(operation, payload) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS}">`,
    "<soapenv:Header/>",
    "<soapenv:Body>",
    `<ar:${operation}>${payload}</ar:${operation}>`,
    "</soapenv:Body>",
    "</soapenv:Envelope>",
  ].join("");
}

function authXml({ token, sign, issuerCuit }) {
  return [
    "<ar:Auth>",
    `<ar:Token>${escapeXml(token)}</ar:Token>`,
    `<ar:Sign>${escapeXml(sign)}</ar:Sign>`,
    `<ar:Cuit>${issuerCuit}</ar:Cuit>`,
    "</ar:Auth>",
  ].join("");
}

function parseErrors(xml) {
  const blocks = xmlTags(xml, "Err");
  return blocks.map((block) => ({
    code: Number(xmlTag(block, "Code") || 0),
    message: xmlTag(block, "Msg") || "Error ARCA",
  }));
}

function parseEvents(xml) {
  const blocks = xmlTags(xml, "Evt");
  return blocks.map((block) => ({
    code: Number(xmlTag(block, "Code") || 0),
    message: xmlTag(block, "Msg") || "Evento ARCA",
  }));
}

async function wsfeCall(operation, payloadBuilder, {
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const config = loadArcaPublicConfig(env);
  const ticket = await requestAccessTicket("wsfe", { env, fetchImpl });
  const body = envelope(operation, `${authXml({ ...ticket, issuerCuit: config.issuerCuit })}${payloadBuilder(config)}`);
  const xml = await soapRequest({
    url: config.wsfeUrl,
    action: `${NS}${operation}`,
    body,
    timeoutMs: 25000,
    fetchImpl,
  });
  return { xml, errors: parseErrors(xml), events: parseEvents(xml), config };
}

export async function wsfeDummy({ env = process.env, fetchImpl = fetch } = {}) {
  const config = loadArcaPublicConfig(env, { requirePointOfSale: false });
  const xml = await soapRequest({
    url: config.wsfeUrl,
    action: `${NS}FEDummy`,
    body: envelope("FEDummy", ""),
    timeoutMs: 15000,
    fetchImpl,
  });
  return {
    appServer: xmlTag(xml, "AppServer"),
    dbServer: xmlTag(xml, "DbServer"),
    authServer: xmlTag(xml, "AuthServer"),
  };
}

export async function getPointsOfSale(options = {}) {
  const result = await wsfeCall("FEParamGetPtosVenta", () => "", options);
  const blocks = xmlTags(result.xml, "PtoVenta");
  return {
    points: blocks.map((block) => ({
      number: Number(xmlTag(block, "Nro") || 0),
      emissionType: xmlTag(block, "EmisionTipo") || null,
      blocked: xmlTag(block, "Bloqueado") || null,
      dropDate: xmlTag(block, "FchBaja") || null,
    })).filter((point) => point.number > 0),
    errors: result.errors,
    events: result.events,
  };
}

export async function getLastAuthorized({ voucherType, pointOfSale, ...options }) {
  const result = await wsfeCall("FECompUltimoAutorizado", (config) => {
    const ptoVta = Number(pointOfSale || config.pointOfSale);
    return `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${Number(voucherType)}</ar:CbteTipo>`;
  }, options);
  return {
    pointOfSale: Number(xmlTag(result.xml, "PtoVta") || pointOfSale || result.config.pointOfSale),
    voucherType: Number(xmlTag(result.xml, "CbteTipo") || voucherType),
    number: Number(xmlTag(result.xml, "CbteNro") || 0),
    errors: result.errors,
    events: result.events,
  };
}

export async function getReceiverVatConditions({ voucherClass = "", ...options } = {}) {
  const normalizedClass = String(voucherClass || "").trim().toUpperCase();
  if (normalizedClass && !["A", "ALEY", "B", "C", "49"].includes(normalizedClass)) {
    throw new Error("Clase de comprobante inválida.");
  }
  const result = await wsfeCall(
    "FEParamGetCondicionIvaReceptor",
    () => normalizedClass ? `<ar:ClaseCmp>${escapeXml(normalizedClass)}</ar:ClaseCmp>` : "",
    options,
  );
  const blocks = xmlTags(result.xml, "CondicionIvaReceptor");
  return {
    conditions: blocks.map((block) => ({
      id: Number(xmlTag(block, "Id") || 0),
      description: xmlTag(block, "Desc") || "",
      voucherClasses: xmlTags(block, "Cmp_Clase"),
    })).filter((item) => item.id > 0),
    errors: result.errors,
    events: result.events,
  };
}

function requiredInteger(value, label, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new Error(`${label} inválido.`);
  return number;
}

function amount(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} inválido.`);
  return number.toFixed(2);
}

export function buildCaeDetail(detail) {
  const docType = requiredInteger(detail.docType, "Tipo de documento");
  const docNumber = String(detail.docNumber ?? "").replace(/\D/g, "") || "0";
  const from = requiredInteger(detail.voucherFrom, "Número desde", { min: 1 });
  const to = requiredInteger(detail.voucherTo ?? from, "Número hasta", { min: from });
  const date = String(detail.voucherDate || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(date)) throw new Error("Fecha de comprobante inválida.");
  const currency = String(detail.currencyId || "PES").trim();
  const quote = Number(detail.currencyQuote ?? 1);
  if (!Number.isFinite(quote) || quote <= 0) throw new Error("Cotización de moneda inválida.");
  const receiverVatConditionId = requiredInteger(detail.receiverVatConditionId, "Condición IVA del receptor", { min: 1 });

  const fields = [
    `<ar:Concepto>${requiredInteger(detail.concept, "Concepto", { min: 1 })}</ar:Concepto>`,
    `<ar:DocTipo>${docType}</ar:DocTipo>`,
    `<ar:DocNro>${docNumber}</ar:DocNro>`,
    `<ar:CbteDesde>${from}</ar:CbteDesde>`,
    `<ar:CbteHasta>${to}</ar:CbteHasta>`,
    `<ar:CbteFch>${date}</ar:CbteFch>`,
    `<ar:ImpTotal>${amount(detail.total, "Total")}</ar:ImpTotal>`,
    `<ar:ImpTotConc>${amount(detail.nonTaxed ?? 0, "No gravado")}</ar:ImpTotConc>`,
    `<ar:ImpNeto>${amount(detail.net ?? 0, "Neto")}</ar:ImpNeto>`,
    `<ar:ImpOpEx>${amount(detail.exempt ?? 0, "Exento")}</ar:ImpOpEx>`,
    `<ar:ImpTrib>${amount(detail.tributes ?? 0, "Tributos")}</ar:ImpTrib>`,
    `<ar:ImpIVA>${amount(detail.vat ?? 0, "IVA")}</ar:ImpIVA>`,
    `<ar:MonId>${escapeXml(currency)}</ar:MonId>`,
    `<ar:MonCotiz>${quote.toFixed(6)}</ar:MonCotiz>`,
    `<ar:CondicionIVAReceptorId>${receiverVatConditionId}</ar:CondicionIVAReceptorId>`,
  ];

  if (Array.isArray(detail.vatBreakdown) && detail.vatBreakdown.length) {
    fields.push("<ar:Iva>" + detail.vatBreakdown.map((item) => [
      "<ar:AlicIva>",
      `<ar:Id>${requiredInteger(item.id, "Alícuota IVA", { min: 1 })}</ar:Id>`,
      `<ar:BaseImp>${amount(item.base, "Base imponible")}</ar:BaseImp>`,
      `<ar:Importe>${amount(item.amount, "Importe IVA")}</ar:Importe>`,
      "</ar:AlicIva>",
    ].join("")).join("") + "</ar:Iva>");
  }
  return `<ar:FECAEDetRequest>${fields.join("")}</ar:FECAEDetRequest>`;
}

export async function requestCae({ voucherType, pointOfSale, details, ...options }) {
  if (!Array.isArray(details) || !details.length) throw new Error("Falta el detalle a autorizar.");
  const result = await wsfeCall("FECAESolicitar", (config) => {
    const ptoVta = requiredInteger(pointOfSale || config.pointOfSale, "Punto de venta", { min: 1 });
    const cbteTipo = requiredInteger(voucherType, "Tipo de comprobante", { min: 1 });
    return [
      "<ar:FeCAEReq>",
      "<ar:FeCabReq>",
      `<ar:CantReg>${details.length}</ar:CantReg>`,
      `<ar:PtoVta>${ptoVta}</ar:PtoVta>`,
      `<ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
      "</ar:FeCabReq>",
      "<ar:FeDetReq>",
      ...details.map(buildCaeDetail),
      "</ar:FeDetReq>",
      "</ar:FeCAEReq>",
    ].join("");
  }, options);
  return {
    result: xmlTag(result.xml, "Resultado") || null,
    cae: xmlTag(result.xml, "CAE") || null,
    caeExpiration: xmlTag(result.xml, "CAEFchVto") || null,
    voucherFrom: Number(xmlTag(result.xml, "CbteDesde") || 0),
    voucherTo: Number(xmlTag(result.xml, "CbteHasta") || 0),
    observations: xmlTags(result.xml, "Obs").map((block) => ({
      code: Number(xmlTag(block, "Code") || 0),
      message: xmlTag(block, "Msg") || "Observación ARCA",
    })),
    errors: result.errors,
    events: result.events,
    rawXml: result.xml,
  };
}

export async function consultVoucher({ voucherType, pointOfSale, voucherNumber, ...options }) {
  const result = await wsfeCall("FECompConsultar", (config) => [
    "<ar:FeCompConsReq>",
    `<ar:CbteTipo>${requiredInteger(voucherType, "Tipo de comprobante", { min: 1 })}</ar:CbteTipo>`,
    `<ar:CbteNro>${requiredInteger(voucherNumber, "Número de comprobante", { min: 1 })}</ar:CbteNro>`,
    `<ar:PtoVta>${requiredInteger(pointOfSale || config.pointOfSale, "Punto de venta", { min: 1 })}</ar:PtoVta>`,
    "</ar:FeCompConsReq>",
  ].join(""), options);
  return {
    result: xmlTag(result.xml, "Resultado") || null,
    cae: xmlTag(result.xml, "CodAutorizacion") || xmlTag(result.xml, "CAE") || null,
    caeExpiration: xmlTag(result.xml, "FchVto") || xmlTag(result.xml, "CAEFchVto") || null,
    voucherNumber: Number(xmlTag(result.xml, "CbteDesde") || voucherNumber),
    errors: result.errors,
    events: result.events,
    rawXml: result.xml,
  };
}


export async function getVatTypes(options = {}) {
  const result = await wsfeCall("FEParamGetTiposIva", () => "", options);
  const blocks = xmlTags(result.xml, "IvaTipo");
  return {
    types: blocks.map((block) => ({
      id: Number(xmlTag(block, "Id") || 0),
      description: xmlTag(block, "Desc") || "",
      validFrom: xmlTag(block, "FchDesde") || null,
      validTo: xmlTag(block, "FchHasta") || null,
    })).filter((item) => item.id > 0),
    errors: result.errors,
    events: result.events,
  };
}

export async function getVoucherTypes(options = {}) {
  const result = await wsfeCall("FEParamGetTiposCbte", () => "", options);
  const blocks = xmlTags(result.xml, "CbteTipo");
  return {
    types: blocks.map((block) => ({
      id: Number(xmlTag(block, "Id") || 0),
      description: xmlTag(block, "Desc") || "",
      validFrom: xmlTag(block, "FchDesde") || null,
      validTo: xmlTag(block, "FchHasta") || null,
    })).filter((item) => item.id > 0),
    errors: result.errors,
    events: result.events,
  };
}
