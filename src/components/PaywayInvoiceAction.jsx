import { useState } from "react";
import { ecommercePublicEndpoint } from "../services/ecommercePublicEndpoint";

const statusMessages = {
  authorized: "El comprobante está autorizado.",
  pending: "El comprobante sigue pendiente.",
  reconciling: "Estamos verificando el comprobante en ARCA.",
  rejected: "El comprobante requiere revisión en Gestión.",
  error: "El comprobante requiere revisión en Gestión.",
};

export default function PaywayInvoiceAction({ order, accessToken, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestInvoice() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(ecommercePublicEndpoint("order-status"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invoice", orderId: order.id, accessToken }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "No se pudo solicitar el comprobante.");
      }
      onUpdate(data.invoice);
    } catch (requestError) {
      setError(requestError.message || "No se pudo consultar ARCA.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="integration-state">
      <p role="status">{statusMessages[order.invoiceStatus] || "Tu pedido está listo para facturar."}</p>
      {!order.documentAvailable && !["rejected", "error"].includes(order.invoiceStatus) && (
        <button type="button" className="button button--secondary" onClick={requestInvoice} disabled={busy || !accessToken}>
          {busy ? "Consultando ARCA…" : order.invoiceStatus === "reconciling" || order.invoiceStatus === "authorized"
            ? "Verificar comprobante de prueba"
            : "Solicitar comprobante de prueba"}
        </button>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
