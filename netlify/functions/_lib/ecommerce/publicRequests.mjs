import { createHash } from "node:crypto";
import { adminRunTransaction } from "../firestoreAdminRest.mjs";
import { commerceError } from "./commerceDomain.mjs";
export async function publicCommerceBody(request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > 65536)
    throw commerceError(
      "ecommerce-request-too-large",
      "El pedido supera el tamaño permitido.",
      413,
    );
  try {
    return JSON.parse(text);
  } catch {
    throw commerceError(
      "ecommerce-json-invalid",
      "El pedido no tiene formato válido.",
      400,
    );
  }
}
export async function limitCommerceRequest(
  request,
  context = {},
  {
    env = process.env,
    now = new Date(),
    runTransaction = adminRunTransaction,
  } = {},
) {
  const bucket = Math.floor(now.valueOf() / 60000),
    ip =
      context.ip ||
      request.headers.get("x-nf-client-connection-ip") ||
      "unknown";
  const path = `ecommerceRateLimits/${createHash("sha256").update(`${ip}:${bucket}`).digest("hex")}`;
  await runTransaction(
    async (transaction) => {
      const row = await transaction.getDocument(path);
      if ((row?.data.count || 0) >= 15)
        throw commerceError(
          "ecommerce-rate-limit",
          "Demasiados intentos. Esperá un minuto.",
          429,
        );
      await transaction.commitDocuments([
        {
          type: row ? "update" : "create",
          path,
          data: {
            count: (row?.data.count || 0) + 1,
            expiresAt: new Date(now.valueOf() + 120000),
          },
        },
      ]);
    },
    { env },
  );
}
