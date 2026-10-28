import { firebaseAdminAccessToken, adminRunTransaction } from "./firestoreAdminRest.mjs";
import { publicFirebaseProjectId } from "./firebaseAuth.mjs";

export async function expiredPositionPaths({ env = process.env, now = new Date(), fetchImpl = fetch } = {}) {
  const token = await firebaseAdminAccessToken({ env, fetchImpl });
  const response = await fetchImpl(`https://firestore.googleapis.com/v1/projects/${publicFirebaseProjectId()}/databases/(default)/documents:runQuery`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "shipments" }], where: { fieldFilter: { field: { fieldPath: "lastPosition.expiresAt" }, op: "LESS_THAN_OR_EQUAL", value: { timestampValue: now.toISOString() } } }, limit: 200, select: { fields: [{ fieldPath: "lastPosition.expiresAt" }] } } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("No se pudo consultar la retención de ubicaciones.");
  const data = await response.json();
  return data.filter(row => row.document?.name).map(row => row.document.name.split("/documents/")[1]);
}
export async function clearExpiredShippingPositions({ env = process.env, now = new Date(), queryPositions = expiredPositionPaths, runTransaction = adminRunTransaction } = {}) {
  if (env.SHIPPING_ENABLED === "false") return { cleared: 0 };
  const paths = await queryPositions({ env, now });
  let cleared = 0;
  // Small batches fit within Firestore and the scheduled-function runtime.
  for (let offset = 0; offset < paths.length; offset += 40) {
    cleared += await runTransaction(async transaction => {
      const operations = [];
      for (const path of paths.slice(offset, offset + 40)) {
        if (!/^shipments\/[A-Za-z0-9_-]+$/.test(path)) throw new Error("Ruta de retención inválida.");
        const shipment = (await transaction.getDocument(path))?.data;
        if (shipment?.lastPosition?.expiresAt && new Date(shipment.lastPosition.expiresAt) <= now) operations.push({ type: "update", path, data: { lastPosition: null, gpsTrail: [], activeGpsSession: null } });
      }
      await transaction.commitDocuments(operations);
      return operations.length;
    }, { env });
  }
  return { cleared };
}
