import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, LockKeyhole } from "lucide-react";
import { Link } from "../router";
import PageMeta from "../components/PageMeta";
import { useCart } from "../context/CartContext";
import { categoryById } from "../data/categories";
import { trackEvent } from "../utils/analytics";

const DRAFT_KEY = "flor-mia-checkout-draft-v1";
const steps = ["Datos y contacto", "Entrega o retiro", "Pago", "Confirmación"];

const initialDraft = {
  fullName: "",
  email: "",
  phone: "",
  deliveryMethod: "delivery",
  address: "",
  city: "",
  postalCode: "",
  notes: "",
  marketingConsent: false,
};

function readDraft() {
  try {
    return {
      ...initialDraft,
      ...JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}"),
    };
  } catch {
    return initialDraft;
  }
}

export default function CheckoutPage() {
  const { items, unitCount, hasPendingPrices } = useCart();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(readDraft);
  const [errors, setErrors] = useState({});
  const [storageMessage, setStorageMessage] = useState("");

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
    trackEvent("begin_checkout", { quantity: unitCount });
  }, [unitCount]);

  const summary = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        category: categoryById[item.categoryId]?.name,
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
      if (!draft.phone.trim()) nextErrors.phone = "Ingresá un teléfono.";
    }
    if (step === 1 && draft.deliveryMethod === "delivery") {
      if (!draft.address.trim()) nextErrors.address = "Ingresá la dirección.";
      if (!draft.city.trim()) nextErrors.city = "Ingresá la localidad.";
      if (!draft.postalCode.trim()) {
        nextErrors.postalCode = "Ingresá el código postal.";
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
      });
    }
    setStep((current) => Math.min(current + 1, steps.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main id="main-content" className="page-shell checkout-page">
      <PageMeta title="Checkout preparado | Flor Mía" />
      <section className="checkout-header">
        <div className="container">
          <Link to="/productos">
            <ArrowLeft size={17} aria-hidden="true" />
            Seguir explorando
          </Link>
          <p className="eyebrow">CHECKOUT PREPARADO</p>
          <h1>Tu selección, paso a paso.</h1>
          <div className="checkout-progress" aria-label={`Paso ${step + 1} de 4`}>
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={index <= step ? "is-active" : ""}
                disabled={index > step}
                onClick={() => index < step && setStep(index)}
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
            {items.length ? (
              <>
                {step === 0 ? (
                  <form onSubmit={(event) => event.preventDefault()}>
                    <p className="eyebrow">PASO 1 DE 4</p>
                    <h2>Datos y contacto</h2>
                    <p>
                      Comprá como invitado. Tus datos quedan guardados en este
                      dispositivo mientras completás el flujo.
                    </p>
                    {storageMessage ? (
                      <p className="field-error" role="status">
                        {storageMessage}
                      </p>
                    ) : null}
                    <div className="form-grid">
                      <label className="field-label field-label--full">
                        Nombre y apellido
                        <input
                          name="fullName"
                          value={draft.fullName}
                          onChange={updateField}
                          autoComplete="name"
                          aria-invalid={Boolean(errors.fullName)}
                        />
                        {errors.fullName ? (
                          <span className="field-error">{errors.fullName}</span>
                        ) : null}
                      </label>
                      <label className="field-label">
                        Email
                        <input
                          name="email"
                          type="email"
                          value={draft.email}
                          onChange={updateField}
                          autoComplete="email"
                          aria-invalid={Boolean(errors.email)}
                        />
                        {errors.email ? (
                          <span className="field-error">{errors.email}</span>
                        ) : null}
                      </label>
                      <label className="field-label">
                        Teléfono
                        <input
                          name="phone"
                          type="tel"
                          value={draft.phone}
                          onChange={updateField}
                          autoComplete="tel"
                          aria-invalid={Boolean(errors.phone)}
                        />
                        {errors.phone ? (
                          <span className="field-error">{errors.phone}</span>
                        ) : null}
                      </label>
                      <label className="checkbox-label field-label--full">
                        <input
                          type="checkbox"
                          name="marketingConsent"
                          checked={draft.marketingConsent}
                          onChange={updateField}
                        />
                        <span>
                          Quiero recibir novedades. Este consentimiento es
                          opcional e independiente.
                        </span>
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
                          value="delivery"
                          checked={draft.deliveryMethod === "delivery"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>Envío</strong>
                          <small>Zonas, costos y plazos por confirmar.</small>
                        </span>
                      </label>
                      <label>
                        <input
                          type="radio"
                          name="deliveryMethod"
                          value="pickup"
                          checked={draft.deliveryMethod === "pickup"}
                          onChange={updateField}
                        />
                        <span>
                          <strong>Retiro en el local</strong>
                          <small>Dirección y horarios por confirmar.</small>
                        </span>
                      </label>
                    </div>

                    {draft.deliveryMethod === "delivery" ? (
                      <div className="form-grid">
                        <label className="field-label field-label--full">
                          Dirección
                          <input
                            name="address"
                            value={draft.address}
                            onChange={updateField}
                            autoComplete="street-address"
                            aria-invalid={Boolean(errors.address)}
                          />
                          {errors.address ? (
                            <span className="field-error">{errors.address}</span>
                          ) : null}
                        </label>
                        <label className="field-label">
                          Localidad
                          <input
                            name="city"
                            value={draft.city}
                            onChange={updateField}
                            autoComplete="address-level2"
                            aria-invalid={Boolean(errors.city)}
                          />
                          {errors.city ? (
                            <span className="field-error">{errors.city}</span>
                          ) : null}
                        </label>
                        <label className="field-label">
                          Código postal
                          <input
                            name="postalCode"
                            value={draft.postalCode}
                            onChange={updateField}
                            autoComplete="postal-code"
                            aria-invalid={Boolean(errors.postalCode)}
                          />
                          {errors.postalCode ? (
                            <span className="field-error">
                              {errors.postalCode}
                            </span>
                          ) : null}
                        </label>
                      </div>
                    ) : (
                      <div className="pending-panel">
                        <strong>Datos de retiro pendientes</strong>
                        <p>
                          La opción quedará habilitada comercialmente cuando se
                          carguen dirección, horarios y tiempo de preparación.
                        </p>
                      </div>
                    )}
                  </form>
                ) : null}

                {step === 2 ? (
                  <div>
                    <p className="eyebrow">PASO 3 DE 4</p>
                    <h2>Pago</h2>
                    <div className="integration-state">
                      <LockKeyhole size={30} aria-hidden="true" />
                      <h3>Integración de pago pendiente.</h3>
                      <p>
                        Esta versión no solicita tarjetas, no procesa cobros y
                        no inventa medios de pago. El punto de integración está
                        preparado para sumar el proveedor real.
                      </p>
                    </div>
                  </div>
                ) : null}

                {step === 3 ? (
                  <div>
                    <p className="eyebrow">PASO 4 DE 4</p>
                    <h2>Confirmación no disponible todavía.</h2>
                    <div className="integration-state">
                      <Check size={30} aria-hidden="true" />
                      <h3>El flujo y tus datos quedaron preparados.</h3>
                      <p>
                        No se generó ningún pedido ni pago. Para habilitar la
                        compra faltan catálogo, precios, stock, logística y un
                        proveedor de cobro reales.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="checkout-actions">
                  {step > 0 ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setStep((current) => current - 1)}
                    >
                      Volver
                    </button>
                  ) : null}
                  {step < steps.length - 1 ? (
                    <button
                      type="button"
                      className="button button--gold"
                      onClick={goNext}
                    >
                      {step === 2 ? "Ver estado final" : "Continuar"}
                    </button>
                  ) : (
                    <Link className="button" to="/productos">
                      Volver al catálogo
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h2>Tu selección está vacía.</h2>
                <p>Agregá productos antes de recorrer el checkout.</p>
                <Link className="button" to="/productos">
                  Explorar productos
                </Link>
              </div>
            )}
          </div>

          <aside className="order-summary">
            <p className="eyebrow">RESUMEN</p>
            <h2>{unitCount} {unitCount === 1 ? "producto" : "productos"}</h2>
            <div className="order-summary__items">
              {summary.map((item) => (
                <article key={item.lineId}>
                  <img src={item.product.image} alt="" width="58" height="72" />
                  <div>
                    <span>{item.category}</span>
                    <strong>{item.product.name}</strong>
                    <small>
                      {item.quantity} × {item.format}
                    </small>
                  </div>
                  <span>Precio pendiente</span>
                </article>
              ))}
            </div>
            <div className="order-summary__total">
              <span>Subtotal</span>
              <strong>{hasPendingPrices ? "A confirmar" : "$ 0"}</strong>
            </div>
            <p>
              El resumen permanece visible. Envío y total final se calcularán
              cuando existan datos comerciales reales.
            </p>
          </aside>
        </div>
      </section>
    </main>
  );
}
