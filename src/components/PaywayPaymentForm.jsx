import { useEffect, useRef, useState } from "react";
import { ecommercePublicEndpoint } from "../services/ecommercePublicEndpoint";
import PaywayBillingAddress from "./PaywayBillingAddress";

let sdkPromise;
let pageClient;
function paywayClient(config) {
  if (pageClient) {
    if (pageClient.publicKey !== config.publicKey || pageClient.tokenUrl !== config.tokenUrl) throw new Error("La configuración de Payway cambió. Recargá la página antes de pagar.");
    return pageClient.sdk;
  }
  const sdk = new window.Decidir(config.tokenUrl, false);
  sdk.setTimeout(10000);
  sdk.setPublishableKey(config.publicKey);
  pageClient = { sdk, publicKey: config.publicKey, tokenUrl: config.tokenUrl };
  return sdk;
}
export function loadPaywaySdk() {
  if (window.Decidir) return Promise.resolve();
  if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://ventasonline.payway.com.ar/static/v2.6.4/decidir.js";
    script.async = true;
    script.onload = () => window.Decidir ? resolve() : reject(new Error("Payway no pudo cargar su formulario seguro."));
    script.onerror = () => { sdkPromise = null; script.remove(); reject(new Error("No pudimos conectar con Payway. Volvé a intentar.")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}
export async function paywayRequest(body) {
  const response = await fetch(ecommercePublicEndpoint("payway"), { method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.message || "No pudimos verificar el pago. Consultá este mismo pedido.");
    error.code = result.code;
    throw error;
  }
  return result;
}

function cardMethod(bin, config) {
  const digits = String(bin || "");
  const mastercard = /^(5[1-5])/.test(digits) || (Number(digits.slice(0, 4)) >= 2221 && Number(digits.slice(0, 4)) <= 2720);
  const id = digits.startsWith("4") ? 1 : mastercard ? 104 : null;
  if (!config.paymentMethods.some((method) => method.id === id)) {
    throw new Error("Usá una tarjeta Visa o Mastercard habilitada en Payway Sandbox.");
  }
  return id;
}

export default function PaywayPaymentForm({
  order, accessToken, estimate, prepareOrder, suggestedAddress, allowAddressLookup,
  submitDisabled, onBusyChange, onApproved, onUpdate, onStartNewOrder,
}) {
  const form = useRef(null);
  const lock = useRef(false);
  const sdkRef = useRef(null);
  const preparedOrderId = useRef(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [checked, setChecked] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [holderDocument, setHolderDocument] = useState("");

  const apply = (value) => {
    setResult(value);
    onUpdate?.(value.order);
    if (value.order.paymentStatus === "approved" && value.order.saleId) onApproved(value);
  };
  const orderId = order?.id;
  useEffect(() => {
    if (orderId && (lock.current || preparedOrderId.current === orderId)) return;
    let active = true;
    (async () => {
      const settings = await paywayRequest();
      if (!active) return;
      setConfig(settings.payway);
      if (!settings.payway.enabled) return;
      if (orderId) {
        const status = await paywayRequest({ mode: "reconcile", orderId, accessToken });
        if (!active) return;
        apply(status);
        setChecked(true);
        if (status.gateway.state !== "ready") return;
      }
      await loadPaywaySdk();
      if (active) {
        sdkRef.current = paywayClient(settings.payway);
        setSdkReady(true);
      }
    })().catch(err => active && setError(err.message));
    return () => { active = false; };
  }, [orderId, accessToken]);

  const displayed = order || estimate;
  const state = result?.gateway?.state;
  const canPay = sdkReady && (orderId ? checked && state === "ready" : Boolean(prepareOrder));
  const finalFailure = ["rejected", "cancelled"].includes(result?.order?.paymentStatus);
  const run = async (mode) => {
    if (lock.current || (mode === "pay" && (!canPay || submitDisabled))) return;
    let payableOrder = order;
    lock.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError("");
    try {
      let tokenData;
      if (mode === "pay") {
        const sdk = sdkRef.current;
        const fields = new FormData(form.current);
        const payerAddress = Object.fromEntries(["street", "city", "provinceCode", "postalCode"].map(key => [
          key, String(fields.get("payer_" + key) || "").trim(),
        ]));
        if (!Object.values(payerAddress).every(Boolean)) {
          throw new Error("Confirmá el domicilio de facturación para continuar.");
        }
        tokenData = await new Promise((resolve, reject) => sdk.createToken(form.current, (status, response) => {
          if ([200, 201].includes(status) && response?.id) resolve({ token: response.id, bin: response.bin });
          else reject(new Error("Payway no pudo validar la tarjeta. Revisá los datos ingresados."));
        }));
        const paymentMethodId = cardMethod(tokenData.bin, config);
        Object.assign(tokenData, { paymentMethodId, fingerprint: sdk.device_unique_identifier, payerAddress });
        // Card data stays at Payway and is cleared before the order request.
        for (const input of form.current?.querySelectorAll("input[data-decidir]:not([type=hidden])") || []) input.value = "";
        setHolderDocument("");
        if (!payableOrder) {
          payableOrder = await prepareOrder();
          preparedOrderId.current = payableOrder.id;
          if (Math.round(payableOrder.total * 100) !== Math.round(displayed.total * 100)) {
            setResult({ order: payableOrder, gateway: { state: "ready" } });
            setChecked(true);
            throw new Error("El total se actualizó. Revisá el importe antes de volver a pagar.");
          }
        }
        setChecked(false);
      }
      const value = await paywayRequest({ mode, orderId: payableOrder.id, accessToken, ...tokenData });
      apply(value);
      setChecked(true);
      if (value.gateway.state === "ready" && !sdkReady) {
        await loadPaywaySdk();
        sdkRef.current = paywayClient(config);
        setSdkReady(true);
      }
    } catch (err) {
      if (err) setError(err.message);
    } finally {
      setBusy(false);
      lock.current = false;
      onBusyChange?.(false);
    }
  };

  return <section className="payway-payment" aria-busy={busy} aria-labelledby="payway-payment-title">
    <div>
      <p className="eyebrow">ENTORNO DE PRUEBA</p>
      <h3 id="payway-payment-title">Pagar con Payway</h3>
    </div>
    <p className="payway-payment__note">Usá únicamente una tarjeta de Payway Sandbox.</p>
    {displayed && <dl className="payway-totals">
      <div><dt>Productos</dt><dd>{money(displayed.subtotal)}</dd></div>
      {displayed.discountTotal > 0 && <div><dt>Descuentos</dt><dd>{money(displayed.discountTotal)}</dd></div>}
      <div><dt>Envío</dt><dd>{displayed.shippingAmount === 0 ? "Sin cargo" : money(displayed.shippingAmount)}</dd></div>
      <div><dt>Total a pagar · ARS</dt><dd><strong>{money(displayed.total)}</strong></dd></div>
    </dl>}
    {config?.enabled === false && <p role="status">Payway está pendiente de habilitación en este entorno.</p>}
    {!canPay && busy && <p role="status">Consultando Payway…</p>}
    {config?.enabled !== false && !canPay && !orderId && !error && !busy && <p role="status">Cargando el formulario de Payway…</p>}
    {canPay && <form ref={form} onSubmit={event => { event.preventDefault(); run("pay"); }} autoComplete="off">
      <fieldset disabled={busy}>
        <legend>Visa o Mastercard · 1 cuota</legend>
        <label className="field-label">Número de tarjeta de prueba<input type="password" inputMode="numeric" data-decidir="card_number" autoComplete="off" required minLength={16} maxLength={19} /></label>
        <div className="payway-fields">
          <label className="field-label">Mes de vencimiento<input inputMode="numeric" data-decidir="card_expiration_month" placeholder="MM" required pattern="0[1-9]|1[0-2]" maxLength={2} /></label>
          <label className="field-label">Año de vencimiento<input inputMode="numeric" data-decidir="card_expiration_year" placeholder="AA" required pattern="[0-9]{2}" maxLength={2} /></label>
          <label className="field-label">Código de seguridad<input type="password" inputMode="numeric" data-decidir="security_code" required minLength={3} maxLength={4} autoComplete="off" /></label>
        </div>
        <label className="field-label">Titular de la tarjeta<input data-decidir="card_holder_name" required maxLength={100} /></label>
        <details className="payway-document">
          <summary>DNI del titular (opcional)</summary>
          {holderDocument && <input type="hidden" data-decidir="card_holder_doc_type" value="dni" />}
          <label className="field-label">DNI del titular de la tarjeta
            <input inputMode="numeric" data-decidir={holderDocument ? "card_holder_doc_number" : undefined}
              pattern="[0-9]{7,8}" maxLength={8} value={holderDocument} onChange={event => setHolderDocument(event.target.value)} />
          </label>
        </details>
        <PaywayBillingAddress suggestedAddress={suggestedAddress || result?.order?.deliveryAddress} allowLookup={allowAddressLookup} />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button button--gold" type="submit" disabled={busy || submitDisabled}>
          {busy ? "Procesando pago…" : "Pagar " + money(displayed.total) + " con Payway"}
        </button>
      </fieldset>
    </form>}
    {state && state !== "ready" && <div role="status" className="pending-panel">
      <strong>{finalFailure ? "El pago fue rechazado o cancelado." : state === "expired" ? "La reserva de este pedido venció." : state === "recovery_required" ? "Payway aprobó el pago; estamos conciliando el pedido." : "Resultado en verificación"}</strong>
      <p>{state === "expired" || finalFailure ? "Podés volver a editar el pedido e intentar otro pago." : "Consultá el estado de este pago antes de volver a intentarlo."}</p>
      {result.gateway.reference && <p>Referencia Payway {result.gateway.reference}</p>}
    </div>}
    {!canPay && error && <p className="field-error" role="alert">{error}</p>}
    {onStartNewOrder && (finalFailure || state === "expired") &&
      <button className="button button--secondary" type="button" disabled={busy || submitDisabled} onClick={onStartNewOrder}>Volver al pago</button>}
    {orderId && config?.enabled && !canPay && !finalFailure && state !== "expired" &&
      <button className="button button--secondary" type="button" disabled={busy} onClick={() => run("reconcile")}>
        {busy ? "Verificando…" : "Consultar resultado del pago"}
      </button>}
  </section>;
}

function money(value) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value || 0);
}
