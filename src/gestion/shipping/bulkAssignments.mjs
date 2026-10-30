// Each operation is independently authorized and idempotent on the server.
export async function assignPreparersToShipments(ids, requests, person, reason, send) {
  const successes = [], failures = [];
  for (const id of ids) {
    try {
      await send({ mode: "assign", shipmentId: id, requestId: requests[id], assignedPreparerIds: [person], reason });
      successes.push(id);
    } catch (error) { failures.push({ id, message: error.message }); }
  }
  return { successes, failures };
}
