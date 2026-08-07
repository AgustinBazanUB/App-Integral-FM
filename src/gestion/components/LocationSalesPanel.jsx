import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Skeleton,
  Toast,
} from "../../design-system";
import {
  saleDiscountList,
  storedDiscountTotals,
} from "../../modules/locations/domain/discounts";
import { argentinaDateKey } from "../../modules/locations/domain/time";
import { salePaymentParts } from "../../modules/locations/domain/payments";
import { can, canAccessAdministration } from "../permissions";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  statusTone,
  toDate,
} from "../formatters";
import { cancelSellerSale } from "../services/sellerService";
import { listLocationSalesPage } from "../services/locationSalesService";
import { Icon } from "./icons";

const paymentLabels = {
  cash: "Efectivo",
  debit: "Débito",
  credit: "Crédito",
  alias: "Alias / transferencia",
  multiple: "+2 pagos",
};

const ticketLabels = {
  pending: "Pendiente",
  emitted: "Emitido",
  error: "Error",
  cancelled: "Anulado",
  canceled: "Anulado",
};

function ticketStatus(sale) {
  if (!sale.ticketRequested) return { label: "No solicitado", tone: "neutral" };
  const value = String(sale.ticketStatus || "pending").toLowerCase();
  return {
    label: ticketLabels[value] || value,
    tone: value === "emitted" ? "success" : value === "error" ? "error" : value === "cancelled" || value === "canceled" ? "neutral" : "warning",
  };
}

function saleStatusLabel(status) {
  return String(status || "active").toLowerCase() === "active" ? "Activa" : "Anulada";
}

function productImage(item, productMap) {
  const product = productMap.get(item.productId);
  return product?.thumbUrl || product?.imageUrl || "/images/flor-mia/logo-flor-mia.svg";
}

export default function LocationSalesPanel({ profile, location, products = [] }) {
  const [state, setState] = useState({ status: "loading", items: [], cursor: null, hasMore: false, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [filters, setFilters] = useState({ date: "", sellerId: "", status: "", paymentMethod: "" });
  const [detail, setDetail] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionState, setActionState] = useState({ busy: false, error: "", success: "" });

  const closeDetail = useCallback(() => setDetail(null), []);
  const closeCancelDialog = useCallback(() => {
    setCancelTarget(null);
    setCancelReason("");
  }, []);

  const loadFirstPage = useCallback(async () => {
    setState({ status: "loading", items: [], cursor: null, hasMore: false, error: null });
    try {
      const page = await listLocationSalesPage({ profile, locationId: location.id });
      setState({ status: "ready", items: page.items, cursor: page.cursor, hasMore: page.hasMore, error: null });
    } catch (error) {
      setState({ status: "error", items: [], cursor: null, hasMore: false, error });
    }
  }, [profile, location.id]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (!state.hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listLocationSalesPage({
        profile,
        locationId: location.id,
        cursor: state.cursor,
      });
      setState((current) => ({
        status: "ready",
        error: null,
        items: [...current.items, ...page.items.filter((sale) => !current.items.some((existing) => existing.id === sale.id))],
        cursor: page.cursor,
        hasMore: page.hasMore,
      }));
    } catch (error) {
      setActionState({ busy: false, error: error.message, success: "" });
    } finally {
      setLoadingMore(false);
    }
  };

  const sellers = useMemo(() => {
    const map = new Map();
    state.items.forEach((sale) => {
      if (sale.sellerId) map.set(sale.sellerId, sale.sellerName || sale.sellerId);
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [state.items]);

  const visibleSales = useMemo(() => state.items.filter((sale) => {
    if (filters.sellerId && sale.sellerId !== filters.sellerId) return false;
    if (filters.status && String(sale.status || "active") !== filters.status) return false;
    if (filters.paymentMethod && sale.paymentMethod !== filters.paymentMethod) return false;
    if (filters.date) {
      const date = toDate(sale.createdAt);
      if (!date || argentinaDateKey(date) !== filters.date) return false;
    }
    return true;
  }), [filters, state.items]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.productId || product.id, product])),
    [products],
  );

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setActionState({ busy: true, error: "", success: "" });
    try {
      await cancelSellerSale({ profile, saleId: cancelTarget.id, reason: cancelReason });
      closeCancelDialog();
      setDetail(null);
      setActionState({ busy: false, error: "", success: "Venta anulada y stock devuelto correctamente." });
      await loadFirstPage();
    } catch (error) {
      setActionState({ busy: false, error: error.message, success: "" });
    }
  };

  const canCancel = (sale) => sale?.status === "active" && (
    canAccessAdministration(profile) ||
    (can(profile, "quick-sales", "cancelOwn") && sale.sellerId === profile.id)
  );
  const detailDiscounts = saleDiscountList(detail);
  const detailDiscountTotals = storedDiscountTotals(detail || {});
  const detailPayments = salePaymentParts(detail || {});
  const detailTicket = ticketStatus(detail || {});

  return (
    <div className="fm-location-sales">
      <div className="fm-location-sales__intro">
        <div>
          <h2>Registro de ventas</h2>
          <p>Una única fuente: documentos de <code>sales</code> filtrados por esta ubicación.</p>
        </div>
        <Button variant="secondary" icon="RefreshCw" onClick={loadFirstPage}>Actualizar</Button>
      </div>

      <div className="fm-location-sales__filters" aria-label="Filtros del registro de ventas">
        <label><span>Fecha</span><input type="date" value={filters.date} onChange={(event) => setFilters((current) => ({ ...current, date: event.target.value }))} /></label>
        <label><span>Vendedor</span><select value={filters.sellerId} onChange={(event) => setFilters((current) => ({ ...current, sellerId: event.target.value }))}><option value="">Todos</option>{sellers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>Estado</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos</option><option value="active">Activas</option><option value="cancelled">Anuladas</option></select></label>
        <label><span>Forma de pago</span><select value={filters.paymentMethod} onChange={(event) => setFilters((current) => ({ ...current, paymentMethod: event.target.value }))}><option value="">Todas</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>

      {actionState.error ? <Toast tone="error">{actionState.error}</Toast> : null}
      {actionState.success ? <Toast tone="success">{actionState.success}</Toast> : null}
      {state.status === "loading" ? <Skeleton lines={6} /> : null}
      {state.status === "error" ? <EmptyState icon="AlertTriangle" title="No se pudo cargar el registro" description={state.error.message} /> : null}

      {state.status === "ready" ? (
        <div className="fm-location-sales__list">
          {visibleSales.map((sale) => {
            const ticket = ticketStatus(sale);
            return (
              <button key={sale.id} type="button" onClick={() => setDetail(sale)}>
                <div className="fm-location-sale__primary"><strong>{sale.saleCode || sale.id}</strong><span>{formatDateTime(sale.createdAt)}</span></div>
                <div className="fm-location-sale__seller"><Icon name="UserRound" /><span>{sale.sellerName || "Vendedor"}</span></div>
                <div className="fm-location-sale__meta"><span>{Number(sale.totalItems || 0)} productos</span><span>{paymentLabels[sale.paymentMethod] || sale.paymentMethodLabel || "Sin pago"}</span></div>
                <strong className="fm-location-sale__total">{formatMoney(sale.total)}</strong>
                <div className="fm-location-sale__badges"><Badge tone={statusTone(sale.status)}>{saleStatusLabel(sale.status)}</Badge>{sale.ticketRequested ? <Badge tone={ticket.tone}>Ticket {ticket.label}</Badge> : null}</div>
              </button>
            );
          })}
          {!visibleSales.length ? <EmptyState icon="ReceiptText" title="No hay ventas para estos filtros" description={state.items.length ? "Ajustá los filtros o cargá más historial." : "Las ventas registradas en esta ubicación aparecerán automáticamente aquí."} /> : null}
        </div>
      ) : null}
      {state.status === "ready" && state.hasMore ? <div className="fm-location-sales__more"><Button variant="secondary" loading={loadingMore} onClick={loadMore}>Cargar más ventas</Button></div> : null}

      <Modal
        open={Boolean(detail)}
        onClose={closeDetail}
        title={detail?.saleCode || "Detalle de venta"}
        className="fm-location-sale-detail-modal"
        footer={canCancel(detail) ? <div className="fm-dialog-actions"><Button variant="destructive" onClick={() => { const sale = detail; setDetail(null); setCancelReason(""); setCancelTarget(sale); }}>Anular venta</Button></div> : null}
      >
        {detail ? (
          <div className="fm-location-sale-detail">
            <section className="fm-location-sale-detail__header">
              <div><span>Estado</span><Badge tone={statusTone(detail.status)}>{saleStatusLabel(detail.status)}</Badge></div>
              <div><span>Fecha</span><strong>{formatDate(detail.createdAt)}</strong></div>
              <div><span>Fecha y hora</span><strong>{formatDateTime(detail.createdAt)}</strong></div>
              <div><span>Ubicación</span><strong>{detail.locationName || location.name}</strong></div>
              <div><span>Vendedor</span><strong>{detail.sellerName || detail.sellerId}</strong></div>
            </section>

            <section><h3>Productos</h3><div className="fm-location-sale-detail__items">{(detail.items || []).map((item) => <article key={item.productId}><img src={productImage(item, productMap)} alt="" /><div><strong>{item.name}</strong><span>{item.abbreviation || "Sin abreviación"}</span></div><span>{item.qty} u.</span><span>{formatMoney(item.unitPrice)} c/u</span><strong>{formatMoney(item.subtotal)}</strong></article>)}</div></section>

            <section><h3>Descuentos</h3>{detailDiscounts.length ? <div className="fm-location-sale-detail__discounts">{detailDiscounts.map((discount, index) => <div key={`${discount.discountId || "manual"}-${index}`}><span><strong>{discount.name || "Descuento"}</strong><small>{discount.source === "manual" ? "Manual" : "Guardado"} · {discount.type === "percent" ? "Porcentaje" : "Monto fijo"} · {discount.type === "percent" ? `${discount.value}%` : formatMoney(discount.value)}</small></span><strong>− {formatMoney(discount.amountApplied)}</strong></div>)}</div> : <p className="fm-muted">Sin descuentos.</p>}</section>

            <section><h3>Pagos</h3><div className="fm-location-sale-detail__payments">{detailPayments.length ? detailPayments.map((payment) => <div key={payment.method}><span>{paymentLabels[payment.method] || payment.label}</span><strong>{formatMoney(payment.amount)}</strong></div>) : <div><span>{paymentLabels[detail.paymentMethod] || detail.paymentMethodLabel || "Sin forma de pago"}</span><strong>{formatMoney(detail.total)}</strong></div>}</div></section>

            <section className="fm-location-sale-detail__totals">
              <div><span>Subtotal</span><strong>{formatMoney(detail.subtotal ?? detail.totalBeforeDiscounts ?? detail.total)}</strong></div>
              <div><span>Descuentos fijos</span><strong>− {formatMoney(detailDiscountTotals.fixedDiscountTotal)}</strong></div>
              <div><span>Descuentos porcentuales</span><strong>− {formatMoney(detailDiscountTotals.percentageDiscountTotal)}</strong></div>
              <div><span>Total descuentos</span><strong>− {formatMoney(detailDiscountTotals.discountTotal)}</strong></div>
              <div className="is-grand"><span>Total final</span><strong>{formatMoney(detail.total)}</strong></div>
            </section>

            <section><h3>Ticket</h3><div className="fm-location-sale-detail__ticket"><Icon name="ReceiptText" /><span>{detail.ticketRequested ? "Solicitado" : "No solicitado"}</span><Badge tone={detailTicket.tone}>{detailTicket.label}</Badge></div></section>

            <section><h3>Auditoría</h3><dl className="fm-location-sale-detail__audit"><div><dt>Usuario creador</dt><dd>{detail.createdByName || detail.sellerName || detail.createdBy || detail.sellerId || "Sin dato"}</dd></div><div><dt>Creación</dt><dd>{formatDateTime(detail.createdAt)}</dd></div>{detail.editedAt ? <><div><dt>Última edición</dt><dd>{formatDateTime(detail.editedAt)}</dd></div><div><dt>Editado por</dt><dd>{detail.editedByName || detail.editedBy || "Sin dato"}</dd></div></> : null}{detail.cancelledAt ? <><div><dt>Anulación</dt><dd>{formatDateTime(detail.cancelledAt)}</dd></div><div><dt>Anulada por</dt><dd>{detail.cancelledByName || detail.cancelledBy || "Sin dato"}</dd></div><div><dt>Motivo</dt><dd>{detail.cancelReason || "Sin motivo registrado"}</dd></div></> : null}</dl></section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(cancelTarget)}
        onClose={closeCancelDialog}
        title="Anular venta"
        description="Las unidades volverán al stock y el documento de venta conservará su historial."
        footer={<div className="fm-dialog-actions"><Button variant="secondary" onClick={closeCancelDialog}>Cancelar</Button><Button variant="destructive" loading={actionState.busy} onClick={confirmCancel}>Anular y devolver stock</Button></div>}
      >
        <label className="fm-field">
          <span>Motivo de anulación (opcional)</span>
          <textarea rows="2" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej.: error de carga o devolución inmediata" />
          <small className="fm-field__hint">Si no ingresás un motivo, la anulación igualmente conserva usuario y fecha en auditoría.</small>
        </label>
      </Modal>
    </div>
  );
}
