import { useRef } from "react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { productById } from "../data/products";
import { useCart } from "../context/CartContext";
import { useFocusTrap } from "../hooks/useFocusTrap";

const suggestionByCategory = {
  olive_oil: "olives-selection",
  nuts: "oil-blend",
  olives: "salt-malbec",
  jams: "nuts-almonds",
  seasoned_salts: "oil-blend",
};

export default function CartDrawer() {
  const {
    items,
    unitCount,
    isCartOpen,
    closeCart,
    updateQuantity,
    removeItem,
    addItem,
    hasPendingPrices,
  } = useCart();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);

  useFocusTrap({
    active: isCartOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: closeCart,
  });

  if (!isCartOpen) return null;

  const suggestionId = items[0]
    ? suggestionByCategory[items[0].categoryId]
    : null;
  const suggestion =
    suggestionId && !items.some((item) => item.productId === suggestionId)
      ? productById[suggestionId]
      : null;

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
            <p className="eyebrow">TU SELECCIÓN</p>
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
                <article className="cart-line" key={item.lineId}>
                  <img
                    src={item.product.image}
                    alt=""
                    width="72"
                    height="90"
                  />
                  <div className="cart-line__content">
                    <span>{categoryById[item.categoryId]?.name}</span>
                    <h3>{item.product.name}</h3>
                    <p>
                      {[item.variant, item.format].filter(Boolean).join(" · ")}
                    </p>
                    <strong>
                      {typeof item.price === "number"
                        ? new Intl.NumberFormat("es-AR", {
                            style: "currency",
                            currency: "ARS",
                          }).format(item.price)
                        : "Precio pendiente"}
                    </strong>
                    <div className="quantity-control">
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.lineId, item.quantity - 1)
                        }
                        aria-label={`Quitar una unidad de ${item.product.name}`}
                      >
                        <Minus size={16} aria-hidden="true" />
                      </button>
                      <span aria-label={`${item.quantity} unidades`}>
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          updateQuantity(item.lineId, item.quantity + 1)
                        }
                        aria-label={`Agregar una unidad de ${item.product.name}`}
                      >
                        <Plus size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="cart-line__remove"
                    onClick={() => removeItem(item.lineId)}
                    aria-label={`Eliminar ${item.product.name}`}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>

            {suggestion ? (
              <div className="cart-suggestion">
                <div>
                  <span>También puede acompañar</span>
                  <strong>{suggestion.name}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => addItem(suggestion)}
                  aria-label={`Agregar ${suggestion.name}`}
                >
                  <Plus size={17} aria-hidden="true" />
                  Agregar
                </button>
              </div>
            ) : null}

            <div className="cart-drawer__footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>
                  {hasPendingPrices ? "A confirmar" : "$ 0"}
                </strong>
              </div>
              <p>
                Envío, stock y precios se confirmarán antes de habilitar el pago.
              </p>
              <Link className="button button--gold button--block" to="/checkout" onClick={closeCart}>
                Ir al checkout preparado
              </Link>
              <button type="button" className="text-button" onClick={closeCart}>
                Seguir explorando
              </button>
            </div>
          </>
        ) : (
          <div className="cart-empty">
            <ShoppingBag size={38} aria-hidden="true" />
            <h3>Tu selección está vacía.</h3>
            <p>
              Combiná aceites, frutos secos, aceitunas y otros sabores en un
              mismo carrito.
            </p>
            <Link className="button" to="/productos" onClick={closeCart}>
              Explorar productos
            </Link>
          </div>
        )}
      </aside>
    </div>
  );
}
