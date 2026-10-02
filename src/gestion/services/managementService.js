import { createAdministrativeSale } from "./sellerService";
import { deleteApp, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { moduleById } from "../modules";
import { can, normalizedRole } from "../permissions";
import { auth, db, firebaseConfig } from "./firebase";

const docsToArray = (snapshot) =>
  snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

export async function getUserProfile(uid) {
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export function observeSession(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback({ user: null, profile: null, error: null });
      return;
    }
    try {
      const profile = await getUserProfile(user.uid);
      callback({ user, profile, error: null });
    } catch (error) {
      callback({ user, profile: null, error });
    }
  });
}

export async function listModuleRecords(moduleId, pageSize = 40) {
  const definition = moduleById[moduleId];
  if (!definition?.collection) return [];
  const target = collection(db, definition.collection);
  try {
    return docsToArray(
      await getDocs(query(target, orderBy("updatedAt", "desc"), limit(pageSize))),
    );
  } catch (error) {
    if (error.code === "permission-denied") throw error;
    return docsToArray(await getDocs(query(target, limit(pageSize))));
  }
}

export async function createModuleRecord(moduleId, data, profile) {
  const definition = moduleById[moduleId];
  if (!definition?.collection) throw new Error("El módulo no tiene una colección configurada.");
  if (!can(profile, moduleId, "create")) throw new Error("No tenés permiso para crear registros en este módulo.");
  const target = await addDoc(collection(db, definition.collection), {
    ...data,
    moduleId,
    active: true,
    deleted: false,
    createdBy: profile.id,
    createdByName: profile.name || profile.email || "Usuario",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return target.id;
}

export async function saveLocation(data, profile, locationId = null) {
  if (!can(profile, "locations", locationId ? "edit" : "create")) {
    throw new Error("No tenés permiso para guardar ubicaciones.");
  }
  const target = locationId
    ? doc(db, "locations", locationId)
    : doc(collection(db, "locations"));
  await setDoc(
    target,
    {
      name: data.name.trim(),
      type: data.type,
      codePrefix: data.codePrefix.trim().toUpperCase(),
      dniMode: data.dniMode,
      active: data.active !== false,
      deleted: false,
      updatedBy: profile.id,
      updatedByName: profile.name || profile.email,
      updatedAt: serverTimestamp(),
      ...(locationId ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true },
  );
  return target.id;
}

export async function listUsers() {
  return docsToArray(await getDocs(query(collection(db, "users"), limit(100))));
}

export async function createManagedUser(data, administrator) {
  if (normalizedRole(administrator) !== "admin") {
    throw new Error("Sólo un administrador puede crear usuarios.");
  }
  const secondaryApp = initializeApp(
    firebaseConfig,
    `flor-mia-user-creator-${Date.now()}`,
  );
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      data.email.trim(),
      data.password,
    );
    await setDoc(doc(db, "users", credential.user.uid), {
      name: data.name.trim(),
      email: data.email.trim().toLowerCase(),
      role: data.role,
      active: true,
      allowedLocationIds: data.allowedLocationIds || [],
      createdBy: administrator.id,
      createdByName: administrator.name || administrator.email,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

export async function setManagedUserActive(userId, active, administrator) {
  if (normalizedRole(administrator) !== "admin") {
    throw new Error("Sólo un administrador puede cambiar este estado.");
  }
  if (userId === administrator.id && active === false) {
    throw new Error("No podés desactivar tu propia sesión.");
  }
  await setDoc(
    doc(db, "users", userId),
    {
      active,
      updatedBy: administrator.id,
      updatedByName: administrator.name || administrator.email,
      updatedAt: serverTimestamp(),
      ...(active
        ? { restoredAt: serverTimestamp() }
        : { deleted: true, deletedAt: serverTimestamp() }),
    },
    { merge: true },
  );
}

export async function listAuditLogs(pageSize = 50) {
  return docsToArray(
    await getDocs(
      query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(pageSize)),
    ),
  );
}

export async function listLocations(profile, { includeDeleted = false } = {}) {
  if (!profile) return [];
  const isAdmin = normalizedRole(profile) === "admin";
  if (isAdmin || can(profile, "locations", "viewAllLocations")) {
    return docsToArray(
      await getDocs(query(collection(db, "locations"), orderBy("name"))),
    ).filter((item) => includeDeleted || item.deleted !== true);
  }
  const ids = [...new Set(profile.allowedLocationIds || [])].slice(0, 30);
  const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, "locations", id))));
  return snapshots
    .filter((snapshot) => snapshot.exists())
    .map((snapshot) => /** @type {any} */ ({ id: snapshot.id, ...snapshot.data() }))
    .filter((item) => item.deleted !== true)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

export async function listLocationStock(locationId) {
  if (!locationId) return [];
  return docsToArray(
    await getDocs(
      query(
        collection(db, "locationStock", locationId, "items"),
        orderBy("productName"),
      ),
    ),
  ).filter((item) => item.deleted !== true && item.active !== false);
}

export async function listRecentSales({ profile, locationId, pageSize = 25 }) {
  const sales = collection(db, "sales");
  if (locationId) {
    return docsToArray(
      await getDocs(
        query(
          sales,
          where("locationId", "==", locationId),
          orderBy("createdAt", "desc"),
          limit(pageSize),
        ),
      ),
    );
  }
  if (normalizedRole(profile) === "seller") {
    return docsToArray(
      await getDocs(
        query(
          sales,
          where("sellerId", "==", profile.id),
          orderBy("createdAt", "desc"),
          limit(pageSize),
        ),
      ),
    );
  }
  return docsToArray(
    await getDocs(query(sales, orderBy("createdAt", "desc"), limit(pageSize))),
  );
}

// Adapter retained for existing callers; all stock/customer/payment writes use the POS service.
export async function createQuickSale({ seller, channel, location, stockOrigin, ...sale }) {
  return createAdministrativeSale({ ...sale, profile: seller, channel, stockOrigin: stockOrigin || { type: "location", id: location?.id } });
}
