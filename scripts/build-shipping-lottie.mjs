import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DotLottieBuilder } from "@lottiefiles/dotlottie-io";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const riderPath = resolve(root, "src/gestion/shipping/assets/delivery-rider.png");
const outputPath = resolve(root, "public/animations/flor-mia-delivery-rider.lottie");
const rider = readFileSync(riderPath);
const dimensions = readPngDimensions(rider);
const imageData = `data:image/png;base64,${rider.toString("base64")}`;

function keyframe(time, start, end) {
  return { t: time, s: start, e: end, o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] }, h: 0 };
}

function animation(name, amplitude, tilt, duration) {
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const midpoint = duration / 2;
  return {
    v: "5.12.2",
    fr: 30,
    ip: 0,
    op: duration,
    w: dimensions.width,
    h: dimensions.height,
    nm: name,
    ddd: 0,
    assets: [{ id: "flor-mia-delivery-rider", w: dimensions.width, h: dimensions.height, u: "", p: imageData, e: 1 }],
    layers: [{
      ddd: 0,
      ind: 1,
      ty: 2,
      nm: "Repartidora Flor Mía",
      refId: "flor-mia-delivery-rider",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 1, k: [keyframe(0, [0], [tilt]), keyframe(midpoint, [tilt], [0])] },
        p: { a: 1, k: [keyframe(0, [centerX, centerY, 0], [centerX, centerY - amplitude, 0]), keyframe(midpoint, [centerX, centerY - amplitude, 0], [centerX, centerY, 0])] },
        a: { a: 0, k: [centerX, centerY, 0] },
        s: { a: 0, k: [100, 100, 100] },
      },
      ao: 0,
      ip: 0,
      op: duration,
      st: 0,
      bm: 0,
    }],
    markers: [{ tm: 0, cm: "reparto-en-bucle", dr: duration }],
  };
}

const builder = new DotLottieBuilder();
builder.version("2");
builder.generator("Flor Mía · Seguimiento de envíos");
builder.initialAnimation("rider");
builder.addAnimation("rider", Buffer.from(JSON.stringify(animation("Repartidor Flor Mía", 38, 1.5, 60))));
const packaged = builder.build();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, packaged.toBytes());
console.log(JSON.stringify({ output: outputPath, bytes: readFileSync(outputPath).byteLength, animations: packaged.animationIds(), images: packaged.imageFilenames() }));

function readPngDimensions(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("El arte del repartidor debe ser un PNG.");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
