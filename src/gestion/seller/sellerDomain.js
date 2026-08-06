export const SELLER_VIEWS = [
  { id: "sale", label: "Nueva venta", icon: "ShoppingCart" },
  { id: "sales", label: "Mis ventas", icon: "ReceiptText" },
  { id: "pending", label: "Pendientes", icon: "RefreshCw" },
  { id: "stock", label: "Stock", icon: "Boxes" },
  { id: "prices", label: "Precios", icon: "BadgeDollarSign" },
  { id: "help", label: "Ayuda", icon: "CircleHelp" },
];

export const SELLER_ACTION_SHORTCUTS = [
  { id: "paymentCredit", label: "Pago crédito", paymentMethod: "credit" },
  { id: "paymentDebit", label: "Pago débito", paymentMethod: "debit" },
  { id: "paymentAlias", label: "Pago alias", paymentMethod: "alias" },
  { id: "paymentCash", label: "Pago efectivo", paymentMethod: "cash" },
];

export const sellerImage = (item = {}) =>
  item.thumbUrl || item.imageUrl || "/images/flor-mia/logo-flor-mia.svg";

export function visibleSellerProducts(stock = []) {
  return stock.filter((item) =>
    item?.active !== false &&
    item?.deleted !== true &&
    item?.productDeleted !== true,
  );
}

export function groupSellerProducts(stock = [], categories = []) {
  const visibleCategories = [...categories]
    .filter((category) => category?.active !== false && category?.deleted !== true)
    .sort((a, b) =>
      Number(a.sortOrder || 0) - Number(b.sortOrder || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""), "es"),
    );
  const groups = visibleCategories.map((category) => ({
    id: category.id,
    name: category.name,
    items: [],
  }));
  const byId = new Map(groups.map((group) => [group.id, group]));
  const uncategorized = { id: "__uncategorized", name: "Sin categoría", items: [] };
  visibleSellerProducts(stock).forEach((item) => {
    const group = byId.get(item.categoryId) || uncategorized;
    group.items.push(item);
  });
  const result = groups.filter((group) => group.items.length);
  if (uncategorized.items.length) result.push(uncategorized);
  result.forEach((group) => group.items.sort((a, b) =>
    String(a.productName || a.name || "").localeCompare(
      String(b.productName || b.name || ""),
      "es",
    ),
  ));
  return result;
}

export function keyIdentity(item = {}) {
  return {
    key: item.key ?? item.buttonKey ?? item.discountKey ?? "",
    code: item.code ?? item.buttonCode ?? item.discountCode ?? "",
    location: Number(
      item.location ?? item.buttonLocation ?? item.discountLocation ?? 0,
    ),
  };
}

export function keyMatchesEvent(item, event) {
  const identity = keyIdentity(item);
  if (!identity.key && !identity.code) return false;
  if (identity.location !== Number(event.location || 0)) return false;
  return Boolean(
    (identity.code && identity.code === event.code) ||
    (identity.key && identity.key === event.key),
  );
}

export function cartItems(cart = {}) {
  return Object.values(cart).filter((item) => Number(item.qty || 0) > 0);
}

export function cartSubtotal(cart = {}) {
  return cartItems(cart).reduce(
    (sum, item) => sum + Number(item.price || item.unitPrice || 0) * Number(item.qty || 0),
    0,
  );
}

export function cartQuantity(cart = {}) {
  return cartItems(cart).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}

export function pendingReservedQuantities(pendingSales = [], locationId = "") {
  const reserved = {};
  pendingSales
    .filter((sale) => sale.locationId === locationId && sale.status !== "synced")
    .forEach((sale) => {
      (sale.items || []).forEach((item) => {
        reserved[item.productId] = Number(reserved[item.productId] || 0) + Number(item.qty || 0);
      });
    });
  return reserved;
}

export function sellerStockStatus(item = {}) {
  const stock = Number(item.currentStock || 0);
  const red = Number(item.redAlertQty || 0);
  const yellow = Number(item.yellowAlertQty || 0);
  if (stock <= red) return { label: "Alerta roja", tone: "error" };
  if (stock <= yellow) return { label: "Alerta amarilla", tone: "warning" };
  return { label: "Stock normal", tone: "success" };
}

export const isEditableTarget = (target) => Boolean(
  target?.matches?.("input, textarea, select, [contenteditable='true']") ||
  target?.isContentEditable,
);
