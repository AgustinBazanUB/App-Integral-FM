import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { productById } from "../data/products";
import { trackEvent } from "../utils/analytics";

const STORAGE_KEY = "flor-mia-cart-v1";
const STORAGE_VERSION = 1;
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
        typeof item?.lineId === "string" &&
        typeof item?.productId === "string" &&
        Number.isInteger(item?.quantity) &&
        item.quantity > 0 &&
        productById[item.productId],
    );
  } catch {
    return [];
  }
}

function makeLineId(productId, format, variant) {
  return [productId, format ?? "", variant ?? ""].join("::");
}

export function CartProvider({ children }) {
  const [items, setItems] = useState(safeReadCart);
  const [isCartOpen, setCartOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, items }),
      );
    } catch {
      setStatusMessage(
        "No pudimos guardar el carrito en este dispositivo. Podés seguir navegando.",
      );
    }
  }, [items]);

  const addItem = useCallback((product, options = {}) => {
    const format = options.format ?? product.formats?.[0] ?? "";
    const variant =
      options.variant ??
      product.attributes?.variety ??
      product.attributes?.flavor ??
      "";
    const lineId = makeLineId(product.id, format, variant);

    setItems((currentItems) => {
      const existing = currentItems.find((item) => item.lineId === lineId);
      if (existing) {
        return currentItems.map((item) =>
          item.lineId === lineId
            ? { ...item, quantity: Math.min(item.quantity + 1, 99) }
            : item,
        );
      }

      return [
        ...currentItems,
        {
          lineId,
          productId: product.id,
          categoryId: product.categoryId,
          format,
          variant,
          quantity: 1,
          price: product.price,
          dataStatus: product.dataStatus,
        },
      ];
    });

    setStatusMessage(`${product.name} se agregó a tu selección.`);
    trackEvent("add_to_cart", {
      item_id: product.id,
      item_name: product.name,
      item_category: product.categoryId,
      item_variant: variant || format,
      price: product.price,
      quantity: 1,
    });
  }, []);

  const updateQuantity = useCallback((lineId, quantity) => {
    const safeQuantity = Math.max(0, Math.min(Number(quantity) || 0, 99));
    setItems((currentItems) =>
      safeQuantity === 0
        ? currentItems.filter((item) => item.lineId !== lineId)
        : currentItems.map((item) =>
            item.lineId === lineId ? { ...item, quantity: safeQuantity } : item,
          ),
    );
  }, []);

  const removeItem = useCallback((lineId) => {
    setItems((currentItems) =>
      currentItems.filter((item) => item.lineId !== lineId),
    );
    setStatusMessage("El producto se quitó de tu selección.");
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setStatusMessage("Tu selección quedó vacía.");
  }, []);

  const openCart = useCallback(() => {
    setCartOpen(true);
  }, []);

  const closeCart = useCallback(() => {
    setCartOpen(false);
  }, []);

  const detailedItems = useMemo(
    () =>
      items
        .map((item) => ({ ...item, product: productById[item.productId] }))
        .filter((item) => item.product),
    [items],
  );

  const unitCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  );

  const knownSubtotal = useMemo(
    () =>
      detailedItems.reduce(
        (total, item) =>
          typeof item.price === "number"
            ? total + item.price * item.quantity
            : total,
        0,
      ),
    [detailedItems],
  );

  const hasPendingPrices = detailedItems.some(
    (item) => typeof item.price !== "number",
  );

  const value = useMemo(
    () => ({
      items: detailedItems,
      unitCount,
      knownSubtotal,
      hasPendingPrices,
      isCartOpen,
      statusMessage,
      setStatusMessage,
      openCart: () => {
        openCart();
        trackEvent("view_cart", { quantity: unitCount });
      },
      closeCart,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      storageKey: STORAGE_KEY,
      storageVersion: STORAGE_VERSION,
    }),
    [
      detailedItems,
      unitCount,
      knownSubtotal,
      hasPendingPrices,
      isCartOpen,
      statusMessage,
      addItem,
      updateQuantity,
      removeItem,
      clearCart,
      openCart,
      closeCart,
    ],
  );

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
