import { randomUUID } from "node:crypto";
import {
  can,
  canAccessAdministration,
  effectiveSellerLocations,
} from "../../../../src/gestion/permissions.js";
import { saleActivitySnapshot } from "../../../../src/shared/activitySnapshots.mjs";
import {
  adminGetDocument,
  adminRunTransaction,
} from "../firestoreAdminRest.mjs";
import { arcaEnvironment, loadArcaPublicConfig } from "./config.mjs";
import { invoiceIdForEnvironment, invoiceIdFor } from "./billing.mjs";
import { buildAuthorizationPlan } from "./authorizationPlan.mjs";
import {
  authorizeInvoice,
  reconcileInvoice,
  verifyAuthorizedInvoice,
} from "./authorizer.mjs";

const fail = (message, code = "arca-sale-cancel-blocked", status = 409) =>
  Object.assign(new Error(message), { code, status, publicMessage: true });
export async function inspectSaleCancellation({
  saleId,
  session,
  env = process.env,
  getDocument = adminGetDocument,
  now = new Date(),
}) {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(saleId || ""))
    throw fail("Identificador de venta inválido.", "invalid-argument", 400);
  const document = await getDocument(`sales/${saleId}`, { env }),
    sale = document?.data;
  checkSale(sale, session);
  const sourceType = sale.sourceType || "seller_sale";
  const originalId =
    sale.fiscalInvoiceId ||
    sale.fiscalInvoice?.id ||
    invoiceIdForEnvironment(arcaEnvironment(env).id, sourceType, saleId);
  const original = (await getDocument(`invoices/${originalId}`, { env }))?.data;
  if ((sale.fiscalInvoiceId || sale.fiscalInvoice) && !original)
    throw fail("No se pudo localizar la factura asociada.");
  if (
    original &&
    (original.sourceId !== saleId ||
      original.sourceType !== sourceType ||
      (original.fiscalEnvironment || "homologation") !==
        arcaEnvironment(env).id)
  )
    throw fail("El vínculo fiscal requiere revisión.");
  if (original?.status === "authorized") {
    const plan = buildAuthorizationPlan({
      invoice: {
        ...original,
        status: "pending",
        documentKind: "credit_note",
        fiscalReadiness: { ready: true },
        associatedInvoice: {
          id: originalId,
          issuerCuit: original.issuerCuit,
          authorization: original.authorization,
          verification: original.verification,
        },
      },
      voucherDate: now,
    });
    return {
      canCancel: sale.status === "active",
      willCreateCreditNote: true,
      creditNote: {
        voucherType: plan.voucherType,
        voucherClass: plan.voucherClass,
        total: plan.fiscal.total,
      },
      readOnly: true,
    };
  }
  return {
    canCancel:
      sale.status === "active" &&
      (!original ||
        (["pending", "rejected", "cancelled", "error"].includes(
          original.status,
        ) &&
          !original.authorization?.voucherNumber)),
    willCreateCreditNote: false,
    readOnly: true,
  };
}

function checkSale(sale, session) {
  if (!sale) throw fail("La venta no existe.", "arca-sale-not-found", 404);
  if (sale.shipmentId) throw fail("Esta venta tiene un envío vinculado. Resolvé la logística y registrá por separado los movimientos de stock y la anulación financiera supervisada.", "shipping-cancellation-review");
  if (sale.sourceType === "ecommerce")
    throw fail("Esta venta se anula desde el módulo de pedidos.");
  const admin = canAccessAdministration(session.profile);
  if (
    (!can(session.profile, "quick-sales", "cancelOwn") && !admin) ||
    (!admin && sale.sellerId !== session.uid)
  )
    throw fail(
      "No tenés permiso para anular esta venta.",
      "permission-denied",
      403,
    );
}
async function stockDocuments(sale, transaction, env) {
  const type = sale.stockOriginType || "location",
    id = sale.stockOriginId || sale.locationId;
  if (
    !["location", "warehouse"].includes(type) ||
    !/^[A-Za-z0-9_-]+$/.test(id || "")
  )
    throw fail("La venta no tiene un origen de stock válido.");
  if (
    !Array.isArray(sale.items) ||
    !sale.items.length ||
    sale.items.length > 100
  )
    throw fail("Los productos de la venta necesitan revisión.");
  const origin = await transaction.getDocument(
    `${type === "location" ? "locations" : "warehouses"}/${id}`,
    { env },
  );
  if (!origin?.data || origin.data.deleted === true)
    throw fail("La ubicación de la venta no está disponible.");
  const stocks = [];
  for (const item of sale.items) {
    if (
      !/^[A-Za-z0-9_-]+$/.test(item.productId || "") ||
      !Number.isInteger(Number(item.qty)) ||
      Number(item.qty) <= 0 ||
      stocks.some((stock) => stock.productId === item.productId)
    )
      throw fail("Los productos de la venta necesitan revisión.");
    const path = `${type === "location" ? "locationStock" : "warehouseStock"}/${id}/items/${item.productId}`;
    const document = await transaction.getDocument(path, { env });
    if (!document?.data || !Number.isFinite(Number(document.data.currentStock)))
      throw fail(`Falta el stock de ${item.name || "un producto"}.`);
    stocks.push({ path, document, productId: item.productId, item, type, id });
  }
  return { stocks, origin: { id, ...origin.data }, type };
}

export async function cancelSaleAndInvoice({
  saleId,
  reason = "",
  session,
  env = process.env,
  now = new Date(),
  runTransaction = adminRunTransaction,
  getDocument = adminGetDocument,
  authorize = authorizeInvoice,
  reconcile = reconcileInvoice,
  verify = verifyAuthorizedInvoice,
}) {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(saleId || ""))
    throw fail("Identificador de venta inválido.", "invalid-argument", 400);
  const stamp = now.toISOString(),
    safeReason = String(reason || "")
      .trim()
      .slice(0, 500);
  const salePath = `sales/${saleId}`;
  const reserved = await runTransaction(
    async (transaction) => {
      const saleDoc = await transaction.getDocument(salePath, { env });
      const sale = saleDoc?.data;
      checkSale(sale, session);
      if (sale.status === "cancelled") return { completed: true, sale };
      if (sale.status !== "active") throw fail("La venta no está activa.");
      const stock = await stockDocuments(sale, transaction, env);
      if (
        !canAccessAdministration(session.profile) &&
        (stock.type !== "location" ||
          !effectiveSellerLocations(session.profile, [stock.origin]).length)
      )
        throw fail(
          "No tenés permiso sobre la ubicación de la venta.",
          "permission-denied",
          403,
        );
      const sourceType = sale.sourceType || "seller_sale";
      const originalId =
        sale.fiscalInvoiceId ||
        sale.fiscalInvoice?.id ||
        invoiceIdForEnvironment(arcaEnvironment(env).id, sourceType, saleId);
      let originalDoc = await transaction.getDocument(
        `invoices/${originalId}`,
        { env },
      );
      let resolvedOriginalId = originalId;
      if (!originalDoc && arcaEnvironment(env).id === "homologation") {
        const legacyId = invoiceIdFor(sourceType, saleId);
        originalDoc = await transaction.getDocument(`invoices/${legacyId}`, {
          env,
        });
        if (originalDoc) resolvedOriginalId = legacyId;
      }
      const original = originalDoc?.data;
      if ((sale.fiscalInvoiceId || sale.fiscalInvoice) && !original)
        throw fail(
          "No se pudo localizar la factura asociada. La venta no se anuló.",
        );
      if (
        original &&
        (original.sourceId !== saleId ||
          original.sourceType !== sourceType ||
          original.documentKind === "credit_note" ||
          (original.fiscalEnvironment || "homologation") !==
            arcaEnvironment(env).id)
      )
        throw fail(
          "El vínculo fiscal requiere revisión. La venta no se anuló.",
        );
      if (
        original &&
        (["authorizing", "reconciling"].includes(original.status) ||
          (original.authorization?.voucherNumber &&
            !["authorized", "rejected", "cancelled"].includes(original.status)))
      )
        throw fail(
          "La factura está pendiente de confirmación en ARCA. Actualizá su estado antes de anular la venta.",
          "arca-cancellation-needs-reconciliation",
        );
      const operations = [];
      let creditNoteId = null;
      if (original?.status === "authorized") {
        if (
          original.verification?.matched !== true ||
          !original.authorization?.requestSnapshot ||
          !original.authorization?.cae
        )
          throw fail(
            "Primero verificá la factura original en ARCA.",
            "arca-credit-original-invalid",
          );
        const config = loadArcaPublicConfig(env);
        if (
          original.issuerCuit !== config.issuerCuit ||
          Number(original.authorization.pointOfSale) !== config.pointOfSale
        )
          throw fail(
            "La factura pertenece a otro emisor o punto de venta.",
            "arca-credit-original-invalid",
          );
        creditNoteId = `${resolvedOriginalId}_credit_full`;
      if (original.creditNoteId && original.creditNoteId !== creditNoteId) throw fail('La factura ya tiene otra nota de crédito asociada. Requiere revisión antes de anular.','arca-credit-already-associated');
        const existing = await transaction.getDocument(
          `invoices/${creditNoteId}`,
          { env },
        );
        if (
          existing &&
          (existing.data.originalInvoiceId !== resolvedOriginalId ||
            existing.data.sourceId !== saleId ||
            existing.data.documentKind !== "credit_note")
        )
          throw fail("La nota de crédito asociada requiere revisión.");
        if (!existing)
          operations.push({
            type: "create",
            path: `invoices/${creditNoteId}`,
            data: {
              schemaVersion: 2,
              billingVersion: original.billingVersion || null,
              documentKind: "credit_note",
              originalInvoiceId: resolvedOriginalId,
              fiscalEnvironment: original.fiscalEnvironment,
              issuerCuit: original.issuerCuit,
              pointOfSaleSnapshot: original.authorization.pointOfSale,
              sourceType,
              sourceId: saleId,
              status: "pending",
              createdAt: stamp,
              updatedAt: stamp,
              requestedAt: stamp,
              requestedBy: session.uid,
              requestedByName: session.profile.name || session.email || null,
              fiscalReadiness: { ready: true },
              saleSnapshot: original.saleSnapshot,
              productFiscalSnapshot: original.productFiscalSnapshot || [],
              receiverSnapshot: original.receiverSnapshot,
              associatedInvoice: {
                id: resolvedOriginalId,
                issuerCuit: original.issuerCuit,
                authorization: original.authorization,
                verification: original.verification,
              },
              authorization: {},
              error: null,
            },
          });
      } else if (original && original.status !== "cancelled") {
        operations.push({
          type: "update",
          path: `invoices/${resolvedOriginalId}`,
          currentUpdateTime: originalDoc.updateTime,
          data: { status: "cancelled", cancelledAt: stamp, updatedAt: stamp },
        });
      }
      const previous = sale.fiscalCancellation;
      if (previous && previous.creditNoteId !== creditNoteId)
        throw fail("Ya hay una anulación fiscal diferente en curso.");
      const cancellation = previous || {
        status: "pending",
        creditNoteId,
        originalInvoiceId: original ? resolvedOriginalId : null,
        requestedBy: session.uid,
        requestedByName: session.profile.name || session.email || null,
        reason: safeReason,
        requestedAt: stamp,
      };
      operations.push({
        type: "update",
        path: salePath,
        currentUpdateTime: saleDoc.updateTime,
        data: { fiscalCancellation: cancellation, updatedAt: stamp },
      });
      await transaction.commitDocuments(operations);
      return { completed: false, creditNoteId, sale };
    },
    { env },
  );
  if (reserved.completed)
    return {
      id: saleId,
      saleCode: reserved.sale.saleCode,
      status: "cancelled",
      alreadyCancelled: true,
      creditNoteId: reserved.sale.fiscalCancellation?.creditNoteId || null,
    };
  let credit = null;
  if (reserved.creditNoteId) {
    let current = await getDocument(`invoices/${reserved.creditNoteId}`, {
      env,
    });
    if (
      current?.data?.status === "reconciling" ||
      (current?.data?.status === "authorizing" &&
        current.data.authorization?.voucherNumber)
    )
      await reconcile({ invoiceId: reserved.creditNoteId, env });
    const result = await authorize({
      invoiceId: reserved.creditNoteId,
      issuerVatCondition: env.ARCA_ISSUER_VAT_CONDITION,
      receiver: { requestedBy: session.uid },
      allowCaeRequest: true,
      automaticRequest: true,
      env,
      now,
    });
    if (result.status !== "authorized")
      throw fail(
        "La nota de crédito todavía no está autorizada. La venta sigue activa; podés consultar nuevamente sin duplicar comprobantes.",
        "arca-credit-not-authorized",
      );
    const checked = await verify({
      invoiceId: reserved.creditNoteId,
      env,
      now,
    });
    if (checked.matched !== true)
      throw fail(
        "La nota de crédito espera verificación en ARCA. La venta sigue activa.",
        "arca-credit-not-verified",
      );
    current = await getDocument(`invoices/${reserved.creditNoteId}`, { env });
    credit = current?.data;
    if (
      credit?.status !== "authorized" ||
      credit.verification?.matched !== true
    )
      throw fail(
        "No se pudo verificar la nota de crédito. La venta sigue activa.",
        "arca-credit-not-verified",
      );
  }
  return runTransaction(
    async (transaction) => {
      const saleDoc = await transaction.getDocument(salePath, { env });
      const sale = saleDoc?.data;
      checkSale(sale, session);
      if (sale.status === "cancelled")
        return {
          id: saleId,
          saleCode: sale.saleCode,
          status: "cancelled",
          alreadyCancelled: true,
          creditNoteId: sale.fiscalCancellation?.creditNoteId || null,
        };
      if (
        !sale.fiscalCancellation ||
        sale.fiscalCancellation.creditNoteId !== reserved.creditNoteId
      )
        throw fail("La anulación cambió antes de terminar.");
      const { stocks } = await stockDocuments(sale, transaction, env);
      const operations = stocks.flatMap(
        ({ path, document, item, type, id }, index) => {
          const movementId = randomUUID(),
            previousStock = Number(document.data.currentStock),
            newStock = previousStock + Number(item.qty);
          return [
            {
              type: "update",
              path,
              currentUpdateTime: document.updateTime,
              data: {
                currentStock: newStock,
                lastSaleId: saleId,
                lastMovementId: movementId,
                updatedAt: stamp,
              },
            },
            {
              type: "create",
              path: `stockMovements/${movementId}`,
              data: {
                locationId: type === "location" ? id : null,
                locationName: sale.locationName || null,
                warehouseId: type === "warehouse" ? id : null,
                stockOriginType: type,
                stockOriginId: id,
                productId: item.productId,
                productName: item.name || "",
                type: "sale_cancel",
                qty: Number(item.qty),
                previousStock,
                newStock,
                reason: `Anulación ${sale.saleCode}${sale.fiscalCancellation.reason ? ": " + sale.fiscalCancellation.reason : ""}`,
                userId: session.uid,
                userName: session.profile.name || session.email || "",
                saleId,
                saleItemIndex: -1,
                previousSaleItemIndex: index,
                createdAt: stamp,
              },
            },
          ];
        },
      );
      const cancellation = {
        ...sale.fiscalCancellation,
        status: "completed",
        completedAt: stamp,
        ...(credit
          ? {
              authorization: credit.authorization,
              verification: credit.verification,
            }
          : {}),
      };
      operations.push({
        type: "update",
        path: salePath,
        currentUpdateTime: saleDoc.updateTime,
        data: {
          status: "cancelled",
          cancelledAt: stamp,
          cancelledBy: cancellation.requestedBy,
          cancelledByName: cancellation.requestedByName,
          cancelReason: cancellation.reason,
          fiscalCancellation: cancellation,
          ...(sale.ticketRequested ? { ticketStatus: "cancelled" } : {}),
          updatedAt: stamp,
        },
      });
      if (credit) {
        const original = await transaction.getDocument(
          `invoices/${cancellation.originalInvoiceId}`,
          { env },
        );
        if (!original?.data || original.data.sourceId !== saleId)
          throw fail("La factura original no coincide con la anulación.");
        operations.push({
          type: "update",
          path: `invoices/${cancellation.originalInvoiceId}`,
          currentUpdateTime: original.updateTime,
          data: {
            creditNoteId: reserved.creditNoteId,
            creditedAt: stamp,
            updatedAt: stamp,
          },
        });
      }
      operations.push({
        type: "create",
        path: `auditLogs/${randomUUID()}`,
        data: {
          action: "sale.cancelled",
          title: "Venta anulada",
          description: `${sale.saleCode}${cancellation.reason ? " · " + cancellation.reason : ""}`,
          moduleId: "quick-sales",
          entityType: "sale",
          entityId: saleId,
          locationId: sale.locationId || null,
          locationName: sale.locationName || null,
          userId: session.uid,
          userName: session.profile.name || session.email || "",
          status: "cancelled",
          amount: Number(sale.total),
          detailSnapshot: saleActivitySnapshot({
            ...sale,
            status: "cancelled",
            cancelReason: cancellation.reason,
          }),
          creditNoteId: reserved.creditNoteId,
          createdAt: stamp,
        },
      });
      await transaction.commitDocuments(operations);
      return {
        id: saleId,
        saleCode: sale.saleCode,
        status: "cancelled",
        creditNoteId: reserved.creditNoteId,
      };
    },
    { env },
  );
}
