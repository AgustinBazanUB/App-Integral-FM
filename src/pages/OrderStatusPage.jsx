import { useState } from "react";
import PageMeta from "../components/PageMeta";
import { Link } from "../router";
import { SHIPPING_STATES } from "../shared/shippingDomain.mjs";
export default function OrderStatusPage() {
  const [access, setAccess] = useState(() => {
      try {
        return (
          JSON.parse(localStorage.getItem("flor-mia-last-order")) || {
            orderId: "",
            accessToken: "",
          }
        );
      } catch {
        return { orderId: "", accessToken: "" };
      }
    }),
    [order, setOrder] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const check = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setOrder(null);
    try {
      const response = await fetch(
        "/.netlify/functions/ecommerce-order-status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(access),
        },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.message || "No se pudo consultar el pedido.");
      setOrder(data.order);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/.netlify/functions/ecommerce-order-status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...access, mode: "document" }),
        },
      );
      if (!response.ok)
        throw new Error("El comprobante todavía no está disponible.");
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "Comprobante-Flor-Mia.pdf";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main id="main-content" className="page-shell checkout-page">
      <PageMeta title="Mi pedido | Flor Mía" />
      <section className="section container">
        <h1>Mi pedido</h1>
        <p>
          El acceso privado se conserva en el dispositivo donde hiciste tu
          compra. Guardalo para consultar desde otro dispositivo.
        </p>
        <form className="checkout-form-card" onSubmit={check}>
          <label className="field-label">
            Número de pedido
            <input
              value={access.orderId}
              onChange={(e) =>
                setAccess({ ...access, orderId: e.target.value })
              }
            />
          </label>
          <label className="field-label">
            Clave privada de consulta
            <input
              value={access.accessToken}
              onChange={(e) =>
                setAccess({ ...access, accessToken: e.target.value })
              }
            />
          </label>
          <button className="button button--gold" disabled={busy}>
            {busy ? "Consultando…" : "Consultar estado"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {order && (
          <article className="checkout-form-card">
            <h2>{order.code}</h2>
            <p>
              Pedido: {order.status}
              {order.reservationExpired ? " · Reserva vencida" : ""}
            </p>
            <p>
              Pago: {order.paymentStatus}
              {order.simulated ? " · SIMULACIÓN, SIN COBRO REAL" : ""}
            </p>
            <p>
              {order.deliveryMethod === "pickup"
                ? "Retiro en local"
                : "Envío a domicilio"}
              :{" "}
              {order.fulfillmentStatus === "listo_retirar" &&
              order.deliveryMethod === "pickup"
                ? "Listo para retirar por el cliente"
                : SHIPPING_STATES[order.fulfillmentStatus] ||
                  "Pendiente de confirmación"}
            </p>
            {order.pickupCode && (
              <p>
                Código de retiro: <strong>{order.pickupCode}</strong>
              </p>
            )}
            <p>Comprobante: {order.invoiceStatus}</p>
            {order.documentAvailable && (
              <button
                className="button button--gold"
                disabled={busy}
                onClick={download}
              >
                Descargar comprobante
              </button>
            )}
          </article>
        )}
        <Link className="button button--secondary" to="/productos">
          Volver a la tienda
        </Link>
      </section>
    </main>
  );
}
