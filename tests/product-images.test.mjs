import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolveProductImages, productImageSources, PRODUCT_IMAGE_PLACEHOLDER } from "../src/shared/productImages.mjs";
import { joinMasterProducts } from "../src/modules/locations/domain/dashboard.js";

test("a current master image overrides the stale image copied into location stock", () => {
  const [item] = joinMasterProducts([{ id: "jam", name: "Mermelada", imageUrl: "fresh.jpg", thumbUrl: "fresh-small.jpg" }], [{ productId: "jam", imageUrl: "old.jpg", thumbUrl: "old-small.jpg", currentStock: 4 }]);
  assert.equal(item.imageUrl, "fresh.jpg"); assert.equal(item.thumbUrl, "fresh-small.jpg");
  assert.equal(item.currentStock, 4);
});
test("removing an image in the catalog clears stale location images; legacy catalog entries retain their local image", () => {
  const local = { imageUrl: "old.jpg", thumbUrl: "old-small.jpg" };
  assert.deepEqual(resolveProductImages({ imageUrl: "", thumbUrl: "" }, local), { imageUrl: "", thumbUrl: "" });
  assert.deepEqual(resolveProductImages({ id: "legacy" }, local), local);
  assert.deepEqual(productImageSources({ imageUrl: " same.jpg ", thumbUrl: "same.jpg" }), ["same.jpg", PRODUCT_IMAGE_PLACEHOLDER]);
});

const bundle = await build({ entryPoints: ["src/gestion/components/ProductImage.jsx"], bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", plugins: [{ name: "image-render", setup(b) {
  b.onResolve({ filter: /^react$|^react\/jsx-runtime$|\.css$/ }, args => ({ path: args.path, namespace: "qa" }));
  b.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "react" ? "export const useState=value=>globalThis.__imageHooks(value);" : path === "react/jsx-runtime" ? "export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;" : "" }));
} }] });
const { default: ProductImage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
function harness(product, extra = {}) {
  let props = { product, ...extra }, values = [], cursor = 0, key, tree;
  const render = () => {
    const attempt = ProductImage(props);
    if (key !== attempt.key) { values = []; key = attempt.key; }
    cursor = 0;
    globalThis.__imageHooks = initial => { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = typeof next === "function" ? next(values[i]) : next; }]; };
    tree = attempt.type(attempt.props); return tree;
  };
  render();
  return { render, image: () => tree.props.children, title: () => tree.props.title, fail: () => { tree.props.children.props.onError(); render(); }, update: product => { props = { ...props, product }; render(); } };
}
test("a broken thumbnail falls back to the full photo before showing Flor Mía and its explanation", () => {
  const h = harness({ thumbUrl: "broken-small.jpg", imageUrl: "photo.jpg" }, { eager: true });
  assert.equal(h.image().props.src, "broken-small.jpg"); assert.equal(h.image().props.loading, "eager");
  h.fail(); assert.equal(h.image().props.src, "photo.jpg"); assert.equal(h.title(), undefined);
  h.fail(); assert.equal(h.image().props.src, PRODUCT_IMAGE_PLACEHOLDER);
  assert.equal(h.title(), "Falta cargar imagen de este producto");
});
test("missing product photos render the brand immediately, and a missing brand asset still renders text", () => {
  const h = harness({});
  assert.equal(h.image().props.src, PRODUCT_IMAGE_PLACEHOLDER);
  assert.equal(h.title(), "Falta cargar imagen de este producto");
  h.fail(); assert.equal(h.image().type, "span"); assert.equal(h.image().props.children, "Flor Mía");
});
test("a newly uploaded image resets failed attempts on the existing product card", () => {
  const h = harness({ imageUrl: "old.jpg" }); h.fail(); h.fail();
  h.update({ imageUrl: "new.jpg", thumbUrl: "new-small.jpg" });
  assert.equal(h.image().type, "img"); assert.equal(h.image().props.src, "new-small.jpg");
  assert.equal(h.title(), undefined);
});
