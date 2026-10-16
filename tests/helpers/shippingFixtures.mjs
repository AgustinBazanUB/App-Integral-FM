export const now = new Date("2026-10-16T15:00:00Z");
export const admin = { id: "admin", name: "Administración QA", role: "admin", active: true };
export const seller = { id: "seller", name: "Vendedor QA", role: "seller", active: true, allowedLocationIds: ["valle"] };
export const preparer = { id: "preparer", name: "Preparación QA", role: "seller", active: true, allowedLocationIds: ["valle"] };
export const manager = { id: "manager", name: "Logística QA", role: "shipping_manager", active: true };
export const session = profile => ({ uid: profile.id, profile });
export const sale = (overrides = {}) => ({ location: { id: "valle" }, stockOrigin: { type: "location", id: "valle" }, channel: "whatsapp", items: [{ productId: "oil", name: "Aceite de prueba", qty: 2, unitPrice: 1000 }], discounts: [], paymentMethod: "cash", paymentMethodLabel: "Efectivo", payments: [], customer: { name: "Cliente de prueba", phone: "11 2345-6789" }, deliveryMethod: "shipping", shipping: { displayAddress: "Calle de prueba 123, CABA", notes: "Timbre de prueba", deliveryType: "manual", assignedPreparerIds: [preparer.id] }, ...overrides });
export function initialDocuments() {
  return new Map([
    ...[admin, seller, preparer, manager].map(user => [`users/${user.id}`, user]),
    ["locations/valle", { name: "Local Valle", active: true, codePrefix: "VAL" }],
    ["warehouses/infal", { name: "Depósito Infal", active: true }],
    ["products/oil", { name: "Aceite de prueba", active: true, defaultPrice: 1000 }],
    ["locationStock/valle/items/oil", { productId: "oil", active: true, currentStock: 10, price: 1000 }],
    ["warehouseStock/infal/items/oil", { productId: "oil", active: true, currentStock: 20 }],
  ]);
}
export function memoryStore() {
  const documents = initialDocuments();
  let queue = Promise.resolve();
  const runTransaction = work => {
    const execute = async () => {
      const writes = [];
      const result = await work({
        getDocument: async path => documents.has(path) ? { data: structuredClone(documents.get(path)) } : null,
        listDocuments: async path => [...documents].filter(([key]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(([key, data]) => ({ ...structuredClone(data), id: key.split("/").at(-1) })),
        commitDocuments: async operations => { for (const operation of operations) { if (operation.type === "create" && documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`); if (operation.type === "update" && !documents.has(operation.path)) throw new Error(`Missing: ${operation.path}`); writes.push(operation); } },
      });
      for (const operation of writes) documents.set(operation.path, structuredClone(operation.type === "update" ? { ...documents.get(operation.path), ...operation.data } : operation.data));
      return result;
    };
    const result = queue.then(execute); queue = result.catch(() => {}); return result;
  };
  return { documents, runTransaction };
}
