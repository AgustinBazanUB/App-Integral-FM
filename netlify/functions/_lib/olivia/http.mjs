import { requireFirebaseActiveProfile } from "../firebaseAuth.mjs";
import { assertOliviaAccess } from "./guards.mjs";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
import { publicOliviaFailure } from "./errorReports.mjs";
export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
export async function oliviaSession(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw oliviaError("invalid-origin", "Origen de solicitud inválido.", 403);
  const session = await requireFirebaseActiveProfile(request);
  let claims;
  try {
    claims = JSON.parse(
      Buffer.from(session.idToken.split(".")[1], "base64url").toString("utf8"),
    );
  } catch {
    throw oliviaError("unauthenticated", "Tu sesión no es válida.", 401);
  }
  // accounts:lookup already validated the exact token. These claims bind a confirmation to a login, not a client-provided role.
  if (
    claims.sub !== session.uid ||
    claims.aud !== "app-integral-fm" ||
    !Number.isSafeInteger(claims.auth_time) ||
    claims.auth_time > Date.now() / 1000 + 60
  )
    throw oliviaError("unauthenticated", "Tu sesión no es válida.", 401);
  session.authTime = claims.auth_time;
  assertOliviaAccess(session);
  return session;
}
export function errorResponse(error) {
  const status = error.status >= 400 && error.status < 600 ? error.status : 500;
  return json(
    {
      ...(error.reportId ? publicOliviaFailure(error) : { code: error.code || "assistant-error" }),
      message:
        error.reportId ? publicOliviaFailure(error).message : status < 500
          ? error.message
          : "Olivia no pudo completar la solicitud. Podés continuar manualmente.",
    },
    status,
  );
}
