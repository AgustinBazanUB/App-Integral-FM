import { useRef, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { Link } from "../router";
import { categoryById } from "../data/categories";
import { complementaryByCategory, productById } from "../data/products";
import { useCart } from "../context/CartContext";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { formatPrice } from "../utils/format";

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
  } = useCart();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [addedIds, setAddedIds] = useState(() => new Set());

  useFocusTrap({
    active: isCartOpen,
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: closeCart,
  });

  if (!isCartOpen) return null;

  const cartProductIds = new Set(items.map((item) => item.productId));
  const cartCategories = [...new Set(items.map((item) => item.categoryId))];
  const suggestions = cartCategories
    .flatMap((categoryId) => complementaryByCategory[categoryId] ?? [])
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .filter((id) => !cartProductIds.has(id) && productById[id])
    .map((id) => productById[id])
    .slice(0, 3);

  const onAddSuggestion = (suggestion) => {
    addItem(suggestion);
    setAddedIds((current) => new Set(current).add(suggestion.id));
  };

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
                      {formatPrice(item.price) ?? "A consultar"}
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

            {suggestions.length ? (
              <div className="cart-suggestions">
                <p className="cart-suggestions__title">Completá tu pedido</p>
                {suggestions.map((suggestion) => {
                  const isAdded = addedIds.has(suggestion.id);
                  return (
                    <div className="cart-suggestion" key={suggestion.id}>
                      {suggestion.image ? (
                        <img
                          src={suggestion.image}
                          alt=""
                          width="48"
                          height="60"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      <div className="cart-suggestion__info">
                        <strong>{suggestion.name}</strong>
                        <span>
                          {formatPrice(
                            suggestion.promoPrice ?? suggestion.price,
                          ) ?? "A consultar"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={isAdded ? "is-added" : undefined}
                        onClick={() => onAddSuggestion(suggestion)}
                        aria-label={`Agregar ${suggestion.name} al carrito`}
                      >
                        <Plus size={15} aria-hidden="true" />
                        {isAdded ? "Agregado" : "Agregar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="cart-drawer__footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>
                  {hasPendingPrices
                    ? `${formatPrice(knownSubtotal)} + pendientes`
                    : formatPrice(knownSubtotal)}
                </strong>
              </div>
              <p>
                Coordinamos envío, stock y detalles al confirmar tu pedido.
              </p>
              <Link className="button button--gold button--block" to="/checkout" onClick={closeCart}>
                Finalizar pedido
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
