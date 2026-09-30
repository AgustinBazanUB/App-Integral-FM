import { createPrivateKey, sign as cryptoSign, X509Certificate } from "node:crypto";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_SHA1 = "1.3.14.3.2.26";
const OID_RSA_ENCRYPTION = "1.2.840.113549.1.1.1";

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, ...contents) {
  const content = Buffer.concat(contents.flat().map((item) => Buffer.from(item)));
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

const derSequence = (...items) => der(0x30, ...items);
const derSet = (...items) => der(0x31, ...items);
const derInteger = (value) => {
  if (Buffer.isBuffer(value)) return der(0x02, value);
  let number = BigInt(value);
  const bytes = [];
  do {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  } while (number > 0n);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return der(0x02, Buffer.from(bytes));
};
const derNull = () => der(0x05, Buffer.alloc(0));
const derOctetString = (value) => der(0x04, Buffer.from(value));

function oidBytes(oid) {
  const parts = oid.split(".").map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`OID inválido: ${oid}`);
  }
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    let value = part;
    const encoded = [value & 0x7f];
    value >>>= 7;
    while (value > 0) {
      encoded.unshift(0x80 | (value & 0x7f));
      value >>>= 7;
    }
    bytes.push(...encoded);
  }
  return Buffer.from(bytes);
}

const derOid = (oid) => der(0x06, oidBytes(oid));
const algorithmIdentifier = (oid) => derSequence(derOid(oid), derNull());

function pemBody(pem, label) {
  const regex = new RegExp(`-----BEGIN ${label}-----([\\s\\S]+?)-----END ${label}-----`);
  const match = regex.exec(String(pem || ""));
  if (!match) throw new Error(`No se encontró ${label} válido.`);
  return Buffer.from(match[1].replace(/\s+/g, ""), "base64");
}

function readElement(buffer, offset = 0) {
  if (offset >= buffer.length) throw new Error("DER incompleto.");
  const start = offset;
  const tag = buffer[offset++];
  if (offset >= buffer.length) throw new Error("DER sin longitud.");
  let lengthByte = buffer[offset++];
  let length;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const count = lengthByte & 0x7f;
    if (!count || count > 4 || offset + count > buffer.length) throw new Error("Longitud DER inválida.");
    length = 0;
    for (let i = 0; i < count; i += 1) length = (length << 8) | buffer[offset++];
  }
  const valueStart = offset;
  const end = valueStart + length;
  if (end > buffer.length) throw new Error("DER truncado.");
  return {
    tag,
    start,
    valueStart,
    end,
    value: buffer.subarray(valueStart, end),
    raw: buffer.subarray(start, end),
  };
}

function children(element) {
  const result = [];
  let offset = 0;
  while (offset < element.value.length) {
    const child = readElement(element.value, offset);
    result.push(child);
    offset = child.end;
  }
  return result;
}

function issuerAndSerialFromCertificate(certificateDer) {
  const certificate = readElement(certificateDer);
  if (certificate.tag !== 0x30) throw new Error("Certificado X.509 inválido.");
  const certificateChildren = children(certificate);
  const tbs = certificateChildren[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("TBSCertificate inválido.");
  const tbsChildren = children(tbs);
  let index = tbsChildren[0]?.tag === 0xa0 ? 1 : 0;
  const serial = tbsChildren[index];
  const signature = tbsChildren[index + 1];
  const issuer = tbsChildren[index + 2];
  if (serial?.tag !== 0x02 || signature?.tag !== 0x30 || issuer?.tag !== 0x30) {
    throw new Error("No se pudo extraer emisor y serie del certificado.");
  }
  return { issuer: Buffer.from(issuer.raw), serial: Buffer.from(serial.raw) };
}

export function signCmsBase64(content, { certificatePem, privateKeyPem }) {
  const message = Buffer.from(String(content), "utf8");
  const certificateDer = pemBody(certificatePem, "CERTIFICATE");
  // Valida estructura/fechas de forma temprana; ARCA hará la validación definitiva.
  new X509Certificate(certificatePem);
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = cryptoSign("RSA-SHA1", message, privateKey);
  const { issuer, serial } = issuerAndSerialFromCertificate(certificateDer);

  const signerInfo = derSequence(
    derInteger(1),
    derSequence(issuer, serial),
    algorithmIdentifier(OID_SHA1),
    algorithmIdentifier(OID_RSA_ENCRYPTION),
    derOctetString(signature),
  );

  const signedData = derSequence(
    derInteger(1),
    derSet(algorithmIdentifier(OID_SHA1)),
    derSequence(
      derOid(OID_DATA),
      der(0xa0, derOctetString(message)),
    ),
    // certificates [0] IMPLICIT CertificateSet
    der(0xa0, certificateDer),
    derSet(signerInfo),
  );

  return derSequence(
    derOid(OID_SIGNED_DATA),
    der(0xa0, signedData),
  ).toString("base64");
}

export const __cmsInternals = Object.freeze({ readElement, issuerAndSerialFromCertificate });
