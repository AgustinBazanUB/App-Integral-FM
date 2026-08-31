import {
  exchangeAuthorizationCode,
  getDriveAbout,
  ensureDriveRootFolder,
  saveDriveConnection,
  storeGoogleDriveSecret,
  googleDriveConfiguration,
  newBackendId,
} from "./_lib/googleDrive.mjs";
import { adminDelete, adminGet, adminSet } from "./_lib/serverFirestore.mjs";

const STATE_TTL_MS = 10 * 60 * 1000;

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function safeReturnUrl(value, fallbackOrigin) {
  try {
    const url = new URL(value || `${fallbackOrigin}/gestion/settings`);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("unsafe");
    url.pathname = "/gestion/settings";
    url.search = "?drive=connected";
    url.hash = "";
    return url.toString();
  } catch {
    return `${fallbackOrigin}/gestion/settings?drive=connected`;
  }
}

async function audit({ uid, userName, action, title, description = "" }) {
  await adminSet(`auditLogs/${newBackendId("audit")}`, {
    action,
    title,
    description,
    moduleId: "marketing",
    entityType: "integration",
    entityId: "googleDrive",
    userId: uid,
    userName: userName || "Usuario",
    status: "completed",
    createdAt: new Date(),
  });
}

export default async function handler(request) {
  const config = googleDriveConfiguration();
  const fallbackOrigin = (() => {
    try { return new URL(config.redirectUri || request.url).origin; } catch { return new URL(request.url).origin; }
  })();
  if (request.method !== "GET") return new Response("Método no permitido.", { status: 405 });
  const url = new URL(request.url);
  const state = String(url.searchParams.get("state") || "").trim();
  const code = String(url.searchParams.get("code") || "").trim();
  const providerError = String(url.searchParams.get("error") || "").trim();
  if (!state) return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_error`);

  let stateRecord;
  try {
    stateRecord = await adminGet(`integrationOauthStates/${state}`, { optional: true });
    if (!stateRecord) return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_state_invalid`);
    const createdAt = stateRecord.createdAt instanceof Date ? stateRecord.createdAt.getTime() : new Date(stateRecord.createdAt || 0).getTime();
    const expiresAt = stateRecord.expiresAt instanceof Date ? stateRecord.expiresAt.getTime() : new Date(stateRecord.expiresAt || 0).getTime();
    if (!createdAt || Date.now() - createdAt > STATE_TTL_MS || !expiresAt || expiresAt < Date.now()) {
      await adminDelete(`integrationOauthStates/${state}`);
      return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_state_expired`);
    }
    await adminDelete(`integrationOauthStates/${state}`);
  } catch {
    return redirect(`${fallbackOrigin}/gestion/settings?drive=oauth_error`);
  }

  const returnUrl = safeReturnUrl(stateRecord.returnUrl, fallbackOrigin);
  if (providerError || !code) {
    const denied = providerError === "access_denied" ? "oauth_cancelled" : "oauth_error";
    return redirect(returnUrl.replace("drive=connected", `drive=${denied}`));
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);
    if (!tokens.refresh_token) {
      return redirect(returnUrl.replace("drive=connected", "drive=refresh_token_missing"));
    }
    await storeGoogleDriveSecret(tokens.refresh_token, { connectedBy: stateRecord.uid });
    const [about, previous] = await Promise.all([
      getDriveAbout(tokens.access_token),
      adminGet("integrationConnections/googleDrive", { optional: true }),
    ]);
    const rootFolder = await ensureDriveRootFolder({ accessToken: tokens.access_token });
    await saveDriveConnection({
      account: about.user || {},
      rootFolder,
      connectedBy: stateRecord.uid,
      previous,
    });
    await audit({
      uid: stateRecord.uid,
      userName: stateRecord.userName,
      action: "metaAds.drive.connected",
      title: "Google Drive conectado",
      description: about.user?.emailAddress ? `Cuenta ${about.user.emailAddress}` : "Cuenta organizacional conectada",
    });
    return redirect(returnUrl);
  } catch (error) {
    console.error("Google Drive OAuth callback failed", { code: error?.code || "drive-oauth-error", status: error?.status || 500 });
    return redirect(returnUrl.replace("drive=connected", `drive=${encodeURIComponent(error?.code || "oauth_error")}`));
  }
}
