import { useRef } from "react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

function formatPrice(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function CartDrawer() {
  const {
    items,
    unitCount,
    knownSubtotal,
    isCartOpen,
    closeCart,
    updateQuantity,
    removeItem,
    addItem,
    hasPendingPrices,
    hasUnavailableItems,
  } = useCart();
  const { products } = useCommerceCatalog();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  useFocusTrap({
    active: isCartOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: closeCart,
  });

  if (!isCartOpen) return null;

  const firstCategory = items[0]?.product?.categoryId || null;
  const suggestion = products.find((product) =>
    product.commercialReady === true
    && product.categoryId !== firstCategory
    && !items.some((item) => item.productId === product.id));

  return (
    <div
      className="cart-layer"
      role="dialog"
      aria-modal="true"
      aria-label="Carrito"
      ref={dialogRef}
      tabIndex={-1}
    >
      <button
        type="button"
        className="cart-backdrop"
        onClick={closeCart}
        aria-label="Cerrar carrito"
      />
      <aside className="cart-drawer">
        <header className="cart-drawer__header">
          <div>
            <p className="eyebrow">TU CARRITO</p>
            <h2>Carrito <span>({unitCount})</span></h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="icon-button"
            onClick={closeCart}
            aria-label="Cerrar carrito"
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {items.length ? (
          <>
            <div className="cart-lines">
              {items.map((item) => (
                <article className="cart-line" key={item.productId}>
                  {item.product?.image ? (
                    <img src={item.product.image} alt="" width="72" height="90" />
                  ) : <span className="cart-line__image-placeholder" aria-hidden="true">FM</span>}
                  <div className="cart-line__content">
                    <span>{categoryById[item.categoryId]?.name || item.product?.categoryName}</span>
                    <h3>{item.product?.name || "Producto no disponible"}</h3>
                    <strong>
                      {typeof item.price === "number"
                        ? formatPrice(item.price)
                        : "Precio no disponible"}
                    </strong>
                    <div className="quantity-control">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                        aria-label={`Quitar una unidad de ${item.product?.name || "producto"}`}
                      >
                        <Minus size={16} aria-hidden="true" />
                      </button>
                      <span aria-label={`${item.quantity} unidades`}>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                        aria-label={`Agregar una unidad de ${item.product?.name || "producto"}`}
                        disabled={Number.isInteger(item.product?.stock) && item.quantity >= item.product.stock}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cart-line__remove"
                    onClick={() => removeItem(item.productId)}
                    aria-label={`Eliminar ${item.product?.name || "producto"}`}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>

            {suggestion ? (
              <div className="cart-suggestion">
                {suggestion.image ? <img src={suggestion.image} alt="" width="54" height="64" /> : null}
                <div>
                  <span>También puede acompañar</span>
                  <strong>{suggestion.name}</strong>
                </div>
                <button type="button" onClick={() => addItem(suggestion)} aria-label={`Agregar ${suggestion.name}`}>
                  <Plus size={17} aria-hidden="true" />
                  Agregar
                </button>
              </div>
            ) : null}

            <div className="cart-drawer__footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>{hasPendingPrices ? "No disponible" : formatPrice(knownSubtotal)}</strong>
              </div>
              {hasUnavailableItems ? (
                <p>Hay productos que cambiaron de disponibilidad. Revisalos antes de continuar.</p>
              ) : (
                <p>El backend vuelve a validar precio, stock y total antes de crear el pedido.</p>
              )}
              <Link
                className="button button--gold button--block"
                to="/checkout"
                onClick={closeCart}
                aria-disabled={hasPendingPrices || hasUnavailableItems}
              >
                Ir al checkout
              </Link>
              <button type="button" className="text-button" onClick={closeCart}>
                Seguir explorando
              </button>
            </div>
          </>
        ) : (
          <div className="cart-empty">
            <ShoppingBag size={38} aria-hidden="true" />
            <h3>Tu carrito está vacío.</h3>
            <p>Elegí productos del catálogo comercial para continuar.</p>
            <Link className="button" to="/productos" onClick={closeCart}>
              Explorar productos
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}
