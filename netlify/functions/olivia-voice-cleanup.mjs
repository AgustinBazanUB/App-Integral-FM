import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { hangupCall } from "./_lib/olivia/voice.mjs";
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
        await store.commit([
          {
            type: "update",
            path: `oliviaRealtime/${session.id}`,
            data: { status: "closed", closedAt: now },
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
