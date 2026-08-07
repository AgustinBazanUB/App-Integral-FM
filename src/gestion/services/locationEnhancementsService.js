import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { locationActivity } from "../../modules/locations/domain/locations";
import { can, normalizedRole } from "../permissions";
import { db } from "./firebase";
import {
  loadLocationStock,
  saveLocationDiscounts,
} from "./locationManagementService";

const uniqueIds = (values = []) => [...new Set(values.filter(Boolean))];
const userName = (profile) => profile.name || profile.email || "Usuario";
const normalizedText = (value) => String(value || "").trim().toLocaleLowerCase("es");

function assertPermission(profile, action, message) {
  if (!can(profile, "locations", action)) throw new Error(message);
}

function integer(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} debe ser un número entero mayor o igual a cero.`);
  }
  return parsed;
}

function safeImagePath(value) {
  const path = String(value || "").trim();
  if (!path) return "";
  if (path.startsWith("data:") || path.startsWith("blob:")) {
    throw new Error("Las imágenes deben ser recursos locales del proyecto, no Base64 ni archivos temporales.");
  }
  if (!path.startsWith("/images/")) {
    throw new Error("Seleccioná una imagen disponible en el catálogo local.");
  }
  return path;
}

export async function savePinnedLocationIds(profile, locationIds, visibleLocationIds) {
  assertPermission(profile, "pin", "No tenés permiso para fijar ubicaciones.");
  const visible = new Set(visibleLocationIds || []);
  const pinnedLocationIds = uniqueIds(locationIds)
    .filter((locationId) => visible.has(locationId))
    .slice(0, 4);
  await setDoc(
    doc(db, "users", profile.id),
    {
      pinnedLocationIds,
      preferencesUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return pinnedLocationIds;
}

export async function loadActiveLocationStock(args) {
  const snapshot = await getDoc(doc(db, "locations", args.location.id));
  if (!snapshot.exists()) throw new Error("La ubicación ya no existe.");
  const location = { id: snapshot.id, ...snapshot.data() };
  if (!locationActivity(location).active) {
    throw new Error("Esta ubicación debe estar activa para cargar stock.");
  }
  return loadLocationStock({ ...args, location });
}

export async function saveValidatedLocationDiscounts(location, discountIds, profile) {
  const ids = uniqueIds(discountIds);
  const snapshots = await Promise.all(ids.map((id) => getDoc(doc(db, "discounts", id))));
  const now = Date.now();
  for (const snapshot of snapshots) {
    const discount = snapshot.data();
    const validFrom = discount?.validFrom?.toDate?.() || (discount?.validFrom ? new Date(discount.validFrom) : null);
    const validUntil = discount?.validUntil?.toDate?.() || (discount?.validUntil ? new Date(discount.validUntil) : null);
    if (!snapshot.exists() || discount.deleted === true || discount.active !== true) {
      throw new Error("Uno de los descuentos ya no está activo.");
    }
    if ((validFrom && validFrom.getTime() > now) || (validUntil && validUntil.getTime() < now)) {
      throw new Error("No se puede habilitar un descuento fuera de vigencia.");
    }
  }
  return saveLocationDiscounts(location, ids, profile);
}

export async function saveMasterProductFromLocation({
  location,
  productId = "",
  values,
  scope = "current",
  profile,
}) {
  assertPermission(
    profile,
    productId ? "editMasterProducts" : "createLocationProducts",
    productId
      ? "No tenés permiso para editar productos maestros."
      : "No tenés permiso para crear productos desde una ubicación.",
  );
  if (!location?.id || location.deleted === true) throw new Error("La ubicación no está disponible.");
  if (scope === "all" && !can(profile, "locations", "assignAllLocationProducts")) {
    throw new Error("No tenés permiso para agregar productos a todas las ubicaciones.");
  }

  const name = String(values.name || "").trim();
  const abbreviation = String(values.abbreviation || "").trim().toUpperCase();
  const description = String(values.description || "").trim();
  const defaultPrice = integer(values.defaultPrice || 0, "El precio predeterminado");
  const yellowAlertQty = integer(values.yellowAlertQty || 0, "La alerta amarilla");
  const redAlertQty = integer(values.redAlertQty || 0, "La alerta roja");
  if (!name) throw new Error("Ingresá el nombre del producto.");
  if (!abbreviation) throw new Error("Ingresá una abreviación.");
  if (abbreviation.length > 8) throw new Error("La abreviación admite hasta 8 caracteres.");
  if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja.");

  const imageUrl = safeImagePath(values.imageUrl);
  const thumbUrl = safeImagePath(values.thumbUrl || values.imageUrl);
  const categoryId = String(values.categoryId || "").trim();
  let categoryName = "Sin categoría";
  if (categoryId) {
    const categorySnapshot = await getDoc(doc(db, "productCategories", categoryId));
    if (!categorySnapshot.exists() || categorySnapshot.data().deleted === true) {
      throw new Error("La categoría seleccionada ya no está disponible.");
    }
    categoryName = categorySnapshot.data().name || "Sin categoría";
  }

  const productsSnapshot = await getDocs(collection(db, "products"));
  const duplicate = productsSnapshot.docs.find((item) => {
    if (item.id === productId || item.data().deleted === true) return false;
    return normalizedText(item.data().name) === normalizedText(name)
      || normalizedText(item.data().abbreviation) === normalizedText(abbreviation);
  });
  if (duplicate) throw new Error("Ya existe un producto con ese nombre o abreviación.");

  const productRef = productId ? doc(db, "products", productId) : doc(collection(db, "products"));
  const batch = writeBatch(db);
  const productPayload = {
    name,
    nameKey: normalizedText(name),
    abbreviation,
    description,
    defaultPrice,
    categoryId,
    categoryName,
    imageUrl,
    thumbUrl,
    imageAlt: String(values.imageAlt || name).trim(),
    imageStatus: values.imageStatus || (imageUrl.includes("logo-flor-mia") ? "pending" : "available"),
    originalImageFileName: values.originalImageFileName || imageUrl.split("/").pop() || "",
    buttonKey: String(values.buttonKey || "").trim(),
    buttonCode: String(values.buttonCode || "").trim(),
    buttonLocation: Number(values.buttonLocation || 0),
    buttonLabel: String(values.buttonLabel || values.buttonKey || "").trim(),
    active: values.active !== false,
    deleted: false,
    updatedAt: serverTimestamp(),
    updatedBy: profile.id,
    updatedByName: userName(profile),
    ...(productId ? {} : {
      createdAt: serverTimestamp(),
      createdBy: profile.id,
      createdByName: userName(profile),
    }),
  };
  batch.set(productRef, productPayload, { merge: true });

  let targetLocations = [];
  if (!productId) {
    if (scope === "all") {
      const locationSnapshots = await getDocs(query(collection(db, "locations"), orderBy("name")));
      targetLocations = locationSnapshots.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((item) => item.deleted !== true && locationActivity(item).active);
    } else {
      targetLocations = [location];
    }
    if (targetLocations.length > 450) {
      throw new Error("Hay demasiadas ubicaciones para una sola operación. Dividí la asignación en grupos.");
    }
    targetLocations.forEach((targetLocation) => {
      batch.set(
        doc(db, "locationStock", targetLocation.id, "items", productRef.id),
        {
          productId: productRef.id,
          productName: name,
          abbreviation,
          categoryId,
          categoryName,
          imageUrl,
          thumbUrl,
          price: defaultPrice,
          initialStock: 0,
          currentStock: 0,
          yellowAlertQty,
          redAlertQty,
          active: values.active !== false,
          deleted: false,
          productDeleted: false,
          assignedAt: serverTimestamp(),
          assignedBy: profile.id,
          updatedAt: serverTimestamp(),
          updatedBy: profile.id,
        },
        { merge: true },
      );
    });
  }

  batch.set(doc(collection(db, "auditLogs")), {
    action: productId ? "product.updatedFromLocation" : "product.createdFromLocation",
    title: productId ? "Producto maestro actualizado" : "Producto creado desde ubicación",
    description: productId
      ? `${name} · ${location.name}`
      : `${name} · ${scope === "all" ? `${targetLocations.length} ubicaciones activas` : location.name}`,
    moduleId: "locations",
    entityType: "product",
    entityId: productRef.id,
    entityName: name,
    locationId: location.id,
    locationName: location.name,
    scope,
    targetLocationIds: targetLocations.map((item) => item.id),
    userId: profile.id,
    userName: userName(profile),
    status: "completed",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return { id: productRef.id, targetLocationIds: targetLocations.map((item) => item.id) };
}

export function canAssignGlobally(profile) {
  return ["admin", "general_admin"].includes(normalizedRole(profile))
    || can(profile, "locations", "assignAllLocationProducts");
}
