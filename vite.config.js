import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const surfaceByMode = {
  gestion: {
    outDir: "dist/gestion",
    title: "Gestión integral | Flor Mía",
    description: "Panel privado de gestión integral de Flor Mía.",
    manifest: "/manifest.gestion.webmanifest",
  },
  ecommerce: {
    outDir: "dist/ecommerce",
    title: "Flor Mía | Productos Regionales de Mendoza",
    description: "Tienda online de productos regionales seleccionados de Mendoza.",
    manifest: "/manifest.ecommerce.webmanifest",
  },
};

function surfaceHtml(surface) {
  return {
    name: "flor-mia-surface-html",
    transformIndexHtml(html) {
      if (!surface) return html;
      return html
        .replace(/<title>.*?<\/title>/s, `<title>${surface.title}</title>`)
        .replace(/href="\/manifest\.webmanifest"/, `href="${surface.manifest}"`)
        .replace(
          /<meta\s+name="description"\s+content="[^"]*"\s*\/>/s,
          `<meta name="description" content="${surface.description}" />`,
        );
    },
  };
}

export default defineConfig(({ mode }) => {
  const surface = surfaceByMode[mode];
  const surfaceEntry = mode === "gestion"
    ? "./src/surfaces/ManagementSurface.jsx"
    : mode === "ecommerce"
      ? "./src/surfaces/EcommerceSurface.jsx"
      : "./src/surfaces/UnifiedSurface.jsx";
  return {
    plugins: [react(), surfaceHtml(surface)],
    resolve: {
      alias: {
        "@flormia/surface": fileURLToPath(new URL(surfaceEntry, import.meta.url)),
      },
    },
    build: {
      target: "es2020",
      cssCodeSplit: true,
      outDir: surface?.outDir || "dist",
    },
  };
});
