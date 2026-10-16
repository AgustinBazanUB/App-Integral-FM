import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import jsQR from "jsqr";
const require = createRequire(path.resolve(process.env.SHIPPING_QA_NODE_MODULES || "node_modules", "package.json"));
const sharp = require("sharp");
const mm = value => Math.round(value * 300 / 25.4);
const urls = [];
for (let index = 0; index < 4; index++) {
  const page = index < 3 ? 1 : 2, labelY = 13 + (index < 3 ? index * 85 : 0);
  const { data, info } = await sharp(`tmp/shipping-qa/qr-print-${page}.png`).extract({ left: mm(12.5), top: mm(labelY + 14.6), width: mm(28), height: mm(28) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  const expected = `https://flormia.example/e/synthetic_${index + 1}_not_an_authorization`;
  assert.equal(result?.data, expected); urls.push(expected);
}
console.log(JSON.stringify({ decodedFromActualPdfAtDpi: 300, uniqueQrCodes: new Set(urls).size, urls }));
