import {
  adminCreateDocument,
  adminGetDocument,
  adminPatchDocument,
} from "../firestoreAdminRest.mjs";
import { arcaEnvironment } from "./config.mjs";

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    const error = new Error(`${label} inválido.`);
    error.code = "arca-sequence-lock-invalid";
    throw error;
  }
  return number;
}

function lockDocumentId(environment, pointOfSale, voucherType) {
  const environmentId = String(environment || "").trim().toLowerCase();
  if (!["homologation", "production"].includes(environmentId)) {
    const error = new Error("Entorno inválido para lock fiscal.");
    error.code = "arca-sequence-lock-environment-invalid";
    throw error;
  }
  return `${environmentId}_pos_${positiveInteger(pointOfSale, "Punto de venta")}_type_${positiveInteger(voucherType, "Tipo de comprobante")}`;
}

function lockPath(environment, pointOfSale, voucherType) {
  return `arcaSequenceLocks/${lockDocumentId(environment, pointOfSale, voucherType)}`;
}

function iso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function expired(lock, now) {
  const expiresAt = Date.parse(lock?.leaseExpiresAt || "");
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

export async function acquireSequenceLock({
  pointOfSale,
  voucherType,
  holder,
  leaseMs = 60000,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  createDocument = adminCreateDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  const cleanHolder = String(holder || "").trim();
  if (!cleanHolder) {
    const error = new Error("Falta identificar el intento de autorización.");
    error.code = "arca-sequence-lock-holder-missing";
    throw error;
  }

  const environment = arcaEnvironment(env).id;
  const documentId = lockDocumentId(environment, pointOfSale, voucherType);
  const path = lockPath(environment, pointOfSale, voucherType);
  const leaseExpiresAt = iso(new Date(now.getTime() + Number(leaseMs || 60000)));
  const current = await getDocument(path, { env });

  if (!current) {
    try {
      const created = await createDocument("arcaSequenceLocks", documentId, {
        environment,
        pointOfSale: Number(pointOfSale),
        voucherType: Number(voucherType),
        holder: cleanHolder,
        leaseExpiresAt,
        createdAt: iso(now),
        updatedAt: iso(now),
      }, { env });
      return {
        acquired: true,
        path,
        holder: cleanHolder,
        updateTime: created.updateTime || null,
        leaseExpiresAt,
      };
    } catch (error) {
      if (error?.code !== "firebase-admin-already-exists") throw error;
      return {
        acquired: false,
        path,
        holder: null,
        updateTime: null,
        leaseExpiresAt: null,
        reason: "concurrent-create",
      };
    }
  }

  const data = current.data || {};
  if (data.holder && data.holder !== cleanHolder && !expired(data, now)) {
    return {
      acquired: false,
      path,
      holder: data.holder,
      updateTime: current.updateTime || null,
      leaseExpiresAt: data.leaseExpiresAt || null,
      reason: "busy",
    };
  }

  try {
    const updated = await patchDocument(path, {
      holder: cleanHolder,
      leaseExpiresAt,
      updatedAt: iso(now),
    }, {
      env,
      currentUpdateTime: current.updateTime,
    });
    return {
      acquired: true,
      path,
      holder: cleanHolder,
      updateTime: updated.updateTime || null,
      leaseExpiresAt,
      reason: data.holder === cleanHolder ? "renewed" : "acquired",
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    return {
      acquired: false,
      path,
      holder: null,
      updateTime: null,
      leaseExpiresAt: null,
      reason: "concurrent-update",
    };
  }
}

export async function releaseSequenceLock({
  pointOfSale,
  voucherType,
  holder,
  expectedUpdateTime,
  env = process.env,
  now = new Date(),
  getDocument = adminGetDocument,
  patchDocument = adminPatchDocument,
} = {}) {
  const environment = arcaEnvironment(env).id;
  const path = lockPath(environment, pointOfSale, voucherType);
  const current = await getDocument(path, { env });
  if (!current) return { released: true, reason: "missing" };

  if (current.data?.holder !== holder) {
    return {
      released: false,
      reason: "not-holder",
      holder: current.data?.holder || null,
    };
  }

  try {
    const updated = await patchDocument(path, {
      holder: null,
      leaseExpiresAt: null,
      updatedAt: iso(now),
    }, {
      env,
      currentUpdateTime: expectedUpdateTime || current.updateTime,
    });
    return {
      released: true,
      reason: "released",
      updateTime: updated.updateTime || null,
    };
  } catch (error) {
    if (error?.code !== "firebase-admin-precondition-failed") throw error;
    return { released: false, reason: "concurrent-update" };
  }
}
