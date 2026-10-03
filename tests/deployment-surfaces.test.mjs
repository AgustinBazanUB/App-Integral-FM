import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("gestión y e-commerce tienen builds independientes sin romper el build unificado", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts.build, "vite build");
  assert.equal(packageJson.scripts["build:gestion"], "vite build --mode gestion");
  assert.equal(packageJson.scripts["build:ecommerce"], "vite build --mode ecommerce");

  const viteConfig = await read("vite.config.js");
  assert.match(viteConfig, /dist\/gestion/);
  assert.match(viteConfig, /dist\/ecommerce/);
});

test("cada modo fija una única superficie y sólo el e-commerce es público", async () => {
  const [gestionEnv, ecommerceEnv, viteConfig, storefrontSource, mainSource, serviceWorker, footerSource] = await Promise.all([
    read(".env.gestion"),
    read(".env.ecommerce"),
    read("vite.config.js"),
    read("src/Storefront.jsx"),
    read("src/main.jsx"),
    read("public/service-worker.js"),
    read("src/components/Footer.jsx"),
  ]);

  assert.match(gestionEnv, /VITE_APP_SURFACE=gestion/);
  assert.match(gestionEnv, /VITE_STOREFRONT_PUBLIC=false/);
  assert.match(ecommerceEnv, /VITE_APP_SURFACE=ecommerce/);
  assert.match(ecommerceEnv, /VITE_STOREFRONT_PUBLIC=true/);
  assert.match(viteConfig, /ManagementSurface\.jsx/);
  assert.match(viteConfig, /EcommerceSurface\.jsx/);
  assert.match(mainSource, /@flormia\/surface/);
  assert.match(mainSource, /service-worker\.js\?surface=\$\{surface\}/);
  assert.match(storefrontSource, /VITE_STOREFRONT_PUBLIC === "true"/);
  assert.match(storefrontSource, /<Route path="\/" element=\{<HomePage \/>\}/);
  assert.match(serviceWorker, /APP_SHELL_BY_SURFACE/);
  assert.match(serviceWorker, /manifest\.gestion\.webmanifest/);
  assert.match(serviceWorker, /manifest\.ecommerce\.webmanifest/);
  assert.match(footerSource, /VITE_MANAGEMENT_URL/);
  assert.match(footerSource, /VITE_STOREFRONT_PUBLIC === "true" \? "" : "\/gestion"/);
});

