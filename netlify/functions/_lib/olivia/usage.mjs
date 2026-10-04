import {
  quotaPeriod,
  costForUsage,
  oliviaError,
  retentionDate,
} from "../../../../src/shared/oliviaContracts.mjs";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";
export function quotaFor(configuration, uid, now = new Date()) {
  const quota = configuration.userQuotas?.[uid] || configuration.defaultQuota;
  const period = quotaPeriod(quota.frequency, now);
  const extra =
    quota.temporaryPeriod === period.key
      ? Number(quota.temporaryExtraTokens || 0)
      : 0;
  return { ...period, tokens: quota.tokens + extra };
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
    remainingPercent: Math.max(
      0,
      Math.round((100 * (quota.tokens - used)) / quota.tokens),
    ),
    renewsAt: quota.renewsAt,
    period: quota.key,
  };
  if (canAccessAdministration(session.profile))
    Object.assign(result, {
      usedTokens: Number(budget?.usedTokens || 0),
      reservedTokens: Number(budget?.reservedTokens || 0),
      quotaTokens: quota.tokens,
      ...(event
        ? {
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            ...costForUsage(event, configuration),
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
  const quota = quotaFor(configuration, session.uid, now),
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
      budget.usedTokens + budget.reservedTokens + reservedTokens >
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
      budget.usedTokens + budget.reservedTokens + amount >
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
