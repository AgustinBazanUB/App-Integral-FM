import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const backendPort = Number(process.argv[2] || 8888);
const port = Number(process.argv[3] || 5174);
if (![backendPort, port].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error("Puerto local inválido.");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
  server: { host: "127.0.0.1", port, strictPort: true,
    proxy: { "/.netlify/functions": { target: `http://localhost:${backendPort}`, changeOrigin: true } } },
});
await server.listen(); server.printUrls();
