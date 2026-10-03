import { buildCustomerDraft, customerDocumentId, customerEnrichment, isValidCustomerPhone, normalizeCustomerPhone } from "../../../../src/gestion/customers/customerDomain.js";

// La transacción comercial llama a este adaptador antes del commit. No toca
// datos fiscales, precio, pago, inventario ni identidad del usuario de ecommerce.
export async function prepareCommerceCustomer({ customer, saleId, timestamp, getDocument, env }) {
  const normalized = normalizeCustomerPhone(customer.phone);
  if (!isValidCustomerPhone(normalized)) return { customerId: null, customerPhoneNormalized: normalized, operations: [], crmLinkStatus: "phone_requires_review" };
  const draft = buildCustomerDraft({ phone: customer.phone, name: customer.fullName });
  const customerId = await customerDocumentId(normalized), path = `customers/${customerId}`;
  const previous = await getDocument(path, { env });
  const stored = previous?.data;
  if (stored?.deleted === true || stored?.active === false) return { customerId, customerPhoneNormalized: normalized, operations: [], crmLinkStatus: "existing_inactive" };
  const patch = customerEnrichment(stored || {}, draft).patch;
  const previousPurchase = stored?.lastPurchaseAt ? new Date(stored.lastPurchaseAt) : null;
  const latest = !previousPurchase || timestamp >= previousPurchase;
  const data = stored ? { ...patch, ...(latest ? { lastSaleId: saleId, lastPurchaseAt: timestamp } : {}), updatedAt: timestamp, updatedBy: "ecommerce-backend" } : {
    ...draft, customerKey: customerId, active: true, deleted: false, source: "ecommerce", createdBy: "ecommerce-backend", createdAt: timestamp, updatedAt: timestamp, lastSaleId: saleId, lastPurchaseAt: timestamp,
  };
  const operations = [{ type: stored ? "update" : "create", path, data, ...(previous?.updateTime ? { currentUpdateTime: previous.updateTime } : {}) }];
  if (!stored || Object.keys(patch).length) operations.push({ type: "create", path: `auditLogs/crm_ecommerce_${saleId}`, data: { moduleId: "loyal-customers", action: stored ? "customer.updated" : "customer.created", entityId: customerId, entityType: "customer", userId: "ecommerce-backend", userName: "Ecommerce", description: stored ? "Campos vacíos completados desde la venta online" : "Cliente comercial asociado a venta online", changedFields: Object.keys(patch), sourceSaleId: saleId, createdAt: timestamp } });
  return { customerId, customerPhoneNormalized: normalized, crmLinkStatus: "linked", operations };
}
