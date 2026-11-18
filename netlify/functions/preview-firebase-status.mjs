import { adminListDocuments } from "./_lib/firestoreAdminRest.mjs";
import { configuredFirebaseProjectId, STAGING_FIREBASE_PROJECT_ID } from "./_lib/firebaseProject.mjs";

const previewHost = /^deploy-preview-[0-9]+--appintegralflormia\.netlify\.app$/;
const stagingAccount = `netlify-deploy-preview-staging@${STAGING_FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`;
const reply = (status, body) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Read-only proof of the Functions context before running a write in a preview.
export default async function handler(request) {
  if (request.method !== "GET" || !previewHost.test(new URL(request.url).hostname)) {
    return reply(404, { ok: false });
  }
  try {
    const env = process.env;
    if (configuredFirebaseProjectId(env) !== STAGING_FIREBASE_PROJECT_ID) return reply(503, { ok: false });
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
    if (account.project_id !== STAGING_FIREBASE_PROJECT_ID || (env.FIREBASE_ADMIN_CLIENT_EMAIL || account.client_email) !== stagingAccount) {
      return reply(503, { ok: false });
    }
    const auth = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY || "")}`, {
      signal: AbortSignal.timeout(5000),
    });
    const identity = auth.ok ? await auth.json() : null;
    if (String(identity?.projectId) !== "545036860675" || !identity.authorizedDomains?.includes(`${STAGING_FIREBASE_PROJECT_ID}.firebaseapp.com`)) {
      return reply(503, { ok: false });
    }
    await adminListDocuments("settings", { maxDocuments: 1, env });
    return reply(200, { ok: true, projectId: STAGING_FIREBASE_PROJECT_ID, authentication: true, firestore: true });
  } catch {
    return reply(503, { ok: false });
  }
}
