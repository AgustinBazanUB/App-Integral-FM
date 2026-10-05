import { createOliviaStore } from "./_lib/olivia/store.mjs";
import { retentionDate } from "../../src/shared/oliviaContracts.mjs";

// Netlify invokes this through the scheduler, not a public URL. @hourly is UTC.
// https://docs.netlify.com/build/functions/scheduled-functions/
export const config = { schedule: "@hourly" };
const MAX_BATCH = 12;
const DEFAULT_BATCH = 8;
const OPERATIONS = new Set([
  "chat",
  "text",
  "transcription",
  "realtime",
  "live",
  "sale",
  "stock_load",
  "observation",
]);
const INPUT_MODES = new Set(["text", "audio", "transcription", "realtime"]);
const milliseconds = (value) =>
  value instanceof Date ? value.getTime() : new Date(value).getTime();
const expired = (value, now) =>
  value != null &&
  Number.isFinite(milliseconds(value)) &&
  milliseconds(value) <= now.getTime();
const counter = (value) =>
  Number.isFinite(Number(value))
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value))))
    : 0;
const documentId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  !/[\/\x00-\x1f]/.test(value);
const category = (value) => (OPERATIONS.has(value) ? value : "unknown");
function counts() {
  return {
    conversationsRemoved: 0,
    messagesRemoved: 0,
    confirmationsRemoved: 0,
    requestsRecovered: 0,
    requestsRemoved: 0,
    usageEventsRemoved: 0,
    voiceSessionsRemoved: 0,
    budgetsRemoved: 0,
    quotaRequestsRemoved: 0,
    estimatedTokensCharged: 0,
    missingBudgetRecords: 0,
  };
}
function emptyAggregate(day) {
  return {
    schemaVersion: 1,
    day,
    counts: counts(),
    inputModes: {},
    operations: {},
    tokens: { input: 0, output: 0, total: 0 },
  };
}
function addCount(bucket, name, value = 1) {
  bucket[name] = Math.min(
    Number.MAX_SAFE_INTEGER,
    counter(bucket[name]) + counter(value),
  );
}
function cleanAggregate(data, day) {
  const result = emptyAggregate(day);
  for (const key of Object.keys(result.counts))
    result.counts[key] = counter(data?.counts?.[key]);
  for (const mode of [...INPUT_MODES, "unknown"])
    if (data?.inputModes?.[mode])
      result.inputModes[mode] = counter(data.inputModes[mode]);
  for (const operation of [...OPERATIONS, "unknown"])
    if (data?.operations?.[operation])
      result.operations[operation] = counter(data.operations[operation]);
  for (const key of ["input", "output", "total"])
    result.tokens[key] = counter(data?.tokens?.[key]);
  return result;
}
function mergeAggregate(previous, delta, day) {
  const result = cleanAggregate(previous, day);
  for (const key of Object.keys(result.counts))
    addCount(result.counts, key, delta.counts[key]);
  for (const [key, value] of Object.entries(delta.inputModes))
    addCount(result.inputModes, key, value);
  for (const [key, value] of Object.entries(delta.operations))
    addCount(result.operations, key, value);
  for (const key of ["input", "output", "total"])
    addCount(result.tokens, key, delta.tokens[key]);
  return result;
}
async function appendAggregate(tx, delta, now, writes) {
  const day = now.toISOString().slice(0, 10);
  const path = `oliviaAnonymousUsage/${day}`;
  const existing = await tx.getDocument(path);
  const data = mergeAggregate(existing?.data, delta, day);
  // Fixed day/category totals only. Never retain user/conversation/request IDs,
  // hashes, session bindings, raw text, draft fields or individual row records.
  writes.push({
    type: existing ? "update" : "create",
    path,
    data,
    ...(existing
      ? {
          updateMask: [
            ...new Set([...Object.keys(existing.data), ...Object.keys(data)]),
          ],
        }
      : {}),
  });
}
function remove(path, snapshot) {
  return {
    type: "delete",
    path,
    ...(snapshot?.updateTime ? { currentUpdateTime: snapshot.updateTime } : {}),
  };
}
async function snapshots(tx, collection, candidates) {
  return Promise.all(
    candidates
      .filter((row) => documentId(row.id))
      .map(async (row) => ({
        id: row.id,
        path: `${collection}/${row.id}`,
        snapshot: await tx.getDocument(`${collection}/${row.id}`),
      })),
  );
}
function addMessageMetrics(aggregate, messages) {
  for (const message of Array.isArray(messages) ? messages : []) {
    addCount(aggregate.counts, "messagesRemoved");
    if (message?.role === "user") {
      const mode = INPUT_MODES.has(message.inputMode)
        ? message.inputMode
        : "unknown";
      addCount(aggregate.inputModes, mode);
    }
  }
}
async function purgeConversations(store, rows, now, hasTime = () => true) {
  if (!rows.length) return counts();
  const candidates = rows.filter((row) => documentId(row.id));
  // One bounded page per parent. No createdAt ordering: a legacy child without
  // that timestamp must also be erased rather than silently orphaned.
  const pages = new Map(
    await Promise.all(
      candidates.map(async (row) => [
        row.id,
        await store.query(
          `oliviaConversations/${row.id}/messages`,
          [],
          MAX_BATCH,
          [],
        ),
      ]),
    ),
  );
  if (!hasTime()) return { ...counts(), possibleBacklog: true };

  const first = await store.transaction(async (tx) => {
    const current = await snapshots(tx, "oliviaConversations", candidates);
    const expiredRows = current.filter(
      (row) => row.snapshot && expired(row.snapshot.data.expiresAt, now),
    );
    const children = (
      await Promise.all(
        expiredRows.map(async (row) =>
          snapshots(tx, `${row.path}/messages`, pages.get(row.id) || []),
        ),
      )
    ).flat();
    const actionIds = [
      ...new Set(
        expiredRows
          .map((row) => row.snapshot.data.pendingActionId)
          .filter(documentId),
      ),
    ];
    const actions = await snapshots(
      tx,
      "oliviaConfirmations",
      actionIds.map((id) => ({ id })),
    );
    const writes = [],
      aggregate = emptyAggregate(now.toISOString().slice(0, 10));
    for (const child of children) {
      if (!child.snapshot) continue;
      writes.push(remove(child.path, child.snapshot));
      addMessageMetrics(aggregate, [child.snapshot.data]);
    }
    for (const row of expiredRows) {
      if (!(pages.get(row.id) || []).length) continue;
      // Embedded messages are a cache of canonical history. Scrub its contents
      // and draft immediately while further child pages await the next run.
      writes.push({
        type: "update",
        path: row.path,
        data: {
          historyStorageVersion: 1,
          messages: [],
          draft: null,
          pendingActionId: null,
          sessionBinding: null,
          userId: null,
          busyRequestId: null,
          busyUntil: null,
          state: "CANCELADA",
          updatedAt: now,
        },
      });
    }
    for (const action of actions) {
      if (
        !action.snapshot ||
        !expiredRows.some(
          (row) => row.id === action.snapshot.data.conversationId,
        )
      )
        continue;
      writes.push(remove(action.path, action.snapshot));
      addCount(aggregate.counts, "confirmationsRemoved");
    }
    if (writes.length) {
      await appendAggregate(tx, aggregate, now, writes);
      await tx.commitDocuments(writes);
    }
    return {
      counts: aggregate.counts,
      eligible: expiredRows.map((row) => ({ id: row.id })),
    };
  });
  if (!first.eligible.length) return first.counts;
  if (!hasTime()) return { ...first.counts, possibleBacklog: true };

  // Deleting a Firestore parent does NOT delete subcollections. Check for any
  // remaining child after the page commit, with limit 1, before considering
  // parent deletion. Every message writer must verify the unexpired parent in
  // its own transaction; expiresAt is fixed from creation, so an expired parent
  // cannot acquire new children between this check and the final transaction.
  const checks = await Promise.all(
    first.eligible.map(async (row) => ({
      ...row,
      empty: !(
        await store.query(`oliviaConversations/${row.id}/messages`, [], 1, [])
      ).length,
    })),
  );
  const emptyParents = checks.filter((row) => row.empty);
  let possibleBacklog = checks.some((row) => !row.empty);
  if (!hasTime()) return { ...first.counts, possibleBacklog: true };
  if (!emptyParents.length) return { ...first.counts, possibleBacklog };

  const final = await store.transaction(async (tx) => {
    const current = await snapshots(tx, "oliviaConversations", emptyParents);
    const expiredRows = current.filter(
      (row) => row.snapshot && expired(row.snapshot.data.expiresAt, now),
    );
    const actionIds = [
      ...new Set(
        expiredRows
          .map((row) => row.snapshot.data.pendingActionId)
          .filter(documentId),
      ),
    ];
    const actions = await snapshots(
      tx,
      "oliviaConfirmations",
      actionIds.map((id) => ({ id })),
    );
    const writes = [],
      aggregate = emptyAggregate(now.toISOString().slice(0, 10));
    for (const row of expiredRows) {
      writes.push(remove(row.path, row.snapshot));
      addCount(aggregate.counts, "conversationsRemoved");
      // Legacy conversations without canonical children have only an embedded
      // history. Count that once; never double-count the canonical cache.
      if (!row.snapshot.data.historyStorageVersion)
        addMessageMetrics(aggregate, row.snapshot.data.messages);
    }
    for (const action of actions) {
      if (
        !action.snapshot ||
        !expiredRows.some(
          (row) => row.id === action.snapshot.data.conversationId,
        )
      )
        continue;
      writes.push(remove(action.path, action.snapshot));
      addCount(aggregate.counts, "confirmationsRemoved");
    }
    if (writes.length) {
      await appendAggregate(tx, aggregate, now, writes);
      await tx.commitDocuments(writes);
    }
    return aggregate.counts;
  });
  const result = counts();
  for (const key of Object.keys(result))
    result[key] = first.counts[key] + final[key];
  return { ...result, possibleBacklog };
}
async function purgeConfirmations(store, rows, now) {
  if (!rows.length) return counts();
  return store.transaction(async (tx) => {
    const current = await snapshots(tx, "oliviaConfirmations", rows);
    const expiredRows = current.filter(
      (row) => row.snapshot && expired(row.snapshot.data.expiresAt, now),
    );
    const conversationIds = [
      ...new Set(
        expiredRows
          .map((row) => row.snapshot.data.conversationId)
          .filter(documentId),
      ),
    ];
    const conversations = await snapshots(
      tx,
      "oliviaConversations",
      conversationIds.map((id) => ({ id })),
    );
    const writes = [],
      aggregate = emptyAggregate(now.toISOString().slice(0, 10));
    for (const row of expiredRows) {
      // Includes pending, completed, superseded and cancelled statuses. No
      // expired confirmation body or credentials/token material is retained.
      writes.push(remove(row.path, row.snapshot));
      addCount(aggregate.counts, "confirmationsRemoved");
    }
    for (const row of conversations) {
      if (
        !row.snapshot ||
        !expiredRows.some(
          (action) => action.id === row.snapshot.data.pendingActionId,
        )
      )
        continue;
      writes.push({
        type: "update",
        path: row.path,
        data: {
          pendingActionId: null,
          draft: null,
          state: "CANCELADA",
          updatedAt: now,
        },
      });
    }
    if (!writes.length) return counts();
    await appendAggregate(tx, aggregate, now, writes);
    await tx.commitDocuments(writes);
    return aggregate.counts;
  });
}
async function recoverRequests(store, rows, now, months) {
  if (!rows.length) return counts();
  return store.transaction(async (tx) => {
    const current = await snapshots(tx, "oliviaRequests", rows);
    const stuck = current.filter(
      (row) =>
        row.snapshot?.data.status === "running" &&
        expired(row.snapshot.data.expiresAt, now),
    );
    const budgetPaths = [
      ...new Set(
        stuck
          .map((row) => row.snapshot.data.budgetPath)
          .filter(
            (path) =>
              typeof path === "string" &&
              /^oliviaBudgets\/[^/\x00-\x1f]{1,512}$/.test(path),
          ),
      ),
    ];
    const budgets = new Map(
      await Promise.all(
        budgetPaths.map(async (path) => [path, await tx.getDocument(path)]),
      ),
    );
    const priorUsage = new Map(
      await Promise.all(
        stuck.map(async (row) => [
          row.id,
          await tx.getDocument(`oliviaUsage/${row.id}`),
        ]),
      ),
    );
    const writes = [],
      aggregate = emptyAggregate(now.toISOString().slice(0, 10));
    const nextBudgets = new Map();
    for (const row of stuck) {
      const request = row.snapshot.data,
        charge = counter(request.reservedTokens);
      const budgetSnapshot = budgets.get(request.budgetPath);
      const retentionExpiresAt =
        request.retentionExpiresAt || retentionDate(months, now);
      // A provider call may have completed before the process crashed. Unknown
      // consumption is charged at its reserved bound, never silently refunded.
      if (budgetSnapshot) {
        const budget =
          nextBudgets.get(request.budgetPath) || budgetSnapshot.data;
        nextBudgets.set(request.budgetPath, {
          ...budget,
          reservedTokens: Math.max(0, counter(budget.reservedTokens) - charge),
          usedTokens: Math.min(
            Number.MAX_SAFE_INTEGER,
            counter(budget.usedTokens) + charge,
          ),
          updatedAt: now,
        });
      } else addCount(aggregate.counts, "missingBudgetRecords");
      writes.push({
        type: "update",
        path: row.path,
        data: {
          status: "error",
          errorCode: "request-expired",
          result: null,
          completedAt: now,
          reservedTokens: 0,
          estimatedTokensCharged: charge,
          usageEstimated: true,
          recoveredBy: "retention",
          retentionExpiresAt,
        },
      });
      if (!priorUsage.get(row.id)) {
        writes.push({
          type: "create",
          path: `oliviaUsage/${row.id}`,
          data: {
            userId: request.userId || null,
            operation: category(request.operation),
            origin: "Asistente IA / Olivia",
            inputTokens: charge,
            outputTokens: 0,
            totalTokens: charge,
            estimated: true,
            measurement: "estimated-reservation",
            actualCostUsd: null,
            actualCostArs: null,
            success: false,
            errorCode: "request-expired",
            createdAt: now,
            retentionExpiresAt,
          },
        });
      }
      addCount(aggregate.counts, "requestsRecovered");
      addCount(aggregate.counts, "estimatedTokensCharged", charge);
    }
    for (const [path, data] of nextBudgets)
      writes.push({ type: "update", path, data });
    if (!writes.length) return counts();
    await appendAggregate(tx, aggregate, now, writes);
    await tx.commitDocuments(writes);
    return aggregate.counts;
  });
}
async function purgeExpiredRecords(store, collection, rows, now) {
  if (!rows.length) return counts();
  return store.transaction(async (tx) => {
    const current = await snapshots(tx, collection, rows);
    const writes = [],
      aggregate = emptyAggregate(now.toISOString().slice(0, 10));
    for (const row of current) {
      const data = row.snapshot?.data;
      if (
        !data ||
        !expired(
          collection === "oliviaRealtime"
            ? data.expiresAt
            : data.retentionExpiresAt,
          now,
        )
      )
        continue;
      if (collection === "oliviaRequests" && data.status === "running")
        continue;
      if (collection === "oliviaBudgets" && counter(data.reservedTokens) > 0)
        continue;
      // The voice lease owner must hang up first. Never erase an active call's
      // remote callId or release its budget from this privacy cleanup.
      if (collection === "oliviaRealtime" && data.status !== "closed") continue;
      writes.push(remove(row.path, row.snapshot));
      if (collection === "oliviaUsage") {
        addCount(aggregate.counts, "usageEventsRemoved");
        addCount(aggregate.operations, category(data.operation));
        addCount(aggregate.tokens, "input", data.inputTokens);
        addCount(aggregate.tokens, "output", data.outputTokens);
        addCount(aggregate.tokens, "total", data.totalTokens);
      } else
        addCount(
          aggregate.counts,
          collection === "oliviaRealtime"
            ? "voiceSessionsRemoved"
            : collection === "oliviaBudgets"
              ? "budgetsRemoved"
              : collection === "oliviaQuotaRequests"
                ? "quotaRequestsRemoved"
                : "requestsRemoved",
        );
    }
    if (!writes.length) return counts();
    await appendAggregate(tx, aggregate, now, writes);
    await tx.commitDocuments(writes);
    return aggregate.counts;
  });
}

/**
 * Eight bounded top-level queries, plus two bounded history queries per expired
 * conversation (at most 12 parents and 12 messages per parent per invocation).
 * Each phase re-reads candidates inside a transaction, so renewal, confirmed
 * execution and overlapping cleanup runs cannot delete/reconcile stale state.
 * Writes per transaction stay below Firestore's 500-write limit. The next run
 * resumes backlog; no collection scans/listeners or cross-user content logging.
 *
 * Indexes: oliviaRequests/oliviaRealtime(status ASC, expiresAt ASC); single-field
 * expiresAt for conversations/confirmations, retentionExpiresAt for requests/
 * usage/budgets/quota requests. oliviaAnonymousUsage is server-only. Retention for auditLogs
 * is independent and this job never deletes those records.
 */
export async function runOliviaRetention({
  store = createOliviaStore(),
  now = new Date(),
  batchLimit = DEFAULT_BATCH,
  timeBudgetMs = 24000,
  clock = () => Date.now(),
} = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new TypeError("Invalid retention clock.");
  const limit = Math.min(
    MAX_BATCH,
    Math.max(1, Math.floor(Number(batchLimit) || DEFAULT_BATCH)),
  );
  const started = clock();
  const budgetMs = Math.max(
    1000,
    Math.min(25000, Number(timeBudgetMs) || 24000),
  );
  const hasTime = () => clock() - started < budgetMs;
  const configuration = await store.get("oliviaConfiguration/global");
  const retentionMonths =
    Number.isInteger(configuration?.retentionMonths) &&
    configuration.retentionMonths >= 1 &&
    configuration.retentionMonths <= 12
      ? configuration.retentionMonths
      : 1;
  const definitions = [
    [
      "oliviaConversations",
      [["expiresAt", "LESS_THAN_OR_EQUAL", now]],
      "expiresAt",
    ],
    [
      "oliviaConfirmations",
      [["expiresAt", "LESS_THAN_OR_EQUAL", now]],
      "expiresAt",
    ],
    [
      "oliviaRequests",
      [
        ["status", "EQUAL", "running"],
        ["expiresAt", "LESS_THAN_OR_EQUAL", now],
      ],
      "expiresAt",
    ],
    [
      "oliviaRequests",
      [["retentionExpiresAt", "LESS_THAN_OR_EQUAL", now]],
      "retentionExpiresAt",
    ],
    [
      "oliviaUsage",
      [["retentionExpiresAt", "LESS_THAN_OR_EQUAL", now]],
      "retentionExpiresAt",
    ],
    [
      "oliviaRealtime",
      [
        ["status", "EQUAL", "closed"],
        ["expiresAt", "LESS_THAN_OR_EQUAL", now],
      ],
      "expiresAt",
    ],
    [
      "oliviaBudgets",
      [["retentionExpiresAt", "LESS_THAN_OR_EQUAL", now]],
      "retentionExpiresAt",
    ],
    [
      "oliviaQuotaRequests",
      [["retentionExpiresAt", "LESS_THAN_OR_EQUAL", now]],
      "retentionExpiresAt",
    ],
  ];
  const rows = await Promise.all(
    definitions.map(([collection, filters, field]) =>
      store
        .query(collection, filters, limit, [[field, "ASCENDING"]])
        .then((items) => items.slice(0, limit)),
    ),
  );
  const totals = counts(),
    phases = [
      () => purgeConversations(store, rows[0], now, hasTime),
      () => purgeConfirmations(store, rows[1], now),
      () => recoverRequests(store, rows[2], now, retentionMonths),
      () => purgeExpiredRecords(store, "oliviaRequests", rows[3], now),
      () => purgeExpiredRecords(store, "oliviaUsage", rows[4], now),
      () => purgeExpiredRecords(store, "oliviaRealtime", rows[5], now),
      () => purgeExpiredRecords(store, "oliviaBudgets", rows[6], now),
      () => purgeExpiredRecords(store, "oliviaQuotaRequests", rows[7], now),
    ];
  let completedPhases = 0,
    historyBacklog = false;
  for (const phase of phases) {
    // Scheduled Netlify functions have a 30s limit; don't start another phase
    // after the run budget. Transactions remain atomic if a run is interrupted.
    if (!hasTime()) break;
    const result = await phase();
    historyBacklog ||= Boolean(result.possibleBacklog);
    for (const key of Object.keys(totals)) addCount(totals, key, result[key]);
    completedPhases += 1;
  }
  return {
    ...totals,
    completedPhases,
    possibleBacklog:
      historyBacklog ||
      completedPhases < phases.length ||
      rows.some((items) => items.length === limit),
  };
}

export default async function oliviaRetention() {
  try {
    const result = await runOliviaRetention();
    console.log(
      JSON.stringify({ event: "olivia.retention.completed", ...result }),
    );
  } catch (error) {
    // Log only a controlled code, never service responses, IDs or content.
    const code = /^[a-z0-9-]{1,64}$/.test(error?.code || "")
      ? error.code
      : "retention-failed";
    console.error(JSON.stringify({ event: "olivia.retention.failed", code }));
    throw new Error("Olivia retention cleanup failed.");
  }
}
