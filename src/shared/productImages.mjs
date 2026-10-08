export const PRODUCT_IMAGE_PLACEHOLDER = "/images/flor-mia/logo-flor-mia.svg";
export function resolveProductImages(master, local = {}) {
  const source = master && (Object.hasOwn(master, "imageUrl") || Object.hasOwn(master, "thumbUrl")) ? master : local;
  return { imageUrl: String(source.imageUrl || "").trim(), thumbUrl: String(source.thumbUrl || "").trim() };
}
export function productImageSources(product = {}) {
  return [...new Set([product.thumbUrl, product.imageUrl, PRODUCT_IMAGE_PLACEHOLDER].filter(value => typeof value === "string" && value.trim()).map(value => value.trim()))];
}
