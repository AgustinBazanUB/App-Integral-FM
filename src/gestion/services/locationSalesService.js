import {
  collection,
  getDocs,
  getDoc,
  doc,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "firebase/firestore";
import { can } from "../permissions";
import { db } from "./firebase";

const docsToArray = (snapshot) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

export async function getLocationSale({ profile, locationId, saleId }) {
  if (!can(profile, "locations", "view")) throw new Error("No tenés permiso para consultar esta venta.");
  const snapshot = await getDoc(doc(db, "sales", saleId));
  if (!snapshot.exists() || snapshot.data().deleted || snapshot.data().locationId !== locationId) throw new Error("La venta no pertenece a esta ubicación o ya no está disponible.");
  return { id: snapshot.id, ...snapshot.data() };
}

export async function listLocationSalesPage({
  profile,
  locationId,
  cursor = null,
  pageSize = 50,
}) {
  if (!can(profile, "locations", "view")) {
    throw new Error("No tenés permiso para consultar las ventas de esta ubicación.");
  }
  if (!locationId) return { items: [], cursor: null, hasMore: false };
  const safePageSize = Math.min(100, Math.max(10, Number(pageSize) || 50));
  /** @type {import("firebase/firestore").QueryConstraint[]} */
  const constraints = [
    where("locationId", "==", locationId),
    orderBy("createdAt", "desc"),
  ];
  if (cursor) constraints.push(startAfter(cursor));
  constraints.push(limit(safePageSize));
  const snapshot = await getDocs(query(collection(db, "sales"), ...constraints));
  return {
    items: docsToArray(snapshot).filter((sale) => sale.deleted !== true),
    cursor: snapshot.docs.at(-1) || null,
    hasMore: snapshot.size === safePageSize,
  };
}
