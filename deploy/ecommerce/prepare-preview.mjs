import { rm, writeFile } from "node:fs/promises";

const output = new URL("../../dist/ecommerce/", import.meta.url);

// Este sitio es un preview público. El sitemap heredado apunta a otro dominio.
await Promise.all([
  rm(new URL("sitemap.xml", output), { force: true }),
  writeFile(new URL("robots.txt", output), "User-agent: *\nDisallow: /\n"),
]);
