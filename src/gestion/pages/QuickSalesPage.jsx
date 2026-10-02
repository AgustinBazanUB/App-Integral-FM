import { useEffect, useMemo, useRef, useState } from "react";
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
import { calculateDiscountSummary } from "../../modules/locations/domain/discounts";
import { isDiscountAvailable } from "../../modules/locations/domain/dashboard";
import { useAuth } from "../AuthContext";
import { formatMoney } from "../formatters";
import { useAsyncData } from "../hooks";
import {
  createQuickSale,
  listLocations,
} from "../services/managementService";
import { listLocationInventory } from "../services/inventoryService";
import { listDiscounts } from "../services/locationManagementService";
import { dryRunArcaInvoice, requestPendingArcaInvoice } from "../services/arcaService";
import ArcaInvoicePrintAction from "../components/ArcaInvoicePrintAction";

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
  const discountsResult = useAsyncData(() => listDiscounts(profile), [profile.id]);
  const [locationId, setLocationId] = useState("");
  const [stock, setStock] = useState({ status: "idle", data: [] });
  const [quantities, setQuantities] = useState({});
  const [paymentMethod, setPaymentMethod] = useState("");
  const [channel, setChannel] = useState("manual");
  const [customerDni, setCustomerDni] = useState("");
  const [invoiceRequested, setInvoiceRequested] = useState(false);
  const [receiverVatConditionId, setReceiverVatConditionId] = useState("5");
  const [receiverDocument, setReceiverDocument] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [discountIds, setDiscountIds] = useState([]);
  const submitRef = useRef(false);
  const [submitState, setSubmitState] = useState({ busy: false, error: "", success: "" });
  const [registeredInvoice, setRegisteredInvoice] = useState(null);

  const locations = locationsResult.data || [];
  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0].id);
  }, [locationId, locations]);
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    setStock({ status: "loading", data: [] });
    listLocationInventory(locationId)
      .then((data) => active && setStock({
        status: "ready",
        data: data.filter((item) => item.active !== false && item.masterActive !== false),
      }))
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
  const selectedLocation = locations.find((item) => item.id === locationId);
  const availableDiscounts = (discountsResult.data || []).filter((discount) => isDiscountAvailable(discount, selectedLocation, new Date(), { profile, items: cart }));
  const appliedDiscounts = availableDiscounts.filter((discount) => discountIds.includes(discount.id));
  const saleSummary = useMemo(() => calculateDiscountSummary(appliedDiscounts, subtotal), [appliedDiscounts, subtotal]);

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
    if (submitRef.current) return;
    submitRef.current = true;
    setRegisteredInvoice(null);
    setSubmitState({ busy: true, error: "", success: "" });
    try {
      const location = selectedLocation;
      const receiverCondition = Number(receiverVatConditionId || 0);
      const receiverDigits = String(receiverDocument || customerDni || "").replace(/\D/g, "");
      if (invoiceRequested && [1, 4, 6].includes(receiverCondition) && receiverDigits.length !== 11) {
        throw new Error("Para Responsable Inscripto, Monotributo o Exento ingresá la CUIT de 11 dígitos.");
      }
      const receiver = invoiceRequested ? {
        vatConditionId: receiverCondition,
        documentType: receiverCondition === 5 ? (receiverDigits ? 96 : 99) : 80,
        documentNumber: receiverCondition === 5 ? (receiverDigits || "0") : receiverDigits,
        anonymousConsumerFinal: receiverCondition === 5 && !receiverDigits,
        concept: 1,
      } : null;
      const result = await createQuickSale({
        location,
        seller: profile,
        items: cart,
        discounts: appliedDiscounts,
        paymentMethod,
        paymentMethodLabel: PAYMENT_LABELS[paymentMethod],
        channel,
        customerDni,
        invoiceRequested,
        deliveryMethod,
      });
      let invoiceNotice = "";
      let invoiceId = null;
      if (invoiceRequested) {
        try {
          const invoice = await requestPendingArcaInvoice({
            sourceType: "admin_quick_sale",
            sourceId: result.id,
            receiver,
          });
          invoiceId = invoice?.id || null;
          if (invoice?.fiscalReadiness?.ready === false) {
            invoiceNotice = " Solicitud fiscal creada; faltan datos fiscales de uno o más productos antes de autorizarla.";
          } else if (invoice?.autoAuthorization?.status === "authorized") {
            const auth = invoice.autoAuthorization.authorization || {};
            const verified = invoice.autoAuthorization.verification?.matched === true;
            invoiceNotice = ` Factura ${auth.voucherClass || ""} autorizada · PV ${auth.pointOfSale || "-"} · N° ${auth.voucherNumber || "-"}${verified ? " · verificada en ARCA" : " · pendiente de verificación"}.`;
          } else if (invoice?.autoAuthorization?.attempted) {
            invoiceNotice = ` Solicitud fiscal en estado ${invoice.autoAuthorization.status || invoice.status || "pendiente"}; revisar antes de continuar.`;
          } else {
            const dryRun = await dryRunArcaInvoice({ invoiceId: invoice.id });
            if (dryRun?.blocked) {
              invoiceNotice = ` Solicitud fiscal creada, pero el dry-run requiere revisión: ${(dryRun.blockers || []).join(", ") || dryRun.reason || "bloqueada"}.`;
            } else {
              const plan = dryRun?.plan;
              invoiceNotice = plan
                ? ` Dry-run fiscal OK: Factura ${plan.voucherClass} · Neto ${formatMoney(plan.fiscal.net)} · IVA ${formatMoney(plan.fiscal.vat)} · Total ${formatMoney(plan.fiscal.total)}.`
                : " Solicitud fiscal creada en estado pendiente.";
            }
          }
        } catch (invoiceError) {
          invoiceNotice = ` La venta quedó registrada, pero no se pudo preparar/validar la solicitud fiscal: ${invoiceError.message}`;
        }
      }
      if (invoiceId) {
        setRegisteredInvoice({ saleId: result.id, sourceType: "admin_quick_sale", invoiceId });
      }
      setQuantities({});
      setCustomerDni("");
      setPaymentMethod("");
      setInvoiceRequested(false);
      setReceiverVatConditionId("5");
      setReceiverDocument("");
      setDiscountIds([]);
      setSubmitState({ busy: false, error: "", success: `${result.saleCode} registrada por ${formatMoney(result.total)}.${invoiceNotice}` });
      const refreshedStock = await listLocationInventory(locationId);
      setStock({
        status: "ready",
        data: refreshedStock.filter((item) => item.active !== false && item.masterActive !== false),
      });
    } catch (error) {
      setSubmitState({ busy: false, error: error.message, success: "" });
    } finally {
      submitRef.current = false;
    }
  };

  return (
    <div className="fm-page-enter">
      <PageHeader eyebrow="Módulo 03" title="Ventas rápidas" description="Carga ágil para WhatsApp, Instagram, teléfono y operaciones manuales. La confirmación descuenta stock en una transacción." />
      <div className="fm-sale-layout">
        <Panel title="1. Elegí los productos" description="Sólo se muestran productos activos que ya forman parte de la ubicación seleccionada.">
          <FormField label="Ubicación de salida" required>
              <Select value={locationId} onChange={(event) => { setLocationId(event.target.value); setQuantities({}); setDiscountIds([]); }}>
              <option value="">Elegir ubicación</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </Select>
          </FormField>
          {locationsResult.status === "loading" || stock.status === "loading" ? <Skeleton lines={5} /> : null}
          {stock.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo leer el stock" description={stock.error.message} /> : null}
          {stock.status === "ready" && !stock.data.length ? <EmptyState icon="Box" title="No hay productos disponibles" description="Agregá productos al stock de esta ubicación antes de registrar una venta." /> : null}
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
              {appliedDiscounts.length ? <div className="fm-cart-summary__discount"><span>Descuentos</span><strong>− {formatMoney(saleSummary.discountTotal)}</strong></div> : null}
              <div className="fm-cart-summary__total"><span>Total</span><strong>{formatMoney(saleSummary.total)}</strong></div>
            </div>
            {discountsResult.status === "loading" ? <Skeleton lines={2} /> : null}
            {availableDiscounts.length ? <fieldset className="fm-discount-picker"><legend>Descuentos habilitados en {selectedLocation?.name || "la ubicación"}</legend>{availableDiscounts.map((discount) => <label key={discount.id}><input type="checkbox" checked={discountIds.includes(discount.id)} onChange={() => setDiscountIds((current) => current.includes(discount.id) ? current.filter((id) => id !== discount.id) : [...current, discount.id])} /><span>{discount.name} · {discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value)}</span></label>)}</fieldset> : null}
            <div className="fm-form-grid">
              <FormField label="Canal de origen" required><Select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="manual">Carga manual</option><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="phone">Teléfono</option><option value="in_person">Presencial</option></Select></FormField>
              <FormField label="Forma de pago" required><Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="">Elegir medio</option>{PAYMENT_OPTIONS.filter((option) => option.value !== "multiple").map((option) => <option key={option.value} value={option.value}>{friendlyPayments[option.value]}</option>)}</Select></FormField>
              <FormField label="DNI del cliente" hint="Se completa al final para no frenar la venta."><input inputMode="numeric" value={customerDni} onChange={(event) => setCustomerDni(event.target.value.replace(/\D/g, "").slice(0, 9))} /></FormField>
              <FormField label="Entrega" required><Select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value)}><option value="pickup">Retiro</option><option value="shipping">Requiere envío</option></Select></FormField>
            </div>
            <label className="fm-check-row"><input type="checkbox" checked={invoiceRequested} onChange={(event) => setInvoiceRequested(event.target.checked)} /><span>Solicitar factura después de registrar la venta</span></label>
            {invoiceRequested ? (
              <div className="fm-form-grid">
                <FormField label="Condición IVA receptor" required>
                  <Select value={receiverVatConditionId} onChange={(event) => { setReceiverVatConditionId(event.target.value); setReceiverDocument(""); }}>
                    <option value="5">Consumidor Final</option>
                    <option value="1">IVA Responsable Inscripto</option>
                    <option value="6">Responsable Monotributo</option>
                    <option value="4">IVA Sujeto Exento</option>
                  </Select>
                </FormField>
                <FormField
                  label={receiverVatConditionId === "5" ? "Documento fiscal (opcional)" : "CUIT del receptor"}
                  hint={receiverVatConditionId === "5"
                    ? "Si queda vacío se usa el DNI del cliente; si tampoco hay DNI, el backend valida si puede emitirse como Consumidor Final sin identificar."
                    : "Ingresá la CUIT de 11 dígitos del receptor."}
                  required={receiverVatConditionId !== "5"}
                >
                  <input
                    inputMode="numeric"
                    value={receiverDocument}
                    onChange={(event) => setReceiverDocument(event.target.value.replace(/\D/g, "").slice(0, 11))}
                  />
                </FormField>
              </div>
            ) : null}
            {submitState.error ? <Toast tone="error">{submitState.error}</Toast> : null}
            {submitState.success ? <Toast tone="success">{submitState.success}</Toast> : null}
            {registeredInvoice ? <ArcaInvoicePrintAction {...registeredInvoice} /> : null}
            <Button type="submit" icon="Check" loading={submitState.busy} disabled={!cart.length || !paymentMethod} className="fm-sale-submit">Confirmar venta</Button>
            <p className="fm-safe-note"><Badge tone="success" icon="ShieldCheck">Operación atómica</Badge> Si falta stock o se corta la conexión, la venta completa se revierte.</p>
          </Panel>
        </form>
      </div>
    </div>
  );
}
