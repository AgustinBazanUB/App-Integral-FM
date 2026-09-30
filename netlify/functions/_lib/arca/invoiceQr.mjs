const VERSION = 11;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 324;
const BLOCK_COUNT = 4;
const BLOCK_DATA_CODEWORDS = 81;
const ECC_CODEWORDS_PER_BLOCK = 20;
const ALIGNMENT_POSITIONS = [6, 30, 54];

function appendBits(target, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) target.push(((value >>> i) & 1) !== 0);
}

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomonDivisor(degree) {
  const result = Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.shift();
    result.push(0);
    for (let i = 0; i < result.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }
  return result;
}

function dataCodewords(text) {
  const bytes = [...Buffer.from(text, "utf8")];
  const capacityBits = DATA_CODEWORDS * 8;
  if (bytes.length > 321) {
    const error = new Error("El payload QR fiscal supera la capacidad segura soportada.");
    error.code = "arca-qr-payload-too-large";
    throw error;
  }

  const bits = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 16);
  for (const byte of bytes) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);

  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | Number(bits[i + j]);
    result.push(value);
  }
  for (let pad = 0xec; result.length < DATA_CODEWORDS; pad ^= 0xfd) result.push(pad);
  return result;
}

function allCodewords(text) {
  const data = dataCodewords(text);
  const divisor = reedSolomonDivisor(ECC_CODEWORDS_PER_BLOCK);
  const blocks = [];
  for (let i = 0; i < BLOCK_COUNT; i += 1) {
    const blockData = data.slice(i * BLOCK_DATA_CODEWORDS, (i + 1) * BLOCK_DATA_CODEWORDS);
    blocks.push({ data: blockData, ecc: reedSolomonRemainder(blockData, divisor) });
  }

  const result = [];
  for (let i = 0; i < BLOCK_DATA_CODEWORDS; i += 1) {
    for (const block of blocks) result.push(block.data[i]);
  }
  for (let i = 0; i < ECC_CODEWORDS_PER_BLOCK; i += 1) {
    for (const block of blocks) result.push(block.ecc[i]);
  }
  return result;
}

function bit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function formatBits(mask = 0) {
  const data = (1 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits() {
  let rem = VERSION;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (VERSION << 12) | rem;
}

export function qrMatrix(text) {
  const modules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
  const isFunction = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));

  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = Boolean(dark);
    isFunction[y][x] = true;
  };

  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };

  const drawAlignment = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  for (let i = 0; i < SIZE; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(3, 3);
  drawFinder(SIZE - 4, 3);
  drawFinder(3, SIZE - 4);

  for (let yi = 0; yi < ALIGNMENT_POSITIONS.length; yi += 1) {
    for (let xi = 0; xi < ALIGNMENT_POSITIONS.length; xi += 1) {
      const isFinderOverlap = (xi === 0 && yi === 0)
        || (xi === 0 && yi === ALIGNMENT_POSITIONS.length - 1)
        || (xi === ALIGNMENT_POSITIONS.length - 1 && yi === 0);
      if (!isFinderOverlap) drawAlignment(ALIGNMENT_POSITIONS[xi], ALIGNMENT_POSITIONS[yi]);
    }
  }

  const drawFormat = () => {
    const bits = formatBits(0);
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(bits, i));
    setFunction(8, 7, bit(bits, 6));
    setFunction(8, 8, bit(bits, 7));
    setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i += 1) setFunction(SIZE - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i += 1) setFunction(8, SIZE - 15 + i, bit(bits, i));
    setFunction(8, SIZE - 8, true);
  };
  drawFormat();

  const vbits = versionBits();
  for (let i = 0; i < 18; i += 1) {
    const dark = bit(vbits, i);
    const a = SIZE - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(a, b, dark);
    setFunction(b, a, dark);
  }

  const codewords = allCodewords(text);
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;
    for (let offset = 0; offset < SIZE; offset += 1) {
      const y = upward ? SIZE - 1 - offset : offset;
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (isFunction[y][x]) continue;
        const codeword = codewords[Math.floor(bitIndex / 8)];
        modules[y][x] = codeword == null ? false : bit(codeword, 7 - (bitIndex % 8));
        bitIndex += 1;
      }
    }
    upward = !upward;
  }

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (!isFunction[y][x] && (x + y) % 2 === 0) modules[y][x] = !modules[y][x];
    }
  }
  drawFormat();

  return modules;
}

export function buildArcaQrPayload({
  issueDate,
  issuerCuit,
  pointOfSale,
  voucherType,
  voucherNumber,
  total,
  receiverDocumentType,
  receiverDocumentNumber,
  cae,
} = {}) {
  const json = {
    ver: 1,
    fecha: String(issueDate || ""),
    cuit: Number(String(issuerCuit || "").replace(/\D/g, "")),
    ptoVta: Number(pointOfSale),
    tipoCmp: Number(voucherType),
    nroCmp: Number(voucherNumber),
    importe: Number(total),
    moneda: "PES",
    ctz: 1,
    ...(Number(receiverDocumentType || 0) > 0 ? { tipoDocRec: Number(receiverDocumentType) } : {}),
    ...(String(receiverDocumentNumber || "").replace(/\D/g, "")
      ? { nroDocRec: Number(String(receiverDocumentNumber).replace(/\D/g, "")) }
      : {}),
    tipoCodAut: "E",
    codAut: Number(String(cae || "").replace(/\D/g, "")),
  };
  const requiredNumbers = [json.cuit, json.ptoVta, json.tipoCmp, json.nroCmp, json.importe, json.codAut];
  if (!json.fecha || requiredNumbers.some((value) => !Number.isFinite(value) || value <= 0)) {
    const error = new Error("La factura no tiene todos los datos necesarios para construir el QR fiscal.");
    error.code = "arca-qr-data-incomplete";
    throw error;
  }
  const base64 = Buffer.from(JSON.stringify(json), "utf8").toString("base64");
  return {
    data: json,
    url: `https://www.arca.gob.ar/fe/qr/?p=${base64}`,
  };
}

export const QR_VERSION = VERSION;
export const QR_SIZE = SIZE;
