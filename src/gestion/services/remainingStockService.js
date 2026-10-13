import { collection, getDocs } from "firebase/firestore";
import { can } from "../permissions";
import { db } from "./firebase";
import { listWarehouses } from "./inventoryService";

export async function listRemainingStock({ profile, locations, includeWarehouses = false }) {
  const origins = can(profile, "locations", "viewStock")
    ? locations.map(location => ({ type: "location", id: location.id, name: location.name })) : [];
  if (includeWarehouses && can(profile, "warehouse", "view")) {
    const warehouses = await listWarehouses(profile, { includeInactive: true });
    origins.push(...warehouses.map(warehouse => ({ type: "warehouse", id: warehouse.id, name: warehouse.name })));
  }
  // Existing per-origin rules enforce location assignments and warehouse access.
  // One read per origin, with no per-product hydration or extra sales query.
  return Promise.all(origins.map(async origin => {
    const snapshot = await getDocs(collection(db, origin.type === "warehouse" ? "warehouseStock" : "locationStock", origin.id, "items"));
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (items.some(item => !item.deleted && !Number.isFinite(Number(item.currentStock ?? 0)))) throw new Error("Un saldo de inventario no es válido.");
    return { ...origin, items };
  }));
}
