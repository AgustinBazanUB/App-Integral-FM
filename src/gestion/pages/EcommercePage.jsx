import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Panel,
  PageHeader,
  FormField,
  Select,
} from "../../design-system";
import { Link } from "../../router";
import {
  ecommerceAdminRequest,
  subscribeWebCommerce,
} from "../services/ecommerceAdminService";
import {
  simulateApprovedEcommercePayment,
  fetchEcommerceSimulationCapability,
} from "../../services/ecommerceService";
import { formatMoney, formatDateTime } from "../formatters";
import { summarizeSales } from "../../modules/locations/domain/saleFacts";
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
  const [data, setData] = useState(null),
    [channel, setChannel] = useState(empty),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [configure, setConfigure] = useState(false),
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
    ? [
        ...data.locations.map((row) => ({ ...row, type: "location" })),
        ...data.warehouses.map((row) => ({ ...row, type: "warehouse" })),
      ]
    : [];
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
  const real = summarizeSales(data?.sales || []),
    simulated = (data?.sales || []).filter(
      (row) => row.simulated || row.paymentStatus === "simulated_approved",
    );
  return (
    <div>
      <PageHeader
        title="Página web / E-commerce"
        description="Pedidos, orígenes físicos y configuración del canal comercial."
        actions={
          <Button onClick={edit} disabled={!data}>
            Configurar canal
          </Button>
        }
      />
      {error && (
        <p role="alert" className="fm-error">
          {error}
        </p>
      )}
      <Panel title="Métricas del canal">
        <p>
          Ventas reales: <strong>{real.count}</strong> · Facturación comercial:{" "}
          <strong>{formatMoney(real.total)}</strong> · Ticket promedio:{" "}
          <strong>{formatMoney(real.average)}</strong>
        </p>
        <p>
          {simulated.length} ventas simuladas excluidas de ingresos ·{" "}
          {
            (data?.orders || []).filter(
              (row) => row.status === "pending_payment",
            ).length
          }{" "}
          pendientes de pago ·{" "}
          {
            (data?.orders || []).filter((row) => row.status === "completed")
              .length
          }{" "}
          completados ·{" "}
          {
            (data?.orders || []).filter((row) =>
              ["cancelled", "expired"].includes(row.status),
            ).length
          }{" "}
          cancelados o vencidos
        </p>
        <Link to="/gestion/metrics/sales?channel=ecommerce">
          Ver métricas por período, productos y métodos de pago
        </Link>
      </Panel>
      {configure && (
        <Panel title="Configuración comercial">
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
            El canal utiliza el inventario de los orígenes seleccionados. No
            tiene stock propio.
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
                  {row.type === "warehouse" ? "Depósito" : "Ubicación"}
                </option>
              ))}
            </Select>
          </FormField>
          <fieldset>
            <legend>Orígenes autorizados</legend>
            {origins.map((row) => (
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
                {row.name}
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
        </Panel>
      )}
      {selected && (
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
            {selected.shipmentId && (
              <Link to={`/gestion/shipping?shipment=${selected.shipmentId}`}>
                Abrir preparación y entrega
              </Link>
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
                          onClick={() => select(order)}
                        >
                          Abrir pedido
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
