import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import jsQR from "jsqr";

const require = createRequire(path.resolve(process.env.SHIPPING_QA_NODE_MODULES || "node_modules", "package.json"));
const { PNG } = require("pngjs");
const mm = value => Math.round(value * 300 / 25.4);
const urls = [];
for (let index = 0; index < 6; index++) {
  const page = index < 5 ? 1 : 2;
  const labelY = index < 5 ? 13 + index * 52.76 : 13;
  const png = PNG.sync.read(readFileSync(`tmp/shipping-qa/qr-print-${page}.png`));
  const left = mm(12.5), top = mm(labelY + 14), width = mm(28), height = mm(28);
  assert(left >= 0 && top >= 0 && left + width <= png.width && top + height <= png.height, "the QR crop must stay inside its rendered A4 page");
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * png.width + left) * 4;
    png.data.copy(data, row * width * 4, start, start + width * 4);
  }
  const result = jsQR(new Uint8ClampedArray(data), width, height);
  const expected = `https://flormia.example/e/synthetic_${index + 1}_not_an_authorization`;
  assert.equal(result?.data, expected); urls.push(expected);
}
console.log(JSON.stringify({ decodedFromActualPdfAtDpi: 300, uniqueQrCodes: new Set(urls).size, urls }));
