import { adminGetDocument } from "./_lib/firestoreAdminRest.mjs";
import { assertFirebaseServiceAccountProject, configuredFirebaseProjectId, STAGING_FIREBASE_PROJECT_ID } from "./_lib/firebaseProject.mjs";

const previewHost = /^deploy-preview-[0-9]+--appintegralflormia\.netlify\.app$/;
const reply = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Read-only proof of the Functions context before running a write in a preview.
export default async function handler(request) {
  if (request.method !== "GET" || !previewHost.test(new URL(request.url).hostname)) {
    return reply(404, { ok: false });
  }
  let check = "project";
  const failed = () => reply(503, { ok: false, check });
  try {
    const env = process.env;
    if (configuredFirebaseProjectId(env) !== STAGING_FIREBASE_PROJECT_ID) return failed();
    check = "credential-format";
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || env.FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM || "{}");
    check = "credential-project";
    if (account.project_id && account.project_id !== STAGING_FIREBASE_PROJECT_ID) return failed();
    check = "credential-identity";
    assertFirebaseServiceAccountProject(STAGING_FIREBASE_PROJECT_ID, env.FIREBASE_ADMIN_CLIENT_EMAIL || account.client_email);
    check = "authentication";
    const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY || "")}`, {
      signal: AbortSignal.timeout(5000),
    });
    const identity = auth.ok ? await auth.json() : null;
    if (String(identity?.projectId) !== "545036860675" || !identity.authorizedDomains?.includes(`${STAGING_FIREBASE_PROJECT_ID}.firebaseapp.com`)) {
      return failed();
    }
    check = "firestore";
    await adminGetDocument("settings/previewFirebaseStatus", { env });
    return reply(200, { ok: true, projectId: STAGING_FIREBASE_PROJECT_ID, authentication: true, firestore: true });
  } catch {
    return failed();
  }
}
