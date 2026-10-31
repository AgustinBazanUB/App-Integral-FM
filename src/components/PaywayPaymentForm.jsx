import { useEffect, useRef, useState } from "react";
import { ecommercePublicEndpoint } from "../services/ecommercePublicEndpoint";

let sdkPromise;
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
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || "No pudimos verificar el pago. Consultá este mismo pedido.");
  return result;
}

export default function PaywayPaymentForm({ order, accessToken, onApproved, onUpdate, onStartNewOrder }) {
  const form = useRef(null);
  const lock = useRef(false);
  const sdkRef = useRef(null);
  const [config, setConfig] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [checked, setChecked] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState(104);
  const apply = (value) => {
    setResult(value);
    onUpdate?.(value.order);
    if (value.order.paymentStatus === "approved" && value.order.saleId) onApproved(value);
  };
  useEffect(() => {
    let active = true;
    (async () => {
      const settings = await paywayRequest();
      if (!active) return;
      setConfig(settings.payway);
      if (!settings.payway.enabled) return;
      const status = await paywayRequest({ mode: "reconcile", orderId: order.id, accessToken });
      if (!active) return;
      apply(status);
      setChecked(true);
      await loadPaywaySdk();
      if (active) { prepareSdk(settings.payway); setSdkReady(true); }
    })().catch(err => active && setError(err.message));
    return () => { active = false; };
  }, [order.id, accessToken]);
  function prepareSdk(settings) {
    const sdk = new window.Decidir(settings.tokenUrl, false);
    sdk.setTimeout(10000);
    sdk.setPublishableKey(settings.publicKey);
    sdkRef.current = sdk;
  }

  const run = async (mode) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError("");
    try {
      let tokenData;
      if (mode === "pay") {
        const sdk = sdkRef.current;
        if (!sdk) throw new Error("Esperá a que cargue la validación segura de Payway.");
        const fields = new FormData(form.current);
        const payerAddress = Object.fromEntries(["street", "city", "provinceCode", "postalCode"].map(key=>[key, fields.get(`payer_${key}`)]));
        tokenData = await new Promise((resolve, reject) => sdk.createToken(form.current, (status, response) => {
          if ([200, 201].includes(status) && response?.id) resolve({ token: response.id, bin: response.bin, fingerprint: sdk.device_unique_identifier, payerAddress });
          else reject(new Error("Payway no pudo tokenizar la tarjeta. Revisá los datos o la conexión."));
        }));
        // The browser sends only a short-lived token and BIN to Flor Mía.
        form.current.reset();
        setChecked(false); // A lost POST response must recover via reconciliation.
      }
      const value = await paywayRequest({ mode, orderId: order.id, accessToken, ...(mode === "pay" ? { paymentMethodId } : {}), ...tokenData });
      apply(value); setChecked(true);
      if (value.gateway.state === "ready" && !sdkReady) { await loadPaywaySdk(); prepareSdk(config); setSdkReady(true); }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); lock.current = false; }
  };
  const state = result?.gateway?.state;
  const canPay = checked && state === "ready" && sdkReady;
  const finalFailure = ["rejected", "cancelled"].includes(result?.order?.paymentStatus);
  return <section className="payway-payment" aria-busy={busy}>
    <p className="eyebrow">PAYWAY SANDBOX · ENTORNO DE PRUEBAS</p>
    <h3>Pagar con Payway</h3>
    <p>Pedido: <strong>{order.id}</strong></p>
    <p>Esta compra usa dinero y stock de prueba. No se emitirá una factura fiscal productiva.</p>
    <dl className="payway-totals">
      <div><dt>Productos</dt><dd>{money(order.subtotal)}</dd></div>
      <div><dt>Descuentos</dt><dd>{money(order.discountTotal)}</dd></div>
      <div><dt>Envío</dt><dd>{money(order.shippingAmount)}</dd></div>
      <div><dt>Total a pagar · ARS</dt><dd><strong>{money(order.total)}</strong></dd></div>
    </dl>
    {config?.enabled === false ? <p role="status">Payway está pendiente de habilitación en este entorno.</p> : null}
    {canPay ? <form ref={form} onSubmit={event => { event.preventDefault(); run("pay"); }} autoComplete="off">
      <fieldset disabled={busy}>
        <legend>Tarjeta de prueba · 1 cuota</legend>
        <label className="field-label">Tarjeta habilitada en sandbox<select value={paymentMethodId} onChange={event=>setPaymentMethodId(Number(event.target.value))}>{config.paymentMethods.map(method=><option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
        <label className="field-label">Número de tarjeta de prueba<input type="password" inputMode="numeric" data-decidir="card_number" autoComplete="off" required minLength={16} maxLength={19} /></label>
        <div className="payway-fields">
          <label className="field-label">Mes de vencimiento<input inputMode="numeric" data-decidir="card_expiration_month" placeholder="MM" required pattern="0[1-9]|1[0-2]" maxLength={2} /></label>
          <label className="field-label">Año de vencimiento<input inputMode="numeric" data-decidir="card_expiration_year" placeholder="AA" required pattern="[0-9]{2}" maxLength={2} /></label>
          <label className="field-label">Código de seguridad<input type="password" inputMode="numeric" data-decidir="security_code" required minLength={3} maxLength={4} autoComplete="off" /></label>
        </div>
        <label className="field-label">Titular de la tarjeta<input data-decidir="card_holder_name" required maxLength={100} /></label>
        <input type="hidden" data-decidir="card_holder_doc_type" value="dni" />
        <label className="field-label">DNI del titular de prueba<input inputMode="numeric" data-decidir="card_holder_doc_number" required pattern="[0-9]{7,8}" maxLength={8} /></label>
        <p>Completá el domicilio de facturación ficticio para la validación antifraude de esta compra de prueba.</p>
        <label className="field-label">Calle y altura de facturación<input name="payer_street" required maxLength={100} /></label>
        <label className="field-label">Localidad de facturación<input name="payer_city" required maxLength={50} /></label>
        <label className="field-label">Provincia de facturación<select name="payer_provinceCode" required defaultValue=""><option value="">Seleccionar provincia</option>{[["C","CABA"],["B","Buenos Aires"],["K","Catamarca"],["H","Chaco"],["U","Chubut"],["X","Córdoba"],["W","Corrientes"],["E","Entre Ríos"],["P","Formosa"],["Y","Jujuy"],["L","La Pampa"],["F","La Rioja"],["M","Mendoza"],["N","Misiones"],["Q","Neuquén"],["R","Río Negro"],["A","Salta"],["J","San Juan"],["D","San Luis"],["Z","Santa Cruz"],["S","Santa Fe"],["G","Santiago del Estero"],["V","Tierra del Fuego"],["T","Tucumán"]].map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label>
        <label className="field-label">Código postal de facturación<input name="payer_postalCode" required maxLength={10} /></label>
        <p>Los datos de tarjeta se envían directamente a Payway para generar el token de pago.</p>
        <button className="button button--gold" type="submit" disabled={busy}>{busy ? "Procesando pago…" : `Pagar ${money(order.total)} con Payway`}</button>
      </fieldset>
    </form> : null}
    {state && state !== "ready" ? <div role="status" className="pending-panel">
      <strong>{state === "expired" ? "La reserva de este pedido venció." : finalFailure ? "El pago fue rechazado o cancelado." : state === "recovery_required" ? "Payway aprobó el pago; estamos conciliando el pedido." : "Resultado en verificación"}</strong>
      <p>{state === "expired" || finalFailure ? "No se registró una venta. Conservamos este pedido para consulta." : "Consultá el estado de esta operación. No ingreses otra tarjeta ni generes un nuevo pago."}</p>
      {result.gateway.reference ? <p>Referencia Payway: {result.gateway.reference}</p> : null}
    </div> : null}
    {onStartNewOrder && (finalFailure || state === "expired") ? <button className="button button--secondary" type="button" onClick={onStartNewOrder}>Crear un nuevo pedido</button> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {config?.enabled && !canPay && !finalFailure ? <button className="button button--secondary" type="button" disabled={busy} onClick={() => run("reconcile")}>{busy ? "Verificando…" : "Consultar resultado del pago"}</button> : null}
  </section>;
}
function money(value) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(value || 0); }
