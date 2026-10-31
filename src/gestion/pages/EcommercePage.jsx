import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Panel,
  PageHeader,
  FormField,
  Select,
} from "../../design-system";
import { Link, useNavigate } from "../../router";
import {
  ecommerceAdminRequest,
  subscribeWebCommerce,
} from "../services/ecommerceAdminService";
import {
  simulateApprovedEcommercePayment,
  fetchEcommerceSimulationCapability,
} from "../../services/ecommerceService";
import { formatMoney, formatDateTime } from "../formatters";
import SaleInvoicePanel from "../components/SaleInvoicePanel";

const empty = {
  active: false,
  defaultOrigin: { type: "location", id: "" },
  authorizedOrigins: [],
  authorizedUserIds: [],
  pickup: { enabled: false, locationId: "", address: "" },
  delivery: { enabled: false, rates: [] },
};
export default function EcommercePage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null),
    [channel, setChannel] = useState(empty),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [configure, setConfigure] = useState(false),
    [configurationSection, setConfigurationSection] = useState("channel"),
    [productDrafts, setProductDrafts] = useState({}),
    [promotionForm, setPromotionForm] = useState(null),
    [selected, setSelected] = useState(null),
    [origin, setOrigin] = useState(""),
    [reason, setReason] = useState(""),
    [rates, setRates] = useState(""),
    [simulation, setSimulation] = useState(false),
    [availability, setAvailability] = useState([]);
  const attempt = useRef(null),
    lock = useRef(false);
  const refresh = async () => {
    const result = await ecommerceAdminRequest({ mode: "resources" });
    setData(result);
    return result;
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    fetchEcommerceSimulationCapability()
      .then((value) => setSimulation(value.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!data) return;
    setProductDrafts(Object.fromEntries((data.products || []).map((product) => {
      const saved = data.productSettings?.[product.id] || {};
      return [product.id, {
        enabled: saved.enabled !== false,
        priceOverride: saved.priceOverride ?? "",
        minimumRemainingStock: saved.minimumRemainingStock ?? 0,
        sourceAlertThresholds: { ...(saved.sourceAlertThresholds || {}) },
      }];
    })));
  }, [data?.productSettings, data?.products]);
  useEffect(
    () =>
      subscribeWebCommerce(
        (orders) =>
          setData((current) => (current ? { ...current, orders } : current)),
        (sales) =>
          setData((current) => (current ? { ...current, sales } : current)),
        (e) => setError(e.message),
      ),
    [],
  );
  const run = async (identity, action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    if (attempt.current?.identity !== identity)
      attempt.current = { identity, id: crypto.randomUUID() };
    try {
      await action(attempt.current.id);
      attempt.current = null;
      await refresh();
      setSelected(null);
    } catch (e) {
      setError(e.message);
      const latest = await refresh().catch(() => null);
      if (latest && selected)
        setSelected(
          latest.orders.find((row) => row.id === selected.id) || null,
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const origins = data
    ? data.stockOrigins || []
    : [];
  const channelOriginOptions = [
    ...origins,
    ...((channel.authorizedOrigins || [])
      .filter((item) => !origins.some((row) => row.type === item.type && row.id === item.id))
      .map((item) => {
        const source = item.type === "warehouse"
          ? data?.warehouses?.find((row) => row.id === item.id)
          : data?.locations?.find((row) => row.id === item.id);
        return { ...item, name: source?.name || item.id, disallowed: true };
      })),
  ];
  const edit = () => {
    const current = data.channel || empty;
    setChannel(structuredClone(current));
    setRates(
      (current.delivery?.rates || [])
        .map(
          (rate) =>
            `${rate.province}|${rate.postalCodes.join(",")}|${rate.amount}|${rate.arcaVatRate ?? ""}`,
        )
        .join("\n"),
    );
    setConfigure(!configure);
  };
  const save = () =>
    run(JSON.stringify([channel, rates]), async (requestId) => {
      const parsed = rates.trim()
        ? rates
            .trim()
            .split("\n")
            .map((line, index) => {
              const [province, codes, amount, vat] = line.split("|");
              return {
                id: `rate_${index + 1}`,
                name: province?.trim(),
                province: province?.trim(),
                postalCodes: (codes || "").split(",").map((v) => v.trim()),
                amount: amount?.trim() ? Number(amount) : NaN,
                arcaVatRate: vat?.trim() ? Number(vat) : null,
              };
            })
        : [];
      await ecommerceAdminRequest({
        mode: "configure",
        requestId,
        channel: {
          ...channel,
          delivery: { ...channel.delivery, rates: parsed },
        },
      });
      setConfigure(false);
    });
  const updateProductDraft = (productId, key, value) =>
    setProductDrafts((current) => ({
      ...current,
      [productId]: { ...(current[productId] || {}), [key]: value },
    }));
  const saveProduct = (productId) => {
    const draft = productDrafts[productId] || {};
    const settings = {
      ...draft,
      priceOverride: draft.priceOverride === "" ? null : Number(draft.priceOverride),
      minimumRemainingStock: Number(draft.minimumRemainingStock || 0),
      sourceAlertThresholds: Object.fromEntries(
        Object.entries(draft.sourceAlertThresholds || {}).map(([key, value]) => [key, Number(value || 0)]),
      ),
    };
    run(JSON.stringify(["product", productId, settings]), (requestId) =>
      ecommerceAdminRequest({ mode: "save-product", requestId, productId, settings }),
    );
  };
  const startPromotion = (promotion = null) => {
    setPromotionForm(promotion
      ? { productId: promotion.productId || promotion.id, name: promotion.name || "", price: String(promotion.price ?? ""), active: promotion.active === true }
      : { productId: "", name: "", price: "", active: true });
  };
  const savePromotion = () => {
    if (!promotionForm) return;
    const promotion = { ...promotionForm, price: Number(promotionForm.price) };
    run(JSON.stringify(["promotion", promotion]), async (requestId) => {
      await ecommerceAdminRequest({ mode: "save-promotion", requestId, productId: promotion.productId, promotion });
      setPromotionForm(null);
    });
  };
  const select = async (order) => {
    setSelected(order);
    setOrigin(`${order.stockOriginType}:${order.stockOriginId}`);
    setReason("");
    setAvailability([]);
    try {
      setAvailability(
        await ecommerceAdminRequest({
          mode: "availability",
          orderId: order.id,
        }),
      );
    } catch (e) {
      setError(e.message);
    }
  };
  const openOrder = (order) => {
    if (order.shipmentId) {
      navigate(`/gestion/shipping?shipment=${encodeURIComponent(order.shipmentId)}`);
      return;
    }
    void select(order);
  };
  const productGroups = (data?.products || []).reduce((groups, product) => {
    const category = data.categories?.find((row) => row.id === product.categoryId);
    const categoryName = category?.name || product.categoryName || "Sin catálogo";
    (groups[categoryName] ||= []).push(product);
    return groups;
  }, {});
  const configuredSourceKeys = new Set((data?.channel?.authorizedOrigins || []).map((row) => `${row.type}:${row.id}`));
  const stockRowsFor = (product) => {
    const rows = data?.stockByProduct?.[product.id] || [];
    return origins.map((source) => rows.find((row) => row.type === source.type && row.originId === source.id)
      || { productId: product.id, type: source.type, originId: source.id, originName: source.name, currentStock: 0, reservedStock: 0, active: false });
  };
  const lowStockAlerts = (data?.products || []).flatMap((product) => {
    const thresholds = data.productSettings?.[product.id]?.sourceAlertThresholds || {};
    return stockRowsFor(product).flatMap((row) => {
      const threshold = Number(thresholds[`${row.type}:${row.originId}`] || 0);
      const remaining = Math.max(0, row.currentStock - row.reservedStock);
      return threshold > 0 && remaining <= threshold
        ? [{ productId: product.id, productName: product.name, originName: row.originName, type: row.type, remaining, threshold }]
        : [];
    });
  });
  const action = (mode) =>
    run(JSON.stringify([mode, selected?.id, origin, reason]), (requestId) =>
      ecommerceAdminRequest({
        mode,
        orderId: selected.id,
        requestId,
        origin: { type: origin.split(":")[0], id: origin.split(":")[1] },
        reason,
      }),
    );
  return (
    <div>
      <PageHeader
        title="Página web / E-commerce"
        description="Pedidos web, logística y configuración de e-commerce."
        actions={
          <Button onClick={edit} disabled={!data}>
            Configuración e-commerce
          </Button>
        }
      />
      {error && (
        <p role="alert" className="fm-error">
          {error}
        </p>
      )}
      {configure && (
        <Panel title="Configuración e-commerce">
          <nav aria-label="Secciones de configuración e-commerce" className="fm-ecommerce-config-tabs">
            {[["channel", "Canal y entregas"], ["promotions", "Promociones"], ["products", "Productos y stock"]].map(([key, label]) => (
              <Button key={key} variant={configurationSection === key ? "primary" : "secondary"} onClick={() => setConfigurationSection(key)}>
                {label}
              </Button>
            ))}
          </nav>
          {configurationSection === "channel" && <>
          <div className="fm-ecommerce-config-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
            <p>Configurá el canal, sus orígenes y las opciones de entrega.</p>
            <Link className="fm-button fm-button--secondary" to="/gestion/metrics/sales?channel=ecommerce">
              Ver métricas de ventas web
            </Link>
          </div>
          <label>
            <input
              type="checkbox"
              checked={channel.active}
              onChange={(e) =>
                setChannel({ ...channel, active: e.target.checked })
              }
            />{" "}
            Canal activo
          </label>
          <p>
            El stock web se suma automáticamente desde los locales y depósitos seleccionados. Las ferias y los eventos no pueden usarse como origen.
          </p>
          <FormField label="Transporte predeterminado">
            <Select
              value={channel.defaultTransport || "repository"}
              onChange={(e) =>
                setChannel({ ...channel, defaultTransport: e.target.value })
              }
            >
              <option value="repository">Repositorio</option>
              <option value="uber">Uber</option>
              <option value="manual">Manual</option>
            </Select>
          </FormField>
          <fieldset>
            <legend>
              Administradores autorizados para confirmar operaciones
            </legend>
            <p>
              Sin selección, se admiten los administradores activos del sistema.
            </p>
            {(data.users || []).map((user) => (
              <label key={user.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={(channel.authorizedUserIds || []).includes(user.id)}
                  onChange={(e) =>
                    setChannel({
                      ...channel,
                      authorizedUserIds: e.target.checked
                        ? [...(channel.authorizedUserIds || []), user.id]
                        : (channel.authorizedUserIds || []).filter(
                            (id) => id !== user.id,
                          ),
                    })
                  }
                />
                {user.name}
              </label>
            ))}
          </fieldset>
          <FormField label="Origen predeterminado">
            <Select
              value={`${channel.defaultOrigin?.type}:${channel.defaultOrigin?.id}`}
              onChange={(e) => {
                const [type, id] = e.target.value.split(":");
                setChannel({
                  ...channel,
                  defaultOrigin: { type, id },
                  authorizedOrigins: [
                    ...channel.authorizedOrigins.filter(
                      (row) => row.id !== id || row.type !== type,
                    ),
                    { type, id },
                  ],
                });
              }}
            >
              <option value="location:">Elegí el origen real</option>
              {origins.map((row) => (
                <option
                  key={`${row.type}:${row.id}`}
                  value={`${row.type}:${row.id}`}
                >
                  {row.name} ·{" "}
                  {row.type === "warehouse" ? "Depósito" : "Local"}
                </option>
              ))}
            </Select>
          </FormField>
          <fieldset>
            <legend>Locales y depósitos que abastecen la web</legend>
            <p>La disponibilidad combina el stock de los orígenes elegidos; el sitio sólo muestra si un producto está disponible, nunca sus unidades.</p>
            {channelOriginOptions.map((row) => (
              <label key={`${row.type}:${row.id}`} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={channel.authorizedOrigins.some(
                    (item) => item.type === row.type && item.id === row.id,
                  )}
                  onChange={(e) =>
                    setChannel({
                      ...channel,
                      authorizedOrigins: e.target.checked
                        ? [
                            ...channel.authorizedOrigins,
                            { type: row.type, id: row.id },
                          ]
                        : channel.authorizedOrigins.filter(
                            (item) =>
                              item.type !== row.type || item.id !== row.id,
                          ),
                    })
                  }
                />
                {row.name}{row.disallowed ? " · origen excluido; desmarcalo" : ""}
              </label>
            ))}
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={channel.pickup.enabled}
              onChange={(e) =>
                setChannel({
                  ...channel,
                  pickup: { ...channel.pickup, enabled: e.target.checked },
                })
              }
            />{" "}
            Habilitar retiro presencial
          </label>
          <FormField label="Punto de retiro">
            <Select
              value={channel.pickup.locationId}
              onChange={(e) => {
                const row = data.locations.find(
                  (row) => row.id === e.target.value,
                );
                setChannel({
                  ...channel,
                  pickup: {
                    ...channel.pickup,
                    locationId: row?.id || "",
                    name: row?.name || "",
                    address: row?.address || "",
                  },
                });
              }}
            >
              <option value="">Elegí una ubicación</option>
              {data.locations.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Dirección del punto de retiro">
            <input
              value={channel.pickup.address}
              onChange={(e) =>
                setChannel({
                  ...channel,
                  pickup: { ...channel.pickup, address: e.target.value },
                })
              }
            />
          </FormField>
          <label>
            <input
              type="checkbox"
              checked={channel.delivery.enabled}
              onChange={(e) =>
                setChannel({
                  ...channel,
                  delivery: { ...channel.delivery, enabled: e.target.checked },
                })
              }
            />{" "}
            Habilitar envío a domicilio
          </label>
          <FormField label="Tarifas de envío">
            <textarea
              rows={4}
              value={rates}
              onChange={(e) => setRates(e.target.value)}
              placeholder="Provincia|códigos postales separados por coma|importe ARS|IVA %"
            />
          </FormField>
          <p>
            Una tarifa por línea: provincia, códigos postales importe e IVA %
            separados por |. Ingresá únicamente tarifas comerciales verificadas.
          </p>
          <Button loading={busy} onClick={save}>
            Guardar configuración
          </Button>
          </>}
          {configurationSection === "promotions" && (
            <div className="fm-ecommerce-promotions-config">
              <div className="fm-ecommerce-config-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <p>Creá precios promocionales por producto y activalos cuando quieras. Cada producto admite una promoción web.</p>
                <Button onClick={() => startPromotion()}>Nueva promoción</Button>
              </div>
              {promotionForm && (
                <Panel title={promotionForm.productId ? "Editar promoción" : "Nueva promoción"}>
                  <FormField label="Producto">
                    <Select value={promotionForm.productId} onChange={(e) => setPromotionForm({ ...promotionForm, productId: e.target.value })}>
                      <option value="">Elegí un producto</option>
                      {(data.products || []).filter((product) => !data.promotions?.[product.id] || product.id === promotionForm.productId).map((product) => (
                        <option key={product.id} value={product.id}>{product.name}</option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Nombre de la promoción">
                    <input value={promotionForm.name} maxLength={150} onChange={(e) => setPromotionForm({ ...promotionForm, name: e.target.value })} placeholder="Ej.: Promo de temporada" />
                  </FormField>
                  <FormField label="Precio promocional web (ARS)">
                    <input type="number" min="1" step="1" value={promotionForm.price} onChange={(e) => setPromotionForm({ ...promotionForm, price: e.target.value })} />
                  </FormField>
                  <label>
                    <input type="checkbox" checked={promotionForm.active} onChange={(e) => setPromotionForm({ ...promotionForm, active: e.target.checked })} /> Promoción habilitada
                  </label>
                  <div className="fm-shipping-actions">
                    <Button loading={busy} disabled={!promotionForm.productId || !promotionForm.name.trim() || !promotionForm.price} onClick={savePromotion}>Guardar promoción</Button>
                    <Button variant="secondary" onClick={() => setPromotionForm(null)}>Cancelar</Button>
                  </div>
                </Panel>
              )}
              {Object.keys(data.promotions || {}).length === 0 ? <p>No hay promociones configuradas.</p> : (
                <div className="fm-table-scroll">
                  <table className="fm-data-table">
                    <thead><tr><th>Promoción</th><th>Producto</th><th>Precio web</th><th>Estado</th><th>Acción</th></tr></thead>
                    <tbody>{Object.values(data.promotions).map((promotion) => {
                      const product = data.products.find((row) => row.id === promotion.productId || row.id === promotion.id);
                      return <tr key={promotion.id || promotion.productId}>
                        <td>{promotion.name}</td><td>{product?.name || "Producto no disponible"}</td>
                        <td>{formatMoney(promotion.price)}</td><td>{promotion.active ? "Habilitada" : "Deshabilitada"}</td>
                        <td><Button variant="secondary" onClick={() => startPromotion(promotion)}>Editar</Button></td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {configurationSection === "products" && (
            <div className="fm-ecommerce-products-config">
              <p>Los cambios de precio y disponibilidad se aplican sólo al catálogo web. El stock se calcula con los orígenes del canal, descontando las reservas y el mínimo que quieras conservar.</p>
              <Panel title={`Alertas de stock${lowStockAlerts.length ? ` · ${lowStockAlerts.length}` : ""}`}>
                {lowStockAlerts.length ? <ul className="fm-ecommerce-stock-alert-list">
                  {lowStockAlerts.map((alert) => <li key={`${alert.productId}:${alert.type}:${alert.originName}`}>
                    <Badge tone={alert.remaining === 0 ? "error" : "warning"}>{alert.remaining === 0 ? "Sin stock" : "Stock bajo"}</Badge>
                    <strong>{alert.productName}</strong>
                    <span>{alert.originName} · {alert.type === "warehouse" ? "depósito" : "local"}: {alert.remaining} disponibles (aviso en {alert.threshold})</span>
                  </li>)}
                </ul> : <p>No hay alertas activas. Configurá umbrales por local o depósito en cada producto.</p>}
              </Panel>
              {Object.entries(productGroups).map(([categoryName, products]) => (
                <Panel key={categoryName} title={categoryName}>
                  <div className="fm-ecommerce-product-config-list">
                    {products.map((product) => {
                      const draft = productDrafts[product.id] || { enabled: true, priceOverride: "", minimumRemainingStock: 0, sourceAlertThresholds: {} };
                      const stockRows = stockRowsFor(product);
                      const totalRemaining = stockRows.filter((row) => configuredSourceKeys.has(`${row.type}:${row.originId}`)).reduce((sum, row) => sum + Math.max(0, row.currentStock - row.reservedStock), 0);
                      const webAvailable = Math.max(0, totalRemaining - Number(draft.minimumRemainingStock || 0));
                      return <article key={product.id} className="fm-ecommerce-product-config">
                        <div className="fm-ecommerce-product-config__header">
                          <div><h3>{product.name}</h3><p>{product.abbreviation || product.categoryName || "Producto del catálogo"}</p></div>
                          <label><input type="checkbox" checked={draft.enabled !== false} onChange={(e) => updateProductDraft(product.id, "enabled", e.target.checked)} /> Disponible en la web</label>
                        </div>
                        <div className="fm-ecommerce-product-config__fields">
                          <FormField label="Precio web (ARS)"><input type="number" min="1" step="1" value={draft.priceOverride} placeholder={product.defaultPrice ? `Habitual: ${formatMoney(product.defaultPrice)}` : "Ingresá un precio web"} onChange={(e) => updateProductDraft(product.id, "priceOverride", e.target.value)} /></FormField>
                          <FormField label="Stock mínimo a conservar"><input type="number" min="0" step="1" value={draft.minimumRemainingStock} onChange={(e) => updateProductDraft(product.id, "minimumRemainingStock", e.target.value)} /></FormField>
                          <div className="fm-ecommerce-product-config__availability">Stock ofrecible desde orígenes web: <strong>{webAvailable} unidades</strong></div>
                        </div>
                        <fieldset className="fm-ecommerce-product-config__sources">
                          <legend>Alertas por origen</legend>
                          {stockRows.length ? stockRows.map((row) => {
                            const key = `${row.type}:${row.originId}`;
                            const remaining = Math.max(0, row.currentStock - row.reservedStock);
                            const threshold = Number(draft.sourceAlertThresholds?.[key] || 0);
                            return <div key={key} className="fm-ecommerce-product-config__source">
                              <span>{row.originName} · {row.type === "warehouse" ? "Depósito" : "Local"}: {remaining} disponibles</span>
                              <FormField label="Avisar al llegar a"><input type="number" min="0" step="1" value={draft.sourceAlertThresholds?.[key] ?? 0} onChange={(e) => updateProductDraft(product.id, "sourceAlertThresholds", { ...draft.sourceAlertThresholds, [key]: e.target.value })} /></FormField>
                              {threshold > 0 && remaining <= threshold ? <Badge tone="warning">Stock bajo</Badge> : null}
                            </div>;
                          }) : <p>Elegí locales o depósitos en “Canal y entregas” para asignar stock.</p>}
                        </fieldset>
                        <Button loading={busy} onClick={() => saveProduct(product.id)}>Guardar configuración web</Button>
                      </article>;
                    })}
                  </div>
                </Panel>
              ))}
              {!Object.keys(productGroups).length ? <p>No hay productos activos en el catálogo.</p> : null}
            </div>
          )}
        </Panel>
      )}
      {selected && !selected.shipmentId && (
        <Panel title={`Pedido ${selected.orderCode || selected.id}`}>
          <p>
            {selected.customer.fullName} · {selected.customer.phone} ·{" "}
            {selected.customer.email}
          </p>
          <p>
            {selected.items
              .map((item) => `${item.quantity} × ${item.name}`)
              .join(" · ")}
          </p>
          <p>
            Pago: {selected.paymentStatus} · Fiscal: {selected.invoiceStatus} ·{" "}
            {selected.shipping.method === "pickup"
              ? "Retiro presencial"
              : "Envío a domicilio"}
          </p>
          {selected.pickupCode && (
            <p>
              Código de retiro: <strong>{selected.pickupCode}</strong>
            </p>
          )}
          {selected.saleId &&
            data.sales.find((row) => row.id === selected.saleId) && (
              <SaleInvoicePanel
                sale={data.sales.find((row) => row.id === selected.saleId)}
                allowGenerate={false}
              />
            )}
          <FormField label="Origen físico del pedido">
            <Select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {(availability.length ? availability : origins).map((row) => (
                <option
                  key={`${row.type}:${row.id}`}
                  value={`${row.type}:${row.id}`}
                >
                  {row.name}
                  {row.availability
                    ? ` · ${row.availability.map((item) => `${item.name}: ${item.available}/${item.required}`).join(", ")}`
                    : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Motivo del cambio o cancelación">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={1000}
            />
          </FormField>
          <div className="fm-shipping-actions">
            <Button
              disabled={busy || reason.trim().length < 4}
              onClick={() => action("origin")}
            >
              Cambiar origen
            </Button>
            {selected.status === "pending_payment" && (
              <>
                <Button
                  disabled={busy || reason.trim().length < 4}
                  variant="secondary"
                  onClick={() => action("cancel")}
                >
                  Cancelar pedido y liberar reserva
                </Button>
                <Button
                  disabled={busy || reason.trim().length < 4}
                  variant="secondary"
                  onClick={() => action("expire")}
                >
                  Liberar reserva vencida
                </Button>
              </>
            )}
            {simulation &&
              ["pending_payment", "confirmed"].includes(selected.status) && (
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() =>
                    run(`simulation:${selected.id}`, () =>
                      simulateApprovedEcommercePayment({
                        orderId: selected.id,
                        idempotencyKey: selected.idempotencyKey,
                      }),
                    )
                  }
                >
                  {selected.saleId
                    ? "Reintentar preparación fiscal de prueba"
                    : "Confirmar pago SIMULADO"}
                </Button>
              )}
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Cerrar pedido
            </Button>
          </div>
        </Panel>
      )}
      <Panel title="Pedidos web">
        {!data ? (
          <p>Cargando pedidos…</p>
        ) : !data.orders.length ? (
          <p>No hay pedidos web.</p>
        ) : (
          <div className="fm-table-scroll">
            <table className="fm-data-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Origen</th>
                  <th>Pago</th>
                  <th>Total</th>
                  <th>Fecha</th>
                  <th>Gestión</th>
                </tr>
              </thead>
              <tbody>
                {[...data.orders]
                  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                  .map((order) => (
                    <tr key={order.id}>
                      <td>
                        {order.orderCode || order.id}
                        <br />
                        {order.status}
                      </td>
                      <td>{order.customer.fullName}</td>
                      <td>{order.stockOriginName || order.locationName}</td>
                      <td>
                        <Badge>{order.paymentStatus}</Badge>
                      </td>
                      <td>{formatMoney(order.total)}</td>
                      <td>{formatDateTime(order.createdAt)}</td>
                      <td>
                        <Button
                          variant="secondary"
                          onClick={() => openOrder(order)}
                        >
                          {order.shipmentId ? "Gestionar en envíos" : "Gestionar pago"}
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
