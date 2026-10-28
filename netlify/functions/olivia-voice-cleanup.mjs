import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { hangupCall } from "./_lib/olivia/voice.mjs";
import { defaultOliviaConfiguration } from "../../src/shared/oliviaContracts.mjs";
import { settleUsage } from "./_lib/olivia/usage.mjs";
export const config = { schedule: "* * * * *" };
export async function closeExpiredVoiceSessions({
  store,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const sessions = await store.query(
    "oliviaRealtime",
    [
      ["status", "EQUAL", "active"],
      ["expiresAt", "LESS_THAN_OR_EQUAL", now],
    ],
    4,
  );
  let closed = 0,
    failed = 0;
  await Promise.all(
    sessions.map(async (session) => {
      try {
        await hangupCall(session.callId, { env, fetchImpl });
        if (session.reservation?.requestPath && session.reservation?.budgetPath) {
          const profile = await store.get(`users/${session.userId}`);
          await settleUsage({
            store,
            session: { uid: session.userId, profile: { ...profile, role: profile?.role || "seller" } },
            reservation: session.reservation,
            event: { model: session.model || "retired-voice-session", billingUnit: "legacy-voice-session", totalTokens: session.reservation.reservedTokens, measurement: "unconfirmed", finalization: "retired" },
            configuration: { ...defaultOliviaConfiguration(env), ...(session.billingConfig || {}) },
            errorCode: "voice-mode-retired",
            now,
          });
        }
        await store.commit([
          {
            type: "update",
            path: `oliviaRealtime/${session.id}`,
            data: { status: "closed", closedAt: now, meteringStatus: "settled", finalization: "retired" },
          },
        ]);
        closed++;
      } catch {
        failed++;
      }
    }),
  );
  return { closed, failed };
}
export default async function handler() {
  try {
    const result = await closeExpiredVoiceSessions({
      store: createOliviaStore(),
    });
    return new Response(JSON.stringify(result), { status: 200 });
  } catch (error) {
    console.error("olivia.voice_cleanup_failed", {
      code: error.code || "cleanup-error",
    });
    return new Response("Voice cleanup failed", { status: 500 });
  }
}
