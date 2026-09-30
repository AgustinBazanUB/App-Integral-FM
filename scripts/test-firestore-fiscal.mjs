import { spawnSync } from "node:child_process";
// Argument array preserves the | pattern on PowerShell, cmd, Bash and CI.
const result = spawnSync(process.execPath, ["--test", "--test-name-pattern=facturas fiscales|caché WSAA|espejo fiscal", "tests/firestore.rules.mjs"], { stdio: "inherit" });
process.exit(result.status ?? 1);
