import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCommerceCatalog } from "./CommerceCatalogContext";
import { trackEvent } from "../utils/analytics";

const STORAGE_KEY = "flor-mia-cart-v2";
const STORAGE_VERSION = 2;
const CartContext = createContext(null);

function safeReadCart() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items.filter(
      (item) =>
        typeof item?.productId === "string"
        && Number.isInteger(item?.quantity)
        && item.quantity > 0
        && item.quantity <= 99,
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const { byId, resolveProduct, status: catalogStatus } = useCommerceCatalog();
  const [items, setItems] = useState(safeReadCart);
  const [isCartOpen, setCartOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          items: items.map(({ productId, quantity }) => ({ productId, quantity })),
        }),
      );
    } catch {
      setStatusMessage(
        "No pudimos guardar el carrito en este dispositivo. Podés seguir navegando.",
      );
    }
  }, [items]);

  const addItem = useCallback((candidate) => {
    const product = resolveProduct(candidate);
    if (!product) {
      setStatusMessage("Ese producto todavía no está vinculado al catálogo comercial.");
      return false;
    }
    if (product.commercialReady !== true || product.active === false) {
      setStatusMessage(`${product.name} todavía no está disponible para comprar.`);
      return false;
    }

    setItems((currentItems) => {
      const existing = currentItems.find((item) => item.productId === product.id);
      if (existing) {
        return currentItems.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: Math.min(item.quantity + 1, 99) }
            : item,
        );
      }
      return [...currentItems, { productId: product.id, quantity: 1 }];
    });

    setStatusMessage(`${product.name} se agregó al carrito.`);
    trackEvent("add_to_cart", {
      item_id: product.id,
      item_name: product.name,
      item_category: product.categoryId,
      price: product.price,
      quantity: 1,
    });
    return true;
  }, [resolveProduct]);

  const updateQuantity = useCallback((productId, quantity) => {
    const safeQuantity = Math.max(0, Math.min(Number(quantity) || 0, 99));
    setItems((currentItems) =>
      safeQuantity === 0
        ? currentItems.filter((item) => item.productId !== productId)
        : currentItems.map((item) =>
            item.productId === productId ? { ...item, quantity: safeQuantity } : item,
          ),
    );
  }, []);

  const removeItem = useCallback((productId) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.productId !== productId),
    );
    setStatusMessage("El producto se quitó del carrito.");
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setStatusMessage("Tu carrito quedó vacío.");
  }, []);

  const detailedItems = useMemo(
    () => items.map((item) => ({
      ...item,
      product: byId[item.productId] || null,
      price: byId[item.productId]?.price ?? null,
      categoryId: byId[item.productId]?.categoryId || "",
      lineId: item.productId,
    })),
    [byId, items],
  );

  const unitCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );

  const knownSubtotal = useMemo(
    () => detailedItems.reduce(
      (total, item) =>
        typeof item.price === "number" && item.product
          ? total + item.price * item.quantity
          : total,
      0,
    ),
    [detailedItems],
  );

  const hasPendingPrices = detailedItems.some(
    (item) => typeof item.price !== "number",
  );

  const hasUnavailableItems = detailedItems.some(
    (item) => !item.product || item.product.commercialReady !== true,
  );

  const value = useMemo(() => ({
    items: detailedItems,
    unitCount,
    knownSubtotal,
    hasPendingPrices,
    hasUnavailableItems,
    catalogStatus,
    isCartOpen,
    statusMessage,
    setStatusMessage,
    openCart: () => {
      setCartOpen(true);
      trackEvent("view_cart", { quantity: unitCount });
    },
    closeCart: () => setCartOpen(false),
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    storageKey: STORAGE_KEY,
    storageVersion: STORAGE_VERSION,
  }), [
    detailedItems,
    unitCount,
    knownSubtotal,
    hasPendingPrices,
    hasUnavailableItems,
    catalogStatus,
    isCartOpen,
    statusMessage,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
  ]);

  return (
    <CartContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {statusMessage}
      </div>
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart debe usarse dentro de CartProvider");
  return context;
}
