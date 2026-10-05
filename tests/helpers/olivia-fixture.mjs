import assert from "node:assert/strict";
import { createOliviaEngine } from "../../netlify/functions/_lib/olivia/engine.mjs";
import {
  reserveUsage,
  increaseReservation,
  releaseMeasuredReservation,
  settleUsage,
  quotaFor,
  publicUsage,
} from "../../netlify/functions/_lib/olivia/usage.mjs";
import {
  runTool,
  toolDefinitions,
} from "../../netlify/functions/_lib/olivia/tools.mjs";
import { openaiRequest } from "../../netlify/functions/_lib/olivia/provider.mjs";
import {
  defaultOliviaConfiguration,
  retentionDate,
} from "../../src/shared/oliviaContracts.mjs";
import {
  dateFromLocationValue,
  isLocationActiveNow,
} from "../../src/modules/locations/domain/locations.js";

const copy = (value) => structuredClone(value);
const initialNow = new Date("2026-10-04T15:00:00Z");
const saleArgs = (extra) => ({
  locationId: "local_a",
  items: [{ productId: "oil", qty: 1 }],
  paymentMethod: "cash",
  payments: null,
  discounts: null,
  ticketRequested: false,
  customer: null,
  customerDecision: "none",
  promotionDecision: "none",
  ...extra,
});
const functionResponse = (name, args) => ({
  id: "response_a",
  status: "completed",
  usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
  output: [
    {
      type: "function_call",
      id: "function_a",
      call_id: "call_a",
      name,
      arguments: JSON.stringify(args),
    },
  ],
});
const textResponse = (text) => ({
  id: "response_text",
  status: "completed",
  output_text: text,
  usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
  output: [],
});

/** A serialized atomic transactional adapter: reads precede writes, failed
 * transactions publish nothing, and simultaneous confirmations see commits.
 * Queries enforce the actual tools' filters against deliberately mixed data.
 */
function fixture({
  role = "seller",
  provider: suppliedProvider,
  quotaTokens = 1000000,
} = {}) {
  let time = new Date(initialNow),
    sequence = 0,
    queue = Promise.resolve(),
    calls = 0;
  const profile = {
    name: "Ana",
    role,
    active: true,
    allowedLocationIds: ["local_a"],
  };
  const config = defaultOliviaConfiguration();
  config.defaultQuota.tokens = quotaTokens;
  config.pricing = {
    [config.profiles.seller.model]: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 2,
    },
  };
  const documents = new Map(
    Object.entries({
      "users/user_a": profile,
      "oliviaConfiguration/global": config,
      "locations/local_a": {
        name: "Local A",
        codePrefix: "LA",
        active: true,
        assignedSellerIds: ["user_a"],
        deleted: false,
      },
      "locations/local_b": {
        name: "Local B",
        active: true,
        assignedSellerIds: ["other"],
        deleted: false,
      },
      "products/oil": {
        name: "Aceite",
        defaultPrice: 1500,
        active: true,
        deleted: false,
      },
      "locationStock/local_a/items/oil": {
        productId: "oil",
        productName: "Aceite",
        currentStock: 4,
        initialStock: 4,
        priceMode: "default",
        active: true,
      },
      "sales/own_today": {
        sellerId: "user_a",
        locationId: "local_a",
        createdAt: initialNow,
        status: "active",
        saleCode: "OWN",
        total: 1500,
      },
      "sales/other_today": {
        sellerId: "other",
        locationId: "local_a",
        createdAt: initialNow,
        status: "active",
        saleCode: "SECRET_OTHER",
        total: 99999,
      },
      "sales/own_old": {
        sellerId: "user_a",
        locationId: "local_a",
        createdAt: new Date("2026-10-03T15:00:00Z"),
        status: "active",
        saleCode: "OLD",
        total: 8000,
      },
      "sales/own_cancelled": {
        sellerId: "user_a",
        locationId: "local_a",
        createdAt: initialNow,
        status: "cancelled",
        saleCode: "CANCELLED",
        total: 3000,
      },
    }),
  );
  const versions = new Map(
    [...documents.keys()].map((path) => [path, `version_${++sequence}`]),
  );
  const commits = [],
    queries = [],
    providerRequests = [];
  function apply(writes) {
    const next = new Map(documents);
    for (const write of writes) {
      if (write.type === "create" && next.has(write.path))
        throw Object.assign(new Error("Create precondition failed"), {
          code: "firebase-admin-precondition-failed",
        });
      if (write.type === "update" && !next.has(write.path))
        throw new Error("Update target missing");
      if (
        write.currentUpdateTime &&
        versions.get(write.path) !== write.currentUpdateTime
      )
        throw new Error("Update version changed");
      if (write.type === "delete") { next.delete(write.path); continue; }
      next.set(
        write.path,
        write.type === "update"
          ? { ...next.get(write.path), ...copy(write.data) }
          : copy(write.data),
      );
    }
    documents.clear();
    for (const [path, value] of next) documents.set(path, value);
    for (const write of writes)
      versions.set(write.path, `version_${++sequence}`);
    commits.push(copy(writes));
  }
  const store = {
    get: async (path) =>
      documents.has(path)
        ? {
            ...copy(documents.get(path)),
            id: path.split("/").at(-1),
            __updateTime: versions.get(path),
          }
        : null,
    commit: async (writes) => apply(writes),
    transaction(work) {
      const job = queue.then(async () => {
        const snapshot = new Map(
          [...documents].map(([path, data]) => [path, copy(data)]),
        );
        let committed = false;
        return work({
          async getDocument(path) {
            if (committed) throw new Error("Read after commit");
            return snapshot.has(path)
              ? {
                  data: copy(snapshot.get(path)),
                  updateTime: versions.get(path),
                }
              : null;
          },
          async commitDocuments(writes) {
            if (committed) throw new Error("Duplicate commit");
            committed = true;
            apply(writes);
          },
        });
      });
      queue = job.catch(() => {});
      return job;
    },
    async query(
      collection,
      filters = [],
      limit = 25,
      orderBy = [],
      options = {},
    ) {
      queries.push({ collection, filters: copy(filters), limit });
      const entries = [...documents].filter(
        ([path]) =>
          path.startsWith(`${collection}/`) &&
          path.split("/").length === collection.split("/").length + 1,
      );
      return entries
        .filter(([, data]) =>
          filters.every(([field, op, expected]) => {
            let value = data[field];
            if (expected instanceof Date) value = new Date(value);
            if (op === "EQUAL") return value === expected;
            if (op === "IN") return expected.includes(value);
            if (op === "ARRAY_CONTAINS")
              return Array.isArray(value) && value.includes(expected);
            if (op === "GREATER_THAN_OR_EQUAL") return value >= expected;
            if (op === "LESS_THAN_OR_EQUAL") return value <= expected;
            if (op === "LESS_THAN") return value < expected;
            throw new Error(`Unsupported fixture filter ${op}`);
          }),
        )
        .map(([path, data]) => ({
          ...copy(data),
          id: path.split("/").at(-1),
          __updateTime: versions.get(path),
        }))
        .sort((a, b) => {
          for (const [field, direction] of orderBy) {
            const av =
                field === "__name__" ? a.id : new Date(a[field]).getTime(),
              bv = field === "__name__" ? b.id : new Date(b[field]).getTime();
            if (av !== bv)
              return (av > bv ? 1 : -1) * (direction === "DESCENDING" ? -1 : 1);
          }
          return 0;
        })
        .filter(
          (item) =>
            !options.after ||
            new Date(item[orderBy[0]?.[0] || "createdAt"]).getTime() <
              new Date(options.after.updatedAt ?? options.after.createdAt).getTime() ||
            (new Date(item[orderBy[0]?.[0] || "createdAt"]).getTime() ===
              new Date(options.after.updatedAt ?? options.after.createdAt).getTime() &&
              item.id < options.after.id),
        )
        .slice(0, limit);
    },
  };
  const session = {
    uid: "user_a",
    authTime: initialNow.getTime() / 1000,
    profile: copy(profile),
  };
  const provider = async (path, body, options) => {
    calls += 1;
    providerRequests.push(copy(body));
    return suppliedProvider
      ? suppliedProvider(path, body, options, calls)
      : textResponse("Te ayudo con tu Panel Vendedor.");
  };
  const engine = createOliviaEngine({
    store,
    env: { OPENAI_API_KEY: "fake-key-for-local-fixtures" },
    provider,
    clock: () => new Date(time),
  });
  return {
    documents,
    commits,
    queries,
    providerRequests,
    store,
    session,
    config,
    engine,
    providerCalls: () => calls,
    advance: (ms) => {
      time = new Date(time.getTime() + ms);
    },
    clock: () => new Date(time),
  };
}
async function start(f) {
  return f.engine.state(f.session);
}
async function chat(f, conversationId, extra = {}) {
  return f.engine.chat(f.session, {
    conversationId,
    requestId: "request_a",
    message: "Registrá una unidad de aceite",
    screenContext: {
      route: "/vendedor",
      module: "seller",
      locationId: "local_a",
    },
    ...extra,
  });
}
function newBusinessSales(f) {
  return [...f.documents].filter(([path]) =>
    path.startsWith("sales/olivia_sale_"),
  );
}

export { fixture, start, chat, textResponse, functionResponse, initialNow, saleArgs };
