import {
  quotaPeriod,
  costForUsage,
  oliviaError,
  retentionDate,
} from "../../../../src/shared/oliviaContracts.mjs";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";

const nonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

/** Adds a privacy-minimized monthly provider rollup to the caller's existing ledger. */
export function addProviderSpend(current, { provider, period, costUsd = null, inputTokens = 0, outputTokens = 0, characters = 0 }, now = new Date(), retentionExpiresAt = null) {
  if (!['lunaSol', 'chirp'].includes(provider)) throw oliviaError('invalid-provider', 'Proveedor de uso inválido.');
  const source = current || {}, prior = source[provider] || {};
  const next = {
    ...source,
    period: period || source.period,
    createdAt: source.createdAt || now,
    updatedAt: now,
    ...(retentionExpiresAt ? { retentionExpiresAt } : {}),
    [provider]: { ...prior },
  };
  const bucket = next[provider], amount = Number(costUsd);
  const hasCost = costUsd != null && Number.isFinite(amount) && amount >= 0;
  if (provider === 'lunaSol') {
    bucket.calls = nonNegative(bucket.calls) + 1;
    bucket.inputTokens = nonNegative(bucket.inputTokens) + nonNegative(inputTokens);
    bucket.outputTokens = nonNegative(bucket.outputTokens) + nonNegative(outputTokens);
    if (hasCost) {
      bucket.estimatedUsd = nonNegative(bucket.estimatedUsd) + amount;
    } else bucket.unconfirmedCalls = nonNegative(bucket.unconfirmedCalls) + 1;
  } else {
    bucket.requests = nonNegative(bucket.requests) + 1;
    bucket.characters = nonNegative(bucket.characters) + nonNegative(characters);
    if (hasCost) bucket.estimatedUsd = nonNegative(bucket.estimatedUsd) + amount;
    else bucket.unconfirmedRequests = nonNegative(bucket.unconfirmedRequests) + 1;
  }
  return next;
}

export function quotaFor(configuration, uid, now = new Date(), profile = null) {
  const quota = configuration.userQuotas?.[uid] || configuration.defaultQuota;
  const period = quotaPeriod(quota.frequency, now);
  const extra =
    quota.temporaryPeriod === period.key
      ? Number(quota.temporaryExtraTokens || 0)
      : 0;
  return { ...period, tokens: quota.tokens + extra, ...(canAccessAdministration(profile || {}) ? { unlimited: true } : {}) };
}
export function publicUsage(
  session,
  budget,
  quota,
  event = null,
  configuration = null,
) {
  const used =
    Number(budget?.usedTokens || 0) + Number(budget?.reservedTokens || 0);
  const result = {
    remainingPercent: quota.unlimited ? null : Math.max(
      0,
      Math.round((100 * (quota.tokens - used)) / quota.tokens),
    ),
    renewsAt: quota.unlimited ? null : quota.renewsAt,
    ...(quota.unlimited ? { unlimited: true } : {}),
    period: quota.key,
  };
  if (event) result.lastCost = { ars: Object.hasOwn(event, "actualCostArs") ? event.actualCostArs : costForUsage(event, configuration || {}).actualCostArs, estimated: event.measurement === "reserved-estimate" };
  if (canAccessAdministration(session.profile))
    Object.assign(result, {
      usedTokens: Number(budget?.usedTokens || 0),
      reservedTokens: Number(budget?.reservedTokens || 0),
      quotaTokens: quota.unlimited ? null : quota.tokens,
      ...(event
        ? {
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            totalTokens: event.totalTokens,
            measurement: event.measurement,
            ...(Object.hasOwn(event, "actualCostArs") ? { actualCostArs: event.actualCostArs, actualCostUsd: event.actualCostUsd ?? null } : costForUsage(event, configuration || {})),
          }
        : {}),
    });
  return result;
}
export async function reserveUsage({
  store,
  session,
  configuration,
  requestId,
  operation,
  reservedTokens,
  now = new Date(),
}) {
  const quota = quotaFor(configuration, session.uid, now, session.profile),
    budgetPath = `oliviaBudgets/${session.uid}_${quota.key}`,
    requestPath = `oliviaRequests/${session.uid}_${requestId}`;
  return store.transaction(async (tx) => {
    const existing = await tx.getDocument(requestPath);
    if (existing)
      throw oliviaError(
        "request-already-used",
        "Este intento ya fue procesado. Actualizá la conversación.",
        409,
      );
    const snapshot = await tx.getDocument(budgetPath);
    const budget = snapshot?.data || {
      userId: session.uid,
      period: quota.key,
      usedTokens: 0,
      reservedTokens: 0,
      requests: 0,
    };
    if (
      !quota.unlimited && budget.usedTokens + budget.reservedTokens + reservedTokens >
      quota.tokens
    )
      throw oliviaError(
        "quota-exhausted",
        "El cupo disponible no alcanza para esta solicitud. Podés continuar manualmente.",
        429,
      );
    if (
      budget.lastRequestAt &&
      now.getTime() - new Date(budget.lastRequestAt).getTime() < 1200
    )
      throw oliviaError(
        "rate-limit",
        "Esperá un momento antes de enviar otra consulta.",
        429,
      );
    await tx.commitDocuments([
      {
        type: snapshot ? "update" : "create",
        path: budgetPath,
        data: {
          ...budget,
          reservedTokens: budget.reservedTokens + reservedTokens,
          requests: budget.requests + 1,
          lastRequestAt: now,
          updatedAt: now,
          retentionExpiresAt: retentionDate(configuration.retentionMonths, now),
        },
      },
      {
        type: "create",
        path: requestPath,
        data: {
          userId: session.uid,
          requestId,
          operation,
          status: "running",
          reservedTokens,
          budgetPath,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 120000),
        },
      },
    ]);
    return { quota, budgetPath, requestPath, reservedTokens };
  });
}
export async function settleUsage({
  store,
  session,
  reservation,
  event,
  configuration,
  result = null,
  errorCode = null,
  now = new Date(),
}) {
  return store.transaction(async (tx) => {
    const request = await tx.getDocument(reservation.requestPath);
    const snapshot = await tx.getDocument(reservation.budgetPath);
    if (!request || !snapshot)
      throw oliviaError(
        "usage-state-missing",
        "No se pudo verificar el consumo.",
        503,
      );
    if (request.data.status !== "running") return snapshot.data;
    const budget = snapshot.data;
    const charged = Math.max(0, Number(event.totalTokens || 0));
    const next = {
      ...budget,
      reservedTokens: Math.max(
        0,
        budget.reservedTokens - reservation.reservedTokens,
      ),
      usedTokens: budget.usedTokens + charged,
      updatedAt: now,
      retentionExpiresAt: retentionDate(configuration.retentionMonths, now),
    };
    const usage = {
      userId: session.uid,
      role: session.profile.role,
      origin: "Asistente IA / Olivia",
      operation: request.data.operation,
      requestId: request.data.requestId,
      ...event,
      ...costForUsage(event, configuration),
      success: !errorCode,
      errorCode,
      createdAt: now,
      retentionExpiresAt: retentionDate(configuration.retentionMonths, now),
    };
    const modelCalls = Array.isArray(event.modelCalls) ? event.modelCalls : [];
    const monthlyPeriod = now.toISOString().slice(0, 7);
    const providerPath = `oliviaGeminiLiveBudgets/${monthlyPeriod}`;
    const providerSnapshot = modelCalls.length ? await tx.getDocument(providerPath) : null;
    let providerSpend = providerSnapshot?.data || null;
    for (const call of modelCalls) providerSpend = addProviderSpend(providerSpend, {
      provider: 'lunaSol', period: monthlyPeriod,
      costUsd: call.actualCostUsd,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    }, now, retentionDate(configuration.retentionMonths, now));
    await tx.commitDocuments([
      { type: "update", path: reservation.budgetPath, data: next },
      {
        type: "update",
        path: reservation.requestPath,
        data: {
          status: errorCode ? "error" : "completed",
          result,
          errorCode,
          completedAt: now,
          retentionExpiresAt: retentionDate(configuration.retentionMonths, now),
        },
      },
      {
        type: "create",
        path: `oliviaUsage/${session.uid}_${request.data.requestId}`,
        data: usage,
      },
      ...(modelCalls.length ? [{ type: providerSnapshot ? 'update' : 'create', path: providerPath, data: providerSpend }] : []),
    ]);
    return next;
  });
}
export async function increaseReservation({ store, reservation, amount }) {
  await store.transaction(async (tx) => {
    const request = await tx.getDocument(reservation.requestPath),
      snapshot = await tx.getDocument(reservation.budgetPath);
    if (!request || request.data.status !== "running" || !snapshot)
      throw oliviaError("request-expired", "Este intento venció.", 409);
    const budget = snapshot.data;
    if (
      !reservation.quota.unlimited && budget.usedTokens + budget.reservedTokens + amount >
      reservation.quota.tokens
    )
      throw oliviaError(
        "quota-exhausted",
        "El cupo disponible no alcanza para completar la consulta. Podés continuar manualmente.",
        429,
      );
    await tx.commitDocuments([
      {
        type: "update",
        path: reservation.budgetPath,
        data: { reservedTokens: budget.reservedTokens + amount },
      },
      {
        type: "update",
        path: reservation.requestPath,
        data: { reservedTokens: request.data.reservedTokens + amount },
      },
    ]);
  });
  reservation.reservedTokens += amount;
}

export async function releaseMeasuredReservation({
  store,
  reservation,
  measuredTokens,
}) {
  if (!Number.isSafeInteger(measuredTokens) || measuredTokens < 0)
    throw oliviaError("invalid-usage", "Medición de consumo inválida.");
  const retained = await store.transaction(async (tx) => {
    const request = await tx.getDocument(reservation.requestPath),
      snapshot = await tx.getDocument(reservation.budgetPath);
    if (!request || request.data.status !== "running" || !snapshot)
      throw oliviaError("request-expired", "Este intento venció.", 409);
    const current = request.data.reservedTokens,
      target = Math.min(current, measuredTokens),
      released = current - target;
    if (released > 0)
      await tx.commitDocuments([
        {
          type: "update",
          path: reservation.budgetPath,
          data: { reservedTokens: snapshot.data.reservedTokens - released },
        },
        {
          type: "update",
          path: reservation.requestPath,
          data: { reservedTokens: target },
        },
      ]);
    return target;
  });
  reservation.reservedTokens = retained;
}
