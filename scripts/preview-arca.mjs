import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ configFile: false,
  root: fileURLToPath(new URL("../tests/fixtures/arca-ui/", import.meta.url)),
  plugins: [react()], server: { host: "127.0.0.1", port: 5175, strictPort: true, fs: { allow: [root] } },
});
await server.listen(); server.printUrls();
