import { rm, writeFile } from "node:fs/promises";

const output = new URL("../../dist/ecommerce/", import.meta.url);

// Este sitio es un preview público. El sitemap heredado apunta a otro dominio.
await Promise.all([
  rm(new URL("sitemap.xml", output), { force: true }),
  writeFile(new URL("robots.txt", output), "User-agent: *\nDisallow: /\n"),
]);

// Netlify proxies only these public contracts. Private Functions and their
// credentials remain on the management backend. Preview must name its backend.
const backend = process.env.ECOMMERCE_BACKEND_URL;
if (backend) {
  const url = new URL(backend);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".netlify.app") || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("ECOMMERCE_BACKEND_URL debe ser el origen HTTPS de Netlify autorizado.");
  if (process.env.CONTEXT === "deploy-preview" && !url.hostname.startsWith("deploy-preview-")) throw new Error("El e-commerce de pruebas requiere un backend Deploy Preview aislado.");
  const names = ["ecommerce-catalog", "ecommerce-checkout", "ecommerce-order-status"];
  await writeFile(new URL("_redirects", output), names.map(name => `/api/ecommerce/${name.slice("ecommerce-".length)} ${url.origin}/.netlify/functions/${name} 200!`).join("\n") + "\n/* /index.html 200\n");
} else if (process.env.NETLIFY === "true") {
  throw new Error("Falta ECOMMERCE_BACKEND_URL: no se puede publicar una tienda sin backend público.");
}
