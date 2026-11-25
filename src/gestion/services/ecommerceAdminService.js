import { auth, db } from "./firebase";
import { collection, onSnapshot, query, where } from "firebase/firestore";
export function subscribeWebCommerce(onOrders, onSales, onError) {
  const subscribe = (name, callback) =>
    onSnapshot(
      query(collection(db, name), where("sourceType", "==", "ecommerce")),
      (snapshot) =>
        callback(snapshot.docs.map((row) => ({ ...row.data(), id: row.id }))),
      onError,
    );
  const stops = [subscribe("orders", onOrders), subscribe("sales", onSales)];
  return () => stops.forEach((stop) => stop());
}
export async function ecommerceAdminRequest(body) {
  if (!auth.currentUser) throw new Error("Iniciá sesión como administrador.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch("/.netlify/functions/ecommerce-admin", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(result.message || "No se pudo completar la operación web.");
  return result.result;
}
