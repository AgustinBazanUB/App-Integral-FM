import { doc, getDocFromServer } from "firebase/firestore";
import { db } from "./services/firebase";

let status = typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline";
let initialized = false;
const listeners = new Set();

const emit = (nextStatus) => {
  if (status === nextStatus) return;
  status = nextStatus;
  listeners.forEach((listener) => listener());
};

const initialize = () => {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  window.addEventListener("online", () => emit("online"), { passive: true });
  window.addEventListener("offline", () => emit("offline"), { passive: true });
};

export function subscribeConnection(listener) {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConnectionSnapshot() {
  initialize();
  return status;
}

export function isConnectionOnline() {
  return getConnectionSnapshot() === "online";
}

export async function reconnectFirestore(profileId) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    emit("offline");
    return false;
  }
  emit("reconnecting");
  try {
    await getDocFromServer(doc(db, "users", profileId));
    emit("online");
    return true;
  } catch (error) {
    emit("offline");
    throw error;
  }
}
