import { createHash } from "node:crypto";
import { adminRunTransaction } from "../firestoreAdminRest.mjs";
import {
  commerceError,
  currentStockQuantity,
  normalizeEcommerceRequestId,
} from "./commerceDomain.mjs";
import {
  WEB_CHANNEL_ID,
  checkedOrigin,
  loadWebChannel,
  originStockPath,
  resolveChannelOrigin,
} from "./channelService.mjs";
import {
  reservationPatch,
  reservedStockQuantity,
} from "../../../../src/shared/stockReservations.mjs";
import { canAccessAdministration } from "../../../../src/gestion/permissions.js";

const fail = (message, status = 409) => {
  throw commerceError("ecommerce-management-blocked", message, status);
};
const id = (value) => {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(value || ""))
    fail("Identificador inválido.", 400);
  return value;
};
export async function configureWebChannel({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ channel: body.channel, actor: session.uid }))
    .digest("hex");
  return runTransaction(
    async (transaction) => {
      const profile = (await transaction.getDocument(`users/${session.uid}`))
        ?.data;
      if (!profile?.active || !canAccessAdministration(profile))
        fail("Sólo administración puede configurar el canal.", 403);
      const receiptPath = `ecommerceOperations/channel_${requestId}`,
        receipt = (await transaction.getDocument(receiptPath))?.data;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail("El intento corresponde a otra configuración.");
        return receipt.result;
      }
      const previous = await transaction.getDocument(
        `channels/${WEB_CHANNEL_ID}`,
      );
      const channel = body.channel || {};
      const authorizedOrigins = (channel.authorizedOrigins || []).map(
        checkedOrigin,
      );
      if (!authorizedOrigins.length || authorizedOrigins.length > 20)
        fail("Habilitá entre uno y veinte orígenes.", 400);
      const candidate = { ...channel, authorizedOrigins };
      const origin = await resolveChannelOrigin(
        candidate,
        checkedOrigin(channel.defaultOrigin),
        { env, getDocument: transaction.getDocument },
      );
      for (const entry of authorizedOrigins)
        await resolveChannelOrigin(candidate, entry, {
          env,
          getDocument: transaction.getDocument,
        });
      const pickup = {
        enabled: channel.pickup?.enabled === true,
        locationId: String(channel.pickup?.locationId || ""),
        name: String(channel.pickup?.name || "")
          .trim()
          .slice(0, 150),
        address: String(channel.pickup?.address || "")
          .trim()
          .slice(0, 300),
      };
      if (pickup.enabled) {
        const point = (
          await transaction.getDocument(`locations/${id(pickup.locationId)}`)
        )?.data;
        if (
          !point ||
          point.active === false ||
          point.deleted === true ||
          !pickup.address
        )
          fail("Elegí un punto de retiro real y su dirección.", 400);
        pickup.name = point.name;
      }
      const rates = (channel.delivery?.rates || []).map((rate) => {
        if (
          !String(rate.province || "").trim() ||
          !Array.isArray(rate.postalCodes) ||
          !rate.postalCodes.length ||
          rate.postalCodes.length > 200 ||
          !Number.isSafeInteger(rate.amount) ||
          rate.amount < 0
        )
          fail(
            "Cada tarifa necesita provincia, códigos postales e importe entero en ARS.",
            400,
          );
        if (rate.amount > 0 && ![0, 10.5, 21, 27].includes(rate.arcaVatRate))
          fail("Configurá el IVA de cada tarifa con importe.", 400);
        return {
          id: id(rate.id),
          name: String(rate.name || rate.province)
            .trim()
            .slice(0, 100),
          province: String(rate.province).trim().slice(0, 100),
          postalCodes: [
            ...new Set(
              rate.postalCodes.map((code) => String(code).trim().toUpperCase()),
            ),
          ],
          amount: rate.amount,
          arcaVatRate: rate.arcaVatRate ?? null,
          active: rate.active !== false,
        };
      });
      if (
        rates.length > 30 ||
        new Set(rates.map((rate) => rate.id)).size !== rates.length ||
        (channel.delivery?.enabled && !rates.length)
      )
        fail("Configurá tarifas distintas antes de habilitar envíos.", 400);
      const defaultTransport = channel.defaultTransport || "repository";
      if (!["repository", "uber", "manual"].includes(defaultTransport))
        fail("Elegí un transporte predeterminado válido.", 400);
      const authorizedUserIds = [
        ...new Set((channel.authorizedUserIds || []).map(id)),
      ];
      if (authorizedUserIds.length > 100)
        fail("El canal admite hasta cien usuarios autorizados.", 400);
      for (const uid of authorizedUserIds) {
        const user = (await transaction.getDocument(`users/${uid}`))?.data;
        if (!user?.active || !canAccessAdministration(user))
          fail(
            "Un usuario autorizado no está activo o no tiene acceso administrativo.",
            400,
          );
      }
      const data = {
        schemaVersion: 1,
        name: "Página web / E-commerce Flor Mía",
        type: "ecommerce",
        active: channel.active === true,
        authorizedOrigins,
        defaultTransport,
        defaultOrigin: { type: origin.type, id: origin.id },
        authorizedUserIds,
        pickup,
        delivery: { enabled: channel.delivery?.enabled === true, rates },
        updatedAt: now,
        updatedBy: session.uid,
        ...(!previous ? { createdAt: now } : {}),
      };
      const result = { id: WEB_CHANNEL_ID, ...data };
      await transaction.commitDocuments([
        {
          type: "create",
          path: receiptPath,
          data: { fingerprint, result, createdAt: now },
        },
        {
          type: previous ? "update" : "create",
          path: `channels/${WEB_CHANNEL_ID}`,
          data,
        },
        {
          type: "create",
          path: `auditLogs/web_channel_${requestId}`,
          data: {
            moduleId: "ecommerce",
            action: "channel.configured",
            entityId: WEB_CHANNEL_ID,
            userId: session.uid,
            description: "Configuración del canal; sin inventario propio",
            createdAt: now,
          },
        },
      ]);
      return result;
    },
    { env },
  );
}

export async function manageWebOrder({
  body,
  session,
  env = process.env,
  runTransaction = adminRunTransaction,
  now = new Date(),
}) {
  const requestId = normalizeEcommerceRequestId(body.requestId),
    orderId = id(body.orderId);
  return runTransaction(
    async (transaction) => {
      const profile = (await transaction.getDocument(`users/${session.uid}`))
        ?.data;
      if (!profile?.active || !canAccessAdministration(profile))
        fail("Sólo administración puede modificar pedidos web.", 403);
      const receiptPath = `ecommerceOperations/${requestId}`;
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            mode: body.mode,
            orderId,
            origin: body.origin || null,
            reason: body.reason,
            actor: session.uid,
          }),
        )
        .digest("hex");
      const receipt = (await transaction.getDocument(receiptPath))?.data;
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail("El intento corresponde a otra operación.");
        return receipt.result;
      }
      const snapshot = await transaction.getDocument(`orders/${orderId}`),
        order = snapshot?.data;
      if (!order?.channelId)
        fail("El pedido no pertenece al canal configurado.");
      const reason = String(body.reason || "")
        .trim()
        .slice(0, 1000);
      if (reason.length < 4)
        fail("Indicá un motivo de al menos cuatro caracteres.", 400);
      const oldOrigin = {
        type: order.stockOriginType,
        id: order.stockOriginId,
        name: order.stockOriginName,
      };
      const paid = ["approved", "simulated_approved"].includes(
        order.paymentStatus,
      );
      const operations = [],
        changes = { updatedAt: now };
      if (body.mode === "origin") {
        const channel = await loadWebChannel({
          env,
          getDocument: transaction.getDocument,
        });
        const origin = await resolveChannelOrigin(channel, body.origin, {
          env,
          getDocument: transaction.getDocument,
        });
        if (origin.id === oldOrigin.id && origin.type === oldOrigin.type)
          fail("El origen elegido ya está asignado.");
        if (order.status !== (paid ? "confirmed" : "pending_payment"))
          fail("El pedido ya no admite cambios de origen.");
        if (
          !paid &&
          (order.reservationStatus !== "active" ||
            new Date(order.reservationExpiresAt) <= now)
        )
          fail("La reserva venció; creá un nuevo pedido.");
        let shipment;
        if (paid) {
          shipment = (
            await transaction.getDocument(`shipments/${order.shipmentId}`)
          )?.data;
          if (
            !shipment ||
            shipment.status !== "aprobado" ||
            shipment.incident ||
            shipment.courierSessionId
          )
            fail(
              "Sólo se reasigna stock pagado antes de empezar la preparación.",
            );
        }
        for (const item of order.items) {
          const oldPath = originStockPath(oldOrigin, item.productId),
            newPath = originStockPath(origin, item.productId);
          const [oldStock, newStock] = await Promise.all([
            transaction.getDocument(oldPath),
            transaction.getDocument(newPath),
          ]);
          if (
            !oldStock?.data ||
            !newStock?.data ||
            newStock.data.active === false ||
            newStock.data.deleted === true ||
            newStock.data.productDeleted === true
          )
            fail(`${item.name}: el origen no tiene stock habilitado.`);
          const oldQty = currentStockQuantity(oldStock.data),
            newQty = currentStockQuantity(newStock.data);
          if (
            newQty - reservedStockQuantity(newStock.data, now) <
            item.quantity
          )
            fail(`${item.name}: stock insuficiente en ${origin.name}.`);
          if (!paid) {
            const hold = oldStock.data.ecommerceReservations?.[orderId];
            if (
              !hold ||
              hold.quantity !== item.quantity ||
              new Date(hold.expiresAt) <= now
            )
              fail("La reserva original no es consistente.");
            operations.push(
              {
                type: "update",
                path: oldPath,
                data: reservationPatch(oldStock.data, orderId, null, now),
              },
              {
                type: "update",
                path: newPath,
                data: reservationPatch(newStock.data, orderId, hold, now),
              },
            );
          } else {
            for (const [suffix, path, stock, originRef, delta] of [
              ["return", oldPath, oldQty, oldOrigin, item.quantity],
              ["out", newPath, newQty, origin, -item.quantity],
            ]) {
              const movementId = `web_origin_${requestId}_${createHash("sha256").update(item.productId).digest("hex").slice(0, 16)}_${suffix}`;
              operations.push(
                {
                  type: "update",
                  path,
                  data: {
                    currentStock: stock + delta,
                    lastMovementId: movementId,
                    updatedAt: now,
                  },
                },
                {
                  type: "create",
                  path: `stockMovements/${movementId}`,
                  data: {
                    sourceType: "ecommerce",
                    inventoryType: originRef.type,
                    inventoryId: originRef.id,
                    ...(originRef.type === "warehouse"
                      ? { warehouseId: originRef.id }
                      : { locationId: originRef.id }),
                    orderId,
                    saleId: order.saleId,
                    productId: item.productId,
                    type: "origin_reassignment",
                    qty: delta,
                    previousStock: stock,
                    newStock: stock + delta,
                    reason,
                    userId: session.uid,
                    simulated: order.simulated === true,
                    createdAt: now,
                  },
                },
              );
            }
          }
        }
        Object.assign(changes, {
          stockOriginType: origin.type,
          stockOriginId: origin.id,
          stockOriginName: origin.name,
          originHistory: [
            ...(order.originHistory || []),
            {
              from: oldOrigin,
              to: origin,
              reason,
              userId: session.uid,
              at: now,
              afterPayment: paid,
            },
          ],
        });
        if (!paid)
          Object.assign(changes, {
            locationId: origin.type === "location" ? origin.id : null,
            locationName: origin.name,
          });
        if (paid)
          operations.push({
            type: "update",
            path: `shipments/${order.shipmentId}`,
            data: {
              stockOriginType: origin.type,
              stockOriginId: origin.id,
              stockOriginName: origin.name,
              revision: (shipment.revision || 0) + 1,
              updatedAt: now,
            },
          });
      } else if (["cancel", "expire"].includes(body.mode)) {
        if (paid)
          fail(
            "La venta ya está registrada. Usá la gestión logística y la devolución comercial/fiscal correspondiente.",
          );
        if (order.status !== "pending_payment")
          fail("El pedido ya tiene estado final.");
        if (
          body.mode === "expire" &&
          new Date(order.reservationExpiresAt) > now
        )
          fail("La reserva aún no venció.");
        for (const item of order.items) {
          const path = originStockPath(oldOrigin, item.productId),
            stock = await transaction.getDocument(path);
          if (stock)
            operations.push({
              type: "update",
              path,
              data: reservationPatch(stock.data, orderId, null, now),
            });
        }
        Object.assign(changes, {
          status: body.mode === "expire" ? "expired" : "cancelled",
          reservationStatus: "released",
          paymentStatus: "cancelled",
        });
        operations.push({
          type: "update",
          path: `payments/${order.paymentId}`,
          data: { status: "cancelled", updatedAt: now },
        });
      } else fail("Operación inválida.", 400);
      const result = { id: orderId, ...changes };
      operations.push(
        { type: "update", path: `orders/${orderId}`, data: changes },
        {
          type: "create",
          path: receiptPath,
          data: { fingerprint, result, createdAt: now },
        },
        {
          type: "create",
          path: `auditLogs/web_manage_${requestId}`,
          data: {
            moduleId: "ecommerce",
            action: `order.${body.mode}`,
            entityId: orderId,
            userId: session.uid,
            description: reason,
            createdAt: now,
          },
        },
      );
      await transaction.commitDocuments(operations);
      return result;
    },
    { env },
  );
}
