import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import { useCart } from "../context/CartContext";
import { useCommerceCatalog } from "../context/CommerceCatalogContext";
import { categoryById } from "../data/categories";
import {
  createEcommerceOrder,
  observeEcommerceSimulationCapability,
  simulateApprovedEcommercePayment,
} from "../services/ecommerceService";
import { trackEvent } from "../utils/analytics";

const DRAFT_KEY = "flor-mia-checkout-draft-v2";
const steps = ["Datos y contacto", "Entrega", "Pago", "Confirmación"];

function newRequestId() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `web_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function initialDraft() {
  return {
    requestId: newRequestId(),
    fullName: "",
    email: "",
    phone: "",
    deliveryMethod: "pickup",
    address: "",
    city: "",
    postalCode: "",
    notes: "",
    marketingConsent: false,
    fiscalCuit: "",
  };
}

function readDraft() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
    return {
      ...initialDraft(),
      ...saved,
      requestId: saved.requestId || newRequestId(),
    };
  } catch {
    return initialDraft();
  }
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export default function CheckoutPage() {
  const {
    items,
    unitCount,
    knownSubtotal,
    hasPendingPrices,
    hasUnavailableItems,
    clearCart,
  } = useCart();
  const { ready: catalogReady, config, pending, refresh: refreshCatalog } = useCommerceCatalog();
  const [step, setStep] = useState(() => readDraft().pendingOrder ? 3 : 0);
  const [draft, setDraft] = useState(readDraft);
  const [errors, setErrors] = useState({});
  const [storageMessage, setStorageMessage] = useState("");
  const [submitState, setSubmitState] = useState({ busy: false, error: "" });
  const [orderResult, setOrderResult] = useState(null);
  const submitting = useRef(false);
  const [simulationCapability, setSimulationCapability] = useState({
    enabled: false,
    localRuntime: false,
    adminRequired: true,
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setStorageMessage("");
    } catch {
      setStorageMessage(
        "No pudimos guardar el borrador en este dispositivo. Podés continuar, pero los datos no persistirán.",
      );
    }
  }, [draft]);

  useEffect(() => {
    trackEvent("begin_checkout", { quantity: unitCount, value: knownSubtotal });
  }, [knownSubtotal, unitCount]);

  useEffect(
    () => observeEcommerceSimulationCapability(setSimulationCapability),
    [],
  );

  const summary = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        category: categoryById[item.categoryId]?.name || item.product?.categoryName,
      })),
    [items],
  );

  const updateField = (event) => {
    const { name, value, type, checked } = event.target;
    setDraft((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((current) => ({ ...current, [name]: undefined }));
  };

  const validateCurrentStep = () => {
    const nextErrors = {};
    if (step === 0) {
      if (!draft.fullName.trim()) nextErrors.fullName = "Ingresá tu nombre.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) {
        nextErrors.email = "Ingresá un email válido.";
      }
      if (draft.phone.replace(/\D/g, "").length < 8) {
        nextErrors.phone = "Ingresá un teléfono válido.";
      }
    }
    if (step === 1) {
      if (draft.deliveryMethod === "pickup" && !config.pickupEnabled) {
        nextErrors.deliveryMethod = "El retiro está PENDIENTE DE DEFINIR.";
      }
      if (draft.deliveryMethod === "delivery") {
        nextErrors.deliveryMethod = "El costo y las reglas de envío están PENDIENTE DE DEFINIR.";
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = () => {
    if (!validateCurrentStep()) return;
    if (step === 1) {
      trackEvent("add_shipping_info", {
        shipping_tier: draft.deliveryMethod,
        quantity: unitCount,
        value: knownSubtotal,
      });
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitOrder = async ({ simulatePayment = false } = {}) => {
    if (submitting.current) return;
    submitting.current = true;
    setSubmitState({ busy: true, error: "" });
    try {
      let result = draft.pendingOrder ? { order: draft.pendingOrder } : null;
      if (!result) {
      const latestCatalog = await refreshCatalog();
      if (!latestCatalog?.ready && latestCatalog?.pending?.includes("ECOMMERCE_LOCATION_ID")) {
        throw new Error("La ubicación de stock Ecommerce está PENDIENTE DE DEFINIR.");
      }
      if (hasPendingPrices || hasUnavailableItems || !items.length) {
        throw new Error("El carrito cambió. Revisá precio y disponibilidad antes de confirmar.");
      }

      result = await createEcommerceOrder({
        requestId: draft.requestId,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        customer: {
          fullName: draft.fullName,
          email: draft.email,
          phone: draft.phone,
          marketingConsent: draft.marketingConsent,
        },
        deliveryMethod: draft.deliveryMethod,
        notes: draft.notes,
        paymentMode: "pending",
        // Sólo diagnóstico: el backend NO usa este total como autoridad.
        clientTotal: knownSubtotal,
      });
      setDraft((current) => ({ ...current, pendingOrder: result.order }));
      }

      let finalOrder = result.order;
      let simulation = null;
      if (simulatePayment) {
        simulation = await simulateApprovedEcommercePayment({
          orderId: result.order.id,
          idempotencyKey: result.order.idempotencyKey || draft.requestId,
          receiverCuit: draft.fiscalCuit,
        });
        finalOrder = {
          ...result.order,
          ...simulation.order,
          invoiceId: simulation.invoice?.id || null,
          invoiceStatus: simulation.invoice?.status || result.order.invoiceStatus,
        };
      }

      setOrderResult({ ...finalOrder, simulation });
      setStep(3);
      clearCart();
      window.localStorage.removeItem(DRAFT_KEY);
      setDraft(initialDraft());
      setSubmitState({ busy: false, error: "" });
      trackEvent("purchase_intent_created", {
        transaction_id: result.order.id,
        value: result.order.total,
        currency: "ARS",
        payment_status: result.order.paymentStatus,
      });
    } catch (error) {
      if (error?.phase === "invoice") {
        setDraft((current) => ({ ...current, pendingOrder: current.pendingOrder ? {
          ...current.pendingOrder, paymentStatus: error.payment?.status || current.pendingOrder.paymentStatus,
          saleId: error.payment?.saleId || current.pendingOrder.saleId,
          fiscalRetryPending: true,
        } : null }));
      }
      setSubmitState({
        busy: false,
        error: error?.phase === "invoice"
          ? `El pago simulado y la venta quedaron registrados. Reintentá la preparación fiscal: ${error.message}`
          : error?.message || "No se pudo registrar el pedido.",
      });
    } finally {
      submitting.current = false;
    }
  };

  const checkoutBlocked =
    !draft.pendingOrder && (!catalogReady
    || hasPendingPrices
    || hasUnavailableItems
    || (draft.deliveryMethod === "pickup" && !config.pickupEnabled)
    || draft.deliveryMethod === "delivery");

  return (
    <main id="main-content" className="page-shell checkout-page">
      <PageMeta title="Checkout | Flor Mía" />
      <section className="checkout-header">
        <div className="container">
          <Link to="/productos">
            <ArrowLeft size={17} aria-hidden="true" />
            Seguir explorando
          </Link>
          <p className="eyebrow">CHECKOUT COMERCIAL</p>
          <h1>Tu pedido, validado por el backend.</h1>
          <div className="checkout-progress" aria-label={`Paso ${step + 1} de 4`}>
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={index <= step ? "is-active" : ""}
                disabled={index > step || Boolean(orderResult)}
                onClick={() => index < step && !orderResult && setStep(index)}
                aria-current={index === step ? "step" : undefined}
              >
                <span>{index < step ? <Check size={15} /> : index + 1}</span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section checkout-layout">
        <div className="container checkout-grid">
          <div className="checkout-form-card">
            {orderResult ? (
              <div className="integration-state">
                <Check size={34} aria-hidden="true" />
                <h2>Pedido registrado.</h2>
                <p><strong>{orderResult.id}</strong></p>
                <p>Total recalculado por el backend: <strong>{formatMoney(orderResult.total)}</strong></p>
                <p>Pago: <strong>{orderResult.paymentStatus}</strong></p>
                <p>Factura: <strong>{orderResult.invoiceStatus}</strong></p>
                {orderResult.simulation ? (
                  <>
                    <p>Venta Ecommerce: <strong>{orderResult.saleId}</strong></p>
                    <p>Invoice: <strong>{orderResult.simulation.invoice?.id}</strong> · {orderResult.simulation.invoice?.status}</p>
                    <p>
                      Resultado fiscal: <strong>{orderResult.simulation.fiscal?.mode}</strong>
                      {orderResult.simulation.fiscal?.voucherClass ? ` · Factura ${orderResult.simulation.fiscal.voucherClass}` : ""}
                    </p>
                    <p>No se procesó un pago real y no se solicitó CAE en este flujo local.</p>
                  </>
                ) : (
                  <p>
                    Esta etapa no procesó tarjeta ni emitió ARCA. Cuando Payway se
                    integre, la aprobación del pago podrá confirmar la venta y
                    descontar stock dentro de una operación server-side.
                  </p>
                )}
                <Link className="button button--gold" to="/productos">Seguir comprando</Link>
              </div>
            ) : items.length || draft.pendingOrder ? (
              <>
                {step === 0 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 1 DE 4</p>
                    <h2>Datos y contacto</h2>
                    <p>Comprá como invitado. El pedido final se valida en el backend.</p>
                    {storageMessage ? <p className="field-error" role="status">{storageMessage}</p> : null}
                    <div className="form-grid">
                      <label className="field-label field-label--full">
                        Nombre y apellido
                        <input name="fullName" value={draft.fullName} onChange={updateField} autoComplete="name" aria-invalid={Boolean(errors.fullName)} />
                        {errors.fullName ? <span className="field-error">{errors.fullName}</span> : null}
                      </label>
                      <label className="field-label">
                        Email
                        <input name="email" type="email" value={draft.email} onChange={updateField} autoComplete="email" aria-invalid={Boolean(errors.email)} />
                        {errors.email ? <span className="field-error">{errors.email}</span> : null}
                      </label>
                      <label className="field-label">
                        Teléfono
                        <input name="phone" type="tel" value={draft.phone} onChange={updateField} autoComplete="tel" aria-invalid={Boolean(errors.phone)} />
                        {errors.phone ? <span className="field-error">{errors.phone}</span> : null}
                      </label>
                      <label className="checkbox-label field-label--full">
                        <input type="checkbox" name="marketingConsent" checked={draft.marketingConsent} onChange={updateField} />
                        <span>Quiero recibir novedades. Este consentimiento es opcional.</span>
                      </label>
                    </div>
                  </form>
                ) : null}

                {step === 1 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 2 DE 4</p>
                    <h2>Entrega o retiro</h2>
                    <div className="delivery-options">
                      <label>
                        <input
                          type="radio"
                          name="deliveryMethod"
                          value="pickup"
                          checked={draft.deliveryMethod === "pickup"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>Retiro</strong>
                          <small>{config.pickupEnabled ? "Habilitado comercialmente." : "PENDIENTE DE DEFINIR."}</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="deliveryMethod"
                          value="delivery"
                          checked={draft.deliveryMethod === "delivery"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>Envío</strong>
                          <small>PENDIENTE DE DEFINIR: zonas, tarifa y reglas.</small>
                        </span>
                      </label>
                    </div>
                    {errors.deliveryMethod ? <p className="field-error">{errors.deliveryMethod}</p> : null}
                    <label className="field-label">
                      Notas del pedido
                      <textarea name="notes" rows="3" maxLength="500" value={draft.notes} onChange={updateField} />
                    </label>
                  </form>
                ) : null}

                {step === 2 ? (
                  <div>
                    <p className="eyebrow">PASO 3 DE 4</p>
                    <h2>Pago</h2>
                    <div className="integration-state">
                      <LockKeyhole size={30} aria-hidden="true" />
                      <h3>Payway todavía no procesa el cobro en esta etapa.</h3>
                      <p>
                        Al confirmar se crea un Order y un Payment con estado
                        <strong> pending</strong>. No se crea Sale, no se descuenta
                        stock y no se genera Invoice hasta que exista una
                        aprobación de pago confiable.
                      </p>
                    </div>
                    {simulationCapability.enabled ? (
                      <div className="pending-panel">
                        <strong>Modo local de prueba para administrador</strong>
                        <p>
                          Este checkout no procesa un pago real.
                          La acción simulará un pago aprobado.
                          Se preparará un plan fiscal de prueba sin solicitar CAE.
                        </p>
                        <label className="field-label">
                          CUIT para facturación (opcional)
                          <input
                            name="fiscalCuit"
                            inputMode="numeric"
                            value={draft.fiscalCuit}
                            onChange={updateField}
                            placeholder="Sin CUIT: Consumidor Final"
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className="integration-state">
                      <ShieldCheck size={28} aria-hidden="true" />
                      <h3>Precio y stock no vienen del navegador.</h3>
                      <p>El backend vuelve a leer products + locationStock y recalcula el total.</p>
                    </div>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <p className="eyebrow">PASO 4 DE 4</p>
                    <h2>Confirmar pedido</h2>
                    {draft.pendingOrder?.fiscalRetryPending ? (
                      <p role="status">El pago simulado y la venta ya están registrados. Podés reintentar el plan fiscal para este mismo pedido.</p>
                    ) : null}
                    {checkoutBlocked ? (
                      <div className="pending-panel">
                        <strong>No se puede confirmar todavía.</strong>
                        <p>
                          Revisá catálogo, stock, precio y configuración de entrega.
                          No se fabricarán valores para habilitar el checkout.
                        </p>
                      </div>
                    ) : (
                      <div className="integration-state">
                        <Check size={30} aria-hidden="true" />
                        <h3>Listo para registrar el pedido.</h3>
                        <p>
                          El total visible es orientativo hasta que el backend lo
                          vuelva a calcular con la fuente comercial autoritativa.
                        </p>
                      </div>
                    )}
                    {submitState.error ? <p className="field-error" role="alert">{submitState.error}</p> : null}
                  </div>
                ) : null}

                <div className="checkout-actions">
                  {step > 0 ? (
                    <button type="button" className="button button--secondary" onClick={() => setStep((current) => current - 1)} disabled={submitState.busy}>
                      Volver
                    </button>
                  ) : null}
                  {step < steps.length - 1 ? (
                    <button type="button" className="button button--gold" onClick={goNext}>
                      {step === 2 ? "Revisar pedido" : "Continuar"}
                    </button>
                  ) : (
                    <>
                    <button
                      type="button"
                      className="button button--gold"
                      disabled={checkoutBlocked || submitState.busy || Boolean(draft.pendingOrder)}
                      onClick={() => submitOrder()}
                    >
                      {submitState.busy ? "Registrando…" : "Crear pedido"}
                    </button>
                    {simulationCapability.enabled ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={checkoutBlocked || submitState.busy}
                        onClick={() => submitOrder({ simulatePayment: true })}
                      >
                        {submitState.busy ? "Procesando…" : draft.pendingOrder ? "Reintentar pago simulado + plan fiscal" : "Simular pago aprobado + factura"}
                      </button>
                    ) : null}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h2>Tu carrito está vacío.</h2>
                <p>Agregá productos antes de recorrer el checkout.</p>
                <Link className="button" to="/productos">Explorar productos</Link>
              </div>
            )}
          </div>

          <aside className="order-summary">
            <p className="eyebrow">RESUMEN</p>
            <h2>{unitCount} {unitCount === 1 ? "producto" : "productos"}</h2>
            <div className="order-summary__items">
              {summary.map((item) => (
                <article key={item.productId}>
                  {item.product?.image ? <img src={item.product.image} alt="" width="58" height="72" /> : null}
                  <div>
                    <span>{item.category}</span>
                    <strong>{item.product?.name || "Producto no disponible"}</strong>
                    <small>{item.quantity} unidad{item.quantity === 1 ? "" : "es"}</small>
                  </div>
                  <span>{typeof item.price === "number" ? formatMoney(item.price * item.quantity) : "No disponible"}</span>
                </article>
              ))}
            </div>
            <div className="order-summary__total">
              <span>Subtotal visible</span>
              <strong>{hasPendingPrices ? "No disponible" : formatMoney(knownSubtotal)}</strong>
            </div>
            <p>El backend ignora precios/totales enviados por el navegador y recalcula la operación.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
