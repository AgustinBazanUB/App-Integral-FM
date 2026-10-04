import {
  adminGetDocument,
  adminRunTransaction,
  adminCommitDocuments,
  firebaseAdminAccessToken,
} from "../firestoreAdminRest.mjs";
import { oliviaError } from "../../../../src/shared/oliviaContracts.mjs";
const BASE =
  "https://firestore.googleapis.com/v1/projects/app-integral-fm/databases/(default)/documents";
export function oliviaServerEnvironment(env = process.env) {
  if (env.FIREBASE_ADMIN_CLIENT_EMAIL && env.FIREBASE_ADMIN_PRIVATE_KEY)
    return env;
  const raw =
    env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    env.FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM;
  if (raw) {
    let account;
    try {
      account = JSON.parse(raw);
    } catch {
      throw oliviaError(
        "backend-not-configured",
        "La configuración del backend de Olivia necesita revisión.",
        503,
      );
    }
    if (account.project_id !== "app-integral-fm")
      throw oliviaError(
        "firebase-project-mismatch",
        "La configuración del backend de Olivia necesita revisión.",
        503,
      );
    return {
      ...env,
      FIREBASE_ADMIN_CLIENT_EMAIL: account.client_email,
      FIREBASE_ADMIN_PRIVATE_KEY: account.private_key,
    };
  }
  return env;
}
export function encodeValue(v) {
  if (v == null) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number")
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, encodeValue(x)]),
      ),
    },
  };
}
export function decodeValue(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return Object.fromEntries(
    Object.entries(v.mapValue?.fields || {}).map(([k, x]) => [
      k,
      decodeValue(x),
    ]),
  );
}
export function createOliviaStore({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const boundedFetch = (url, init = {}) =>
    fetchImpl(url, {
      ...init,
      signal: AbortSignal.any([
        ...(init.signal ? [init.signal] : []),
        AbortSignal.timeout(8000),
      ]),
    });
  const options = {
    env: oliviaServerEnvironment(env),
    fetchImpl: boundedFetch,
  };
  return {
    async get(path) {
      const doc = await adminGetDocument(path, options);
      return doc
        ? {
            ...doc.data,
            id: path.split("/").at(-1),
            __updateTime: doc.updateTime,
          }
        : null;
    },
    async query(
      collection,
      filters = [],
      count = 25,
      orderBy = [],
      queryOptions = {},
    ) {
      const parts = collection.split("/");
      const collectionId = parts.pop();
      const parent = parts.join("/");
      const clauses = filters.map(([field, op, value]) => ({
        fieldFilter: {
          field: { fieldPath: field },
          op,
          value: encodeValue(value),
        },
      }));
      const structuredQuery = {
        from: [{ collectionId }],
        limit: Math.min(150, Math.max(1, count)),
        ...(clauses.length
          ? {
              where:
                clauses.length === 1
                  ? clauses[0]
                  : { compositeFilter: { op: "AND", filters: clauses } },
            }
          : {}),
        ...(orderBy.length
          ? {
              orderBy: orderBy.map(([field, direction]) => ({
                field: { fieldPath: field },
                direction,
              })),
            }
          : {}),
      };
      if (queryOptions.after) {
        const { createdAt, id } = queryOptions.after;
        if (
          !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
          !Number.isFinite(new Date(createdAt).getTime())
        )
          throw oliviaError("invalid-input", "Página de historial inválida.");
        structuredQuery.startAt = {
          before: false,
          values: [
            { timestampValue: new Date(createdAt).toISOString() },
            {
              referenceValue: `${BASE.slice("https://firestore.googleapis.com/v1/".length)}/${collection}/${id}`,
            },
          ],
        };
      }
      const token = await firebaseAdminAccessToken(options);
      const r = await boundedFetch(
        `${BASE}${parent ? `/${parent}` : ""}:runQuery`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ structuredQuery }),
        },
      );
      const payload = await r.json().catch(() => ({}));
      if (!r.ok)
        throw oliviaError(
          "backend-query-error",
          "No se pudo consultar la información actual.",
          503,
        );
      return (Array.isArray(payload) ? payload : [])
        .filter((x) => x.document)
        .map(({ document: d }) => ({
          id: d.name.split("/").at(-1),
          ...Object.fromEntries(
            Object.entries(d.fields || {}).map(([k, v]) => [k, decodeValue(v)]),
          ),
          __updateTime: d.updateTime,
        }));
    },
    transaction: (work) => adminRunTransaction(work, options),
    commit: (writes) => adminCommitDocuments(writes, options),
  };
}
