import net from "node:net";
let attempts = 0;
function deny() { attempts++; throw new Error("ARCA_TEST_NO_OUTBOUND_NETWORK"); }
net.Socket.prototype.connect = deny;
globalThis.fetch = async () => deny();
process.on("exit", () => {
  if (attempts) {
    process.stderr.write(`Prueba intentó ${attempts} conexiones reales bloqueadas.\n`);
    process.exitCode = 1;
  }
});
