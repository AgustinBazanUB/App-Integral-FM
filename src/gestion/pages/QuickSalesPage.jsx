import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  PageHeader,
  Panel,
  Select,
  Skeleton,
  Toast,
} from "../../design-system";
import {
  PAYMENT_LABELS,
  PAYMENT_OPTIONS,
} from "../../modules/locations/domain/payments";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import {
  createQuickSale,
  listLocations,
  listLocationStock,
} from "../services/managementService";

const friendlyPayments = {
  credit: "Crédito",
  debit: "Débito",
  alias: "Transferencia / alias",
  cash: "Efectivo",
  multiple: "Combinar pagos",
};

export default function QuickSalesPage() {
  const { profile } = useAuth();
  const locationsResult = useAsyncData(() => listLocations(profile), [profile.id]);
  const [locationId, setLocationId] = useState("");
  const [stock, setStock] = useState({ status: "idle", data: [] });
  const [quantities, setQuantities] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("");
  const [channel, setChannel] = useState("manual");
  const [customerDni, setCustomerDni] = useState("");
  const [invoiceRequested, setInvoiceRequested] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [submitState, setSubmitState] = useState({ busy: false, error: "", success: "" });

  const locations = locationsResult.data || [];
  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id);
  }, [locationId, locations]);
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    setStock({ status: "loading", data: [] });
    listLocationStock(locationId)
      .then((data) => active && setStock({ status: "ready", data }))
      .catch((error) => active && setStock({ status: "error", data: [], error }));
    return () => {
      active = false;
    };
  }, [locationId]);

  const cart = useMemo(
    () =>
      stock.data
        .filter((item) => Number(quantities[item.id] || 0) > 0)
        .map((item) => ({ ...item, qty: Number(quantities[item.id]) })),
    [quantities, stock.data],
  );
  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price || 0) * item.qty,
    0,
  );

  const changeQty = (item, amount) => {
    setQuantities((current) => {
      const next = Math.max(
        0,
        Math.min(Number(item.currentStock || 0), Number(current[item.id] || 0) + amount),
      );
      return { ...current, [item.id]: next };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitState({ busy: true, error: "", success: "" });
    try {
      const location = locations.find((item) => item.id === locationId);
      const result = await createQuickSale({
        location,
        seller: profile,
        items: cart,
        paymentMethod,
        paymentMethodLabel: PAYMENT_LABELS[paymentMethod],
        channel,
        customerDni,
        invoiceRequested,
        deliveryMethod,
      });
      setQuantities({});
      setCustomerDni("");
      setPaymentMethod("");
      setInvoiceRequested(false);
      setSubmitState({ busy: false, error: "", success: `${result.saleCode} registrada por ${formatMoney(result.total)}.` });
      const refreshedStock = await listLocationStock(locationId);
      setStock({ status: "ready", data: refreshedStock });
    } catch (error) {
      setSubmitState({ busy: false, error: error.message, success: "" });
    }
  };

  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Módulo 02" title="Ventas rápidas" description="Carga ágil para WhatsApp, Instagram, teléfono y operaciones manuales. La confirmación descuenta stock en una transacción." />
      <div className="fm-sale-layout">
        <Panel title="1. Elegí los productos" description="Sólo se muestran productos activos de la ubicación seleccionada.">
          <FormField label="Ubicación de salida" required>
            <Select value={locationId} onChange={(event) => { setLocationId(event.target.value); setQuantities({}); }}>
              <option value="">Elegir ubicación</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </Select>
          </FormField>
          {locationsResult.status === "loading" || stock.status === "loading" ? <Skeleton lines={5} /> : null}
          {stock.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo leer el stock" description={stock.error.message} /> : null}
          {stock.status === "ready" && !stock.data.length ? <EmptyState icon="Box" title="No hay productos disponibles" description="Configurá stock activo antes de registrar una venta." /> : null}
          {stock.status === "ready" && stock.data.length ? (
            <div className="fm-product-picker">
              {stock.data.map((item) => {
                const qty = Number(quantities[item.id] || 0);
                return (
                  <article key={item.id} className={qty ? "is-selected" : ""}>
                    <div>
                      <strong>{item.productName}</strong>
                      <span>{formatMoney(item.price)} · {item.currentStock} disponibles</span>
                    </div>
                    <div className="fm-quantity-control">
                      <button type="button" aria-label={`Quitar ${item.productName}`} onClick={() => changeQty(item, -1)} disabled={!qty}>−</button>
                      <output aria-live="polite">{qty}</output>
                      <button type="button" aria-label={`Agregar ${item.productName}`} onClick={() => changeQty(item, 1)} disabled={qty >= Number(item.currentStock || 0)}>+</button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </Panel>

        <form onSubmit={handleSubmit}>
          <Panel title="2. Confirmá la venta" description="La información fiscal real queda fuera del navegador.">
            <div className="fm-cart-summary">
              {cart.length ? (
                <ul>{cart.map((item) => <li key={item.id}><span>{item.qty} × {item.productName}</span><strong>{formatMoney(Number(item.price || 0) * item.qty)}</strong></li>)}</ul>
              ) : (
                <p>Agregá productos para continuar.</p>
              )}
              <div className="fm-cart-summary__total"><span>Total</span><strong>{formatMoney(subtotal)}</strong></div>
            </div>
            <div className="fm-form-grid">
              <FormField label="Canal de origen" required><Select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="manual">Carga manual</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="phone">Teléfono</option><option value="in_person">Presencial</option></Select></FormField>
              <FormField label="Forma de pago" required><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Elegir medio</option>{PAYMENT_OPTIONS.filter((option) => option.value !== "multiple").map((option) => <option key={option.value} value={option.value}>{friendlyPayments[option.value]}</option>)}</Select></FormField>
              <FormField label="DNI del cliente" hint="Se completa al final para no frenar la venta."><input inputMode="numeric" value={customerDni} onChange={(event) => setCustomerDni(event.target.value.replace(/\D/g, "").slice(0, 9))} /></FormField>
              <FormField label="Entrega" required><Select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value)}><option value="pickup">Retiro</option><option value="shipping">Requiere envío</option></Select></FormField>
            </div>
            <label className="fm-check-row"><input type="checkbox" checked={invoiceRequested} onChange={(event) => setInvoiceRequested(event.target.checked)} /><span>Solicitar factura manual después de registrar la venta</span></label>
            {submitState.error ? <Toast tone="error">{submitState.error}</Toast> : null}
            {submitState.success ? <Toast tone="success">{submitState.success}</Toast> : null}
            <Button type="submit" icon="Check" loading={submitState.busy} disabled={!cart.length || !paymentMethod} className="fm-sale-submit">Confirmar venta</Button>
            <p className="fm-safe-note"><Badge tone="success" icon="ShieldCheck">Operación atómica</Badge> Si falta stock o se corta la conexión, la venta completa se revierte.</p>
          </Panel>
        </form>
      </div>
    </div>
  );
}
