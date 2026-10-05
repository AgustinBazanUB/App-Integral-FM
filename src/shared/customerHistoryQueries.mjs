import { normalizeCustomerPhone } from "../gestion/customers/customerDomain.js";

// Shared identity/phone query groups for manual CRM and Olivia history.
export function customerHistoryGroups(customer, identities) {
  const ids = [...new Set(identities || [customer.id, ...(customer.previousCustomerIds || []), customer.migratedFromCustomerId].filter(Boolean))];
  const groups = Array.from({ length: Math.ceil(ids.length / 10) }, (_, index) => ({ key: `id:${index}`, field: "customerId", values: ids.slice(index * 10, index * 10 + 10) }));
  const phone = normalizeCustomerPhone(customer.phoneNormalized || customer.phone);
  const phones = phone ? [...new Set([customer.phone, phone, `+54${phone}`, `+549${phone}`, `54${phone}`, `549${phone}`].filter(Boolean))] : [];
  if (phones.length) groups.push({ key: "phone", field: "customerPhoneSnapshot", values: phones });
  return groups;
}
