import { products } from "./products";

const placeholder = {
  id: "product-placeholder",
  name: "Imagen pendiente",
  imageUrl: "/images/flor-mia/logo-flor-mia.svg",
  thumbUrl: "/images/flor-mia/logo-flor-mia.svg",
  categoryId: "",
  alt: "Producto Flor Mía con imagen pendiente",
  status: "pending",
  originalFileName: "logo-flor-mia.svg",
};

const catalogByPath = new Map();
for (const product of products) {
  if (!product.image || catalogByPath.has(product.image)) continue;
  const originalFileName = product.image.split("/").pop() || "producto.webp";
  catalogByPath.set(product.image, {
    id: `catalog-${originalFileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    name: product.name,
    imageUrl: product.image,
    thumbUrl: product.image,
    categoryId: product.categoryId || "",
    alt: product.imageAlt || product.name,
    status: product.imageAlt?.includes("pendiente") ? "editorial" : "available",
    originalFileName,
  });
}

export const productImages = [placeholder, ...catalogByPath.values()];

export const productImageById = Object.fromEntries(
  productImages.map((image) => [image.id, image]),
);

export function findProductImage(imageId) {
  return productImageById[imageId] || placeholder;
}
