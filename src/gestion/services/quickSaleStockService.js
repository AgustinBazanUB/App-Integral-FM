import { collection, onSnapshot, onSnapshotsInSync } from "firebase/firestore";
import { db } from "./firebase";

// Publish once all listeners affected by a server change have received it.
// Transfer records are excluded because the balances already reflect them.
export function subscribeQuickSaleStock(locations, warehouses, onData, onError) {
  const origins = [
    ...new Set(locations.map(location => `locationStock/${location.id}`)),
    ...new Set(warehouses.map(warehouse => `warehouseStock/${warehouse.id}`)),
  ];
  const balances = new Map();
  let failed = false;
  let changed = true;
  const stop = origins.map(path => onSnapshot(collection(db, `${path}/items`), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) balances.delete(path);
    else balances.set(path, snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
    changed = true;
  }, error => {
    failed = true;
    onError(error);
  }));
  stop.push(onSnapshotsInSync(db, () => {
    if (failed || !changed) return;
    changed = false;
    onData(balances.size === origins.length ? new Map(balances) : null);
  }));
  return () => stop.forEach(unsubscribe => unsubscribe());
}
