import test from "node:test";
import assert from "node:assert/strict";
import {
  config,
  runOliviaRetention,
} from "../netlify/functions/olivia-retention.mjs";

const NOW = new Date("2026-10-04T15:00:00.000Z");
const PAST = new Date("2026-10-04T14:59:00.000Z");
const FUTURE = new Date("2026-11-04T15:00:00.000Z");
function memoryStore(entries = []) {
  const data = new Map(
    entries.map(([path, value]) => [path, structuredClone(value)]),
  );
  const queries = [],
    writes = [],
    state = {
      queue: Promise.resolve(),
      failCommit: false,
      beforeTransaction: null,
    };
  const snapshot = (path) =>
    data.has(path)
      ? { path, data: structuredClone(data.get(path)), updateTime: "v1" }
      : null;
  const store = {
    async get(path) {
      return data.has(path)
        ? { ...structuredClone(data.get(path)), id: path.split("/").at(-1) }
        : null;
    },
    async query(collection, filters, limit, orderBy) {
      queries.push({ collection, filters, limit, orderBy });
      let rows = [...data]
        .filter(
          ([path]) =>
            path.startsWith(collection + "/") &&
            path.split("/").length === collection.split("/").length + 1,
        )
        .map(([path, value]) => ({
          ...structuredClone(value),
          id: path.split("/").at(-1),
        }));
      for (const [field, operation, value] of filters)
        rows = rows.filter((row) => {
          if (operation === "EQUAL") return row[field] === value;
          if (operation === "LESS_THAN_OR_EQUAL")
            return (
              row[field] != null &&
              new Date(row[field]).getTime() <= new Date(value).getTime()
            );
          throw new Error("Unexpected query filter.");
        });
      if (orderBy.length)
        rows.sort(
          (a, b) => new Date(a[orderBy[0][0]]) - new Date(b[orderBy[0][0]]),
        );
      return rows.slice(0, limit);
    },
    transaction(work) {
      const pending = state.queue.then(async () => {
        if (state.beforeTransaction) {
          const hook = state.beforeTransaction;
          state.beforeTransaction = null;
          hook(data);
        }
        let committed = false;
        return work({
          async getDocument(path) {
            assert.equal(
              committed,
              false,
              "all reads precede transaction commit",
            );
            return snapshot(path);
          },
          async commitDocuments(operations) {
            assert.equal(committed, false);
            committed = true;
            if (state.failCommit)
              throw new Error("simulated unavailable database");
            for (const operation of operations) {
              if (operation.type === "create")
                assert.equal(data.has(operation.path), false);
              if (operation.type === "update")
                assert.equal(data.has(operation.path), true);
            }
            const next = new Map(
              [...data].map(([key, value]) => [key, structuredClone(value)]),
            );
            for (const operation of operations) {
              if (operation.type === "delete") next.delete(operation.path);
              else if (operation.type === "create")
                next.set(operation.path, structuredClone(operation.data));
              else {
                const value = { ...next.get(operation.path) };
                for (const field of operation.updateMask ||
                  Object.keys(operation.data)) {
                  if (Object.hasOwn(operation.data, field))
                    value[field] = structuredClone(operation.data[field]);
                  else delete value[field];
                }
                next.set(operation.path, value);
              }
            }
            data.clear();
            for (const [key, value] of next) data.set(key, value);
            writes.push(...structuredClone(operations));
          },
        });
      });
      state.queue = pending.catch(() => {});
      return pending;
    },
  };
  return { store, data, queries, writes, state };
}
const aggregate = (data) => data.get("oliviaAnonymousUsage/2026-10-04");

test("hourly job erases expired conversation text, drafts and identity into day totals", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/private-conversation",
      {
        userId: "identifiable-user",
        sessionBinding: "private-session",
        expiresAt: PAST,
        draft: { client: "Personal name" },
        pendingActionId: "proposal",
        messages: [
          {
            role: "user",
            content: "Private chat content",
            inputMode: "realtime",
          },
          { role: "assistant", content: "Private response" },
        ],
      },
    ],
    [
      "oliviaConfirmations/proposal",
      {
        userId: "identifiable-user",
        conversationId: "private-conversation",
        confirmationToken: "secret-token",
        tokenHash: "secret-hash",
        prepared: { customerName: "Personal name" },
        status: "pending",
        expiresAt: FUTURE,
      },
    ],
    [
      "oliviaConversations/current",
      {
        userId: "current-user",
        expiresAt: FUTURE,
        messages: [{ content: "keep" }],
      },
    ],
    [
      "auditLogs/business-sale",
      { userId: "identifiable-user", saleId: "sale-1" },
    ],
  ]);
  assert.equal(config.schedule, "@hourly");
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.conversationsRemoved, 1);
  assert.equal(result.confirmationsRemoved, 1);
  assert.equal(
    fixture.data.has("oliviaConversations/private-conversation"),
    false,
  );
  assert.equal(fixture.data.has("oliviaConfirmations/proposal"), false);
  assert.equal(fixture.data.has("oliviaConversations/current"), true);
  assert.equal(fixture.data.has("auditLogs/business-sale"), true);
  const anonymous = aggregate(fixture.data);
  assert.equal(anonymous.counts.messagesRemoved, 2);
  assert.equal(anonymous.inputModes.realtime, 1);
  const serialized = JSON.stringify(anonymous);
  for (const privateValue of [
    "identifiable-user",
    "private-conversation",
    "Private chat",
    "Personal name",
    "secret-token",
    "secret-hash",
    "private-session",
  ])
    assert.equal(serialized.includes(privateValue), false);
  assert.deepEqual(Object.keys(anonymous).sort(), [
    "counts",
    "day",
    "inputModes",
    "operations",
    "schemaVersion",
    "tokens",
  ]);
});

test("all expired confirmation states are erased and live proposal pointer/draft are cancelled", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/live",
      {
        expiresAt: FUTURE,
        pendingActionId: "pending",
        draft: { private: "proposal" },
        state: "ESPERANDO_CONFIRMACION",
      },
    ],
    ...["pending", "completed", "cancelled", "superseded"].map((status) => [
      `oliviaConfirmations/${status}`,
      {
        status,
        expiresAt: PAST,
        conversationId: "live",
        prepared: { secret: "remove" },
      },
    ]),
    [
      "oliviaConfirmations/not-expired",
      { status: "pending", expiresAt: FUTURE },
    ],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.confirmationsRemoved, 4);
  assert.equal(
    fixture.data.get("oliviaConversations/live").pendingActionId,
    null,
  );
  assert.equal(fixture.data.get("oliviaConversations/live").draft, null);
  assert.equal(fixture.data.get("oliviaConversations/live").state, "CANCELADA");
  assert.equal(fixture.data.has("oliviaConfirmations/not-expired"), true);
});

test("complete history is erased in pages and parent survives until all children are gone", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/paged",
      {
        userId: "private-user",
        expiresAt: PAST,
        historyStorageVersion: 1,
        draft: { client: "private-client" },
        messages: [{ role: "user", content: "cached latest message" }],
      },
    ],
    ...Array.from({ length: 25 }, (_, index) => [
      `oliviaConversations/paged/messages/message-${index}`,
      {
        role: index % 2 ? "assistant" : "user",
        content: "private historical text " + index,
        inputMode: "text",
        createdAt: PAST,
      },
    ]),
  ]);
  const childPaths = () =>
    [...fixture.data.keys()].filter((path) =>
      path.startsWith("oliviaConversations/paged/messages/"),
    );
  const first = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(first.messagesRemoved, 12);
  assert.equal(first.conversationsRemoved, 0);
  assert.equal(first.possibleBacklog, true);
  assert.equal(childPaths().length, 13);
  assert.equal(fixture.data.has("oliviaConversations/paged"), true);
  assert.equal(fixture.data.get("oliviaConversations/paged").userId, null);
  assert.equal(fixture.data.get("oliviaConversations/paged").draft, null);
  assert.deepEqual(fixture.data.get("oliviaConversations/paged").messages, []);
  const second = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(second.messagesRemoved, 12);
  assert.equal(second.conversationsRemoved, 0);
  assert.equal(childPaths().length, 1);
  const third = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(third.messagesRemoved, 1);
  assert.equal(third.conversationsRemoved, 1);
  assert.equal(childPaths().length, 0);
  assert.equal(fixture.data.has("oliviaConversations/paged"), false);
  assert.equal(aggregate(fixture.data).counts.messagesRemoved, 25);
  assert.equal(aggregate(fixture.data).counts.conversationsRemoved, 1);
  assert.equal(aggregate(fixture.data).inputModes.text, 13);
  assert.ok(
    fixture.queries
      .filter((query) => query.collection.endsWith("/messages"))
      .some((query) => query.limit === 1),
  );
  assert.doesNotMatch(
    JSON.stringify(aggregate(fixture.data)),
    /private-user|private-client|private historical|cached latest|message-/,
  );
});

test("renewal before message-page transaction prevents both child and parent deletion", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/renew-history",
      { expiresAt: PAST, historyStorageVersion: 1 },
    ],
    [
      "oliviaConversations/renew-history/messages/m",
      { role: "user", content: "keep", createdAt: PAST },
    ],
  ]);
  fixture.state.beforeTransaction = (data) => {
    data.get("oliviaConversations/renew-history").expiresAt = FUTURE;
  };
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.messagesRemoved, 0);
  assert.equal(result.conversationsRemoved, 0);
  assert.equal(
    fixture.data.has("oliviaConversations/renew-history/messages/m"),
    true,
  );
  assert.equal(fixture.data.has("oliviaConversations/renew-history"), true);
});

test("time limit after history-page commit leaves parent for the next run", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/deadline",
      { expiresAt: PAST, historyStorageVersion: 1 },
    ],
    [
      "oliviaConversations/deadline/messages/m",
      { role: "user", content: "erase", createdAt: PAST },
    ],
  ]);
  const originalTransaction = fixture.store.transaction;
  let nowTick = 0;
  fixture.store.transaction = async (work) => {
    const result = await originalTransaction(work);
    nowTick = 25000;
    return result;
  };
  const result = await runOliviaRetention({
    store: fixture.store,
    now: NOW,
    clock: () => nowTick,
  });
  assert.equal(result.messagesRemoved, 1);
  assert.equal(result.conversationsRemoved, 0);
  assert.equal(result.possibleBacklog, true);
  assert.equal(fixture.data.has("oliviaConversations/deadline"), true);
  assert.equal(
    fixture.data.has("oliviaConversations/deadline/messages/m"),
    false,
  );
  fixture.store.transaction = originalTransaction;
  const resumed = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(resumed.conversationsRemoved, 1);
  assert.equal(aggregate(fixture.data).counts.messagesRemoved, 1);
});

test("timestamp-less legacy children are not skipped by the empty-child check", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/legacy-child",
      { expiresAt: PAST, historyStorageVersion: 1 },
    ],
    [
      "oliviaConversations/legacy-child/messages/legacy",
      { role: "user", content: "old text without date" },
    ],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.messagesRemoved, 1);
  assert.equal(result.conversationsRemoved, 1);
  assert.equal(
    fixture.data.has("oliviaConversations/legacy-child/messages/legacy"),
    false,
  );
});

test("crashed requests release reservation with estimated charge, not an unknown-consumption refund", async () => {
  const fixture = memoryStore([
    [
      "oliviaBudgets/user_period",
      { userId: "user", usedTokens: 100, reservedTokens: 500, requests: 2 },
    ],
    [
      "oliviaRequests/user_crash",
      {
        userId: "user",
        requestId: "crash",
        status: "running",
        operation: "chat",
        budgetPath: "oliviaBudgets/user_period",
        reservedTokens: 300,
        expiresAt: PAST,
      },
    ],
    [
      "oliviaRequests/user_active",
      {
        userId: "user",
        status: "running",
        budgetPath: "oliviaBudgets/user_period",
        reservedTokens: 200,
        expiresAt: FUTURE,
      },
    ],
  ]);
  const first = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(first.requestsRecovered, 1);
  const budget = fixture.data.get("oliviaBudgets/user_period");
  assert.equal(budget.usedTokens, 400);
  assert.equal(budget.reservedTokens, 200);
  const marker = fixture.data.get("oliviaRequests/user_crash");
  assert.equal(marker.status, "error");
  assert.equal(marker.reservedTokens, 0);
  assert.equal(marker.errorCode, "request-expired");
  assert.equal(marker.estimatedTokensCharged, 300);
  assert.equal(marker.result, null);
  const usage = fixture.data.get("oliviaUsage/user_crash");
  assert.equal(usage.estimated, true);
  assert.equal(usage.measurement, "estimated-reservation");
  assert.equal(usage.actualCostUsd, null);
  assert.equal(usage.actualCostArs, null);
  assert.equal(usage.totalTokens, 300);
  assert.ok(new Date(usage.retentionExpiresAt) > NOW);
  const second = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(second.requestsRecovered, 0);
  assert.equal(fixture.data.get("oliviaBudgets/user_period").usedTokens, 400);
  assert.equal(aggregate(fixture.data).counts.requestsRecovered, 1);
});

test("two stale requests on one ledger settle cumulatively and no negative balance is created", async () => {
  const fixture = memoryStore([
    ["oliviaBudgets/u_p", { usedTokens: 10, reservedTokens: 70 }],
    [
      "oliviaRequests/u_one",
      {
        userId: "u",
        status: "running",
        budgetPath: "oliviaBudgets/u_p",
        reservedTokens: 50,
        expiresAt: PAST,
      },
    ],
    [
      "oliviaRequests/u_two",
      {
        userId: "u",
        status: "running",
        budgetPath: "oliviaBudgets/u_p",
        reservedTokens: 50,
        expiresAt: PAST,
      },
    ],
  ]);
  await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(fixture.data.get("oliviaBudgets/u_p").usedTokens, 110);
  assert.equal(fixture.data.get("oliviaBudgets/u_p").reservedTokens, 0);
});

test("identifying old request/usage records expire to fixed categories without row-level IDs", async () => {
  const fixture = memoryStore([
    [
      "oliviaRequests/old-user-old-id",
      {
        userId: "Old identifiable user",
        status: "completed",
        result: { conversationId: "private-conversation" },
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaUsage/old-user-old-id",
      {
        userId: "Old identifiable user",
        requestId: "private-id",
        responseId: "provider-private-id",
        operation: "chat",
        totalTokens: 70,
        inputTokens: 50,
        outputTokens: 20,
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaUsage/private-operation",
      {
        userId: "another",
        operation: "client name should never become an aggregate key",
        totalTokens: 3,
        retentionExpiresAt: PAST,
      },
    ],
    ["oliviaUsage/legacy-no-date", { userId: "legacy", totalTokens: 1 }],
    [
      "oliviaAnonymousUsage/2026-10-04",
      {
        schemaVersion: 1,
        day: "2026-10-04",
        userId: "must remove from existing aggregate",
        counts: {},
        operations: { "private-field": 5 },
        inputModes: {},
        tokens: {},
      },
    ],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.requestsRemoved, 1);
  assert.equal(result.usageEventsRemoved, 2);
  assert.equal(fixture.data.has("oliviaRequests/old-user-old-id"), false);
  assert.equal(fixture.data.has("oliviaUsage/old-user-old-id"), false);
  assert.equal(fixture.data.has("oliviaUsage/legacy-no-date"), true);
  const anonymous = aggregate(fixture.data);
  assert.equal(anonymous.operations.chat, 1);
  assert.equal(anonymous.operations.unknown, 1);
  assert.equal(anonymous.tokens.total, 73);
  assert.doesNotMatch(
    JSON.stringify(anonymous),
    /Old identifiable|private-id|provider-private|private-conversation|client name|private-field|must remove/,
  );
});

test("only closed expired voice metadata is purged; active leases remain for remote hangup", async () => {
  const fixture = memoryStore([
    [
      "oliviaRealtime/closed",
      {
        userId: "user",
        conversationId: "conversation",
        callId: "remote-call",
        status: "closed",
        expiresAt: PAST,
      },
    ],
    [
      "oliviaRealtime/active",
      { status: "active", callId: "still-live", expiresAt: PAST },
    ],
    ["oliviaRealtime/future", { status: "closed", expiresAt: FUTURE }],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.voiceSessionsRemoved, 1);
  assert.equal(fixture.data.has("oliviaRealtime/closed"), false);
  assert.equal(fixture.data.has("oliviaRealtime/active"), true);
  assert.equal(fixture.data.has("oliviaRealtime/future"), true);
  assert.doesNotMatch(
    JSON.stringify(aggregate(fixture.data)),
    /"remote-call"|"conversation"|"user"/,
  );
});

test("expired query snapshots are rechecked transactionally after renewal", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/renewed",
      { expiresAt: PAST, messages: [{ role: "user", content: "retain" }] },
    ],
  ]);
  fixture.state.beforeTransaction = (data) => {
    data.get("oliviaConversations/renewed").expiresAt = FUTURE;
  };
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.conversationsRemoved, 0);
  assert.equal(fixture.data.has("oliviaConversations/renewed"), true);
  assert.equal(fixture.data.has("oliviaAnonymousUsage/2026-10-04"), false);
});

test("expired quota requests erase user/session details in all statuses and retain only a total", async () => {
  const fixture = memoryStore([
    [
      "oliviaQuotaRequests/pending",
      {
        userId: "private-uid",
        sessionBinding: "private-login",
        status: "pending",
        reason: "private reason",
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaQuotaRequests/fulfilled",
      {
        userId: "private-admin-uid",
        status: "fulfilled",
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaQuotaRequests/current",
      { userId: "current-user", status: "pending", retentionExpiresAt: FUTURE },
    ],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.quotaRequestsRemoved, 2);
  assert.equal(fixture.data.has("oliviaQuotaRequests/pending"), false);
  assert.equal(fixture.data.has("oliviaQuotaRequests/fulfilled"), false);
  assert.equal(fixture.data.has("oliviaQuotaRequests/current"), true);
  assert.equal(aggregate(fixture.data).counts.quotaRequestsRemoved, 2);
  assert.doesNotMatch(
    JSON.stringify(aggregate(fixture.data)),
    /private-uid|private-login|private-admin|private reason|pending|fulfilled/,
  );
});

test("quota request expiry is rechecked after candidate query", async () => {
  const fixture = memoryStore([
    ["oliviaQuotaRequests/renewed", { userId: "u", retentionExpiresAt: PAST }],
  ]);
  fixture.state.beforeTransaction = (data) => {
    data.get("oliviaQuotaRequests/renewed").retentionExpiresAt = FUTURE;
  };
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.quotaRequestsRemoved, 0);
  assert.equal(fixture.data.has("oliviaQuotaRequests/renewed"), true);
});

test("expired budget identity is purged only after its reservations are settled", async () => {
  const fixture = memoryStore([
    [
      "oliviaBudgets/settled",
      {
        userId: "old-budget-user",
        reservedTokens: 0,
        usedTokens: 400,
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaBudgets/reserved",
      {
        userId: "still-reserved",
        reservedTokens: 50,
        retentionExpiresAt: PAST,
      },
    ],
    [
      "oliviaBudgets/current",
      { userId: "current", reservedTokens: 0, retentionExpiresAt: FUTURE },
    ],
  ]);
  const result = await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(result.budgetsRemoved, 1);
  assert.equal(fixture.data.has("oliviaBudgets/settled"), false);
  assert.equal(fixture.data.has("oliviaBudgets/reserved"), true);
  assert.equal(fixture.data.has("oliviaBudgets/current"), true);
  assert.doesNotMatch(
    JSON.stringify(aggregate(fixture.data)),
    /old-budget-user|still-reserved/,
  );
});

test("overlapping cleanup runs aggregate deletion once", async () => {
  const fixture = memoryStore([
    ["oliviaConversations/once", { expiresAt: PAST, messages: [] }],
  ]);
  const results = await Promise.all([
    runOliviaRetention({ store: fixture.store, now: NOW }),
    runOliviaRetention({ store: fixture.store, now: NOW }),
  ]);
  assert.equal(
    results.reduce((sum, value) => sum + value.conversationsRemoved, 0),
    1,
  );
  assert.equal(aggregate(fixture.data).counts.conversationsRemoved, 1);
});

test("failed deletion batch preserves source and does not publish anonymous totals", async () => {
  const fixture = memoryStore([
    [
      "oliviaConversations/retry",
      { expiresAt: PAST, messages: [{ content: "private" }] },
    ],
  ]);
  fixture.state.failCommit = true;
  await assert.rejects(
    runOliviaRetention({ store: fixture.store, now: NOW }),
    /simulated unavailable/,
  );
  assert.equal(fixture.data.has("oliviaConversations/retry"), true);
  assert.equal(fixture.data.has("oliviaAnonymousUsage/2026-10-04"), false);
  fixture.state.failCommit = false;
  await runOliviaRetention({ store: fixture.store, now: NOW });
  assert.equal(aggregate(fixture.data).counts.conversationsRemoved, 1);
});

test("query/transaction work is bounded and interrupted runs leave backlog for next schedule", async () => {
  const fixture = memoryStore(
    Array.from({ length: 20 }, (_, index) => [
      `oliviaConversations/old-${index}`,
      { expiresAt: PAST, messages: [] },
    ]),
  );
  const result = await runOliviaRetention({
    store: fixture.store,
    now: NOW,
    batchLimit: 999,
  });
  assert.equal(result.conversationsRemoved, 12);
  assert.equal(result.possibleBacklog, true);
  assert.equal(
    fixture.queries.filter((query) => !query.collection.includes("/")).length,
    8,
  );
  assert.ok(fixture.queries.every((query) => query.limit <= 12));
  assert.ok(
    fixture.queries
      .filter((query) => !query.collection.includes("/"))
      .every((query) => query.filters.length > 0),
  );
  const blocked = memoryStore([
    ["oliviaConversations/later", { expiresAt: PAST, messages: [] }],
  ]);
  let tick = 0;
  const paused = await runOliviaRetention({
    store: blocked.store,
    now: NOW,
    timeBudgetMs: 1000,
    clock: () => (tick++ ? 25000 : 0),
  });
  assert.equal(paused.completedPhases, 0);
  assert.equal(paused.possibleBacklog, true);
  assert.equal(blocked.data.has("oliviaConversations/later"), true);
});
