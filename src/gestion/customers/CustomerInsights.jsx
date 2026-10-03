import { useState } from "react";
import { Badge, Button, DataTable, FormField, Panel, Skeleton, Toast } from "../../design-system";
import { useAsyncData } from "../hooks";
import { formatDateTime, formatMoney } from "../formatters";
import { customerAnalysis, customerHistoryPage, customerLastPurchase, getLoyaltyPolicy, saveLoyaltyPolicy } from "./crmService";
import { matchesCustomerSegment } from "./customerPurchases";
import { isActiveSale, saleDate } from "../../modules/locations/domain/saleFacts";

export function CustomerSegments({ profile, customers, zones, renderCustomers }) {
  const [days, setDays] = useState(90);
  const [filters, setFilters] = useState({ loyalty: "", zone: "", categoryId: "", productId: "", minPurchases: "", maxFrequencyDays: "", lastSince: "" });
  const analysis = useAsyncData(async () => {
    const policy = await getLoyaltyPolicy(profile);
    return { ...(await customerAnalysis(profile, customers, policy, days)), policy };
  }, [profile.id, customers.map(customer => customer.id).join("|"), days]);
  const data = analysis.data;
  const field = (key, label, options) => <FormField label={label}><select value={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))}><option value="">Todos</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></FormField>;
  return <>
    <details className="fm-crm-segments"><summary>Segmentar por compras, zona o productos</summary><div className="fm-crm-filters">
      {!data?.policy.enabled ? <FormField label="Ventana de análisis (días)"><input type="number" min="1" max="3660" value={days} onChange={event => setDays(Number(event.target.value))} /></FormField> : null}
      {field("loyalty", "Fidelización", [{ id: "loyal", name: "Fidelizados" }, { id: "not_loyal", name: "No fidelizados" }])}
      {field("zone", "Zona", zones.map(zone => ({ id: zone.name, name: zone.name })))}
      {field("categoryId", "Categoría comprada", [...new Map((data?.products || []).filter(product => product.categoryId).map(product => [product.categoryId, { id: product.categoryId, name: product.categoryName || product.categoryId }])).values()])}
      {field("productId", "Producto comprado", data?.products || [])}
      {[["minPurchases", "Compras mínimas"], ["maxFrequencyDays", "Frecuencia máxima (días)"]].map(([key, label]) => <FormField key={key} label={label}><input type="number" min="1" value={filters[key]} onChange={event => setFilters(current => ({ ...current, [key]: event.target.value }))} /></FormField>)}
      <FormField label="Última compra desde"><input type="date" value={filters.lastSince} onChange={event => setFilters(current => ({ ...current, lastSince: event.target.value }))} /></FormField>
    </div></details>
    {analysis.status === "loading" ? <Skeleton lines={3} /> : null}
    {analysis.status === "error" ? <Toast tone="error">No se pudo analizar el historial: {analysis.error.message}<Button variant="secondary" onClick={() => analysis.refresh().catch(() => {})}>Reintentar</Button></Toast> : null}
    {data ? <p role="status">Compras válidas de los últimos {data.days} días. {data.policy.enabled ? `Fidelización: ${data.policy.minPurchases} compras${data.policy.minCategories ? ` y ${data.policy.minCategories} categorías` : ""}.` : "Regla de fidelización sin configurar; las cifras describen este período, no todo el historial."}</p> : null}
    {renderCustomers(customers.filter(customer => matchesCustomerSegment(customer, data?.stats.get(customer.id), filters)), data?.stats)}
  </>;
}

export function LoyaltyConfiguration({ profile }) {
  const result = useAsyncData(() => getLoyaltyPolicy(profile), [profile.id]);
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const draft = form || result.data || { enabled: false, minPurchases: "", windowDays: "", minCategories: "" };
  const save = async () => { setBusy(true); setMessage(""); try { const policy = await saveLoyaltyPolicy(profile, draft); setForm(policy); setMessage("Regla guardada y auditada."); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  return <Panel title="Regla de fidelización" description="Administración define la cantidad de compras y su ventana. No se asignan umbrales comerciales automáticamente.">
    {result.status === "error" ? <Toast tone="error">{result.error.message}</Toast> : null}
    <FormField label="Estado"><select value={draft.enabled ? "enabled" : "disabled"} onChange={event => setForm({ ...draft, enabled: event.target.value === "enabled" })}><option value="disabled">Sin clasificación automática</option><option value="enabled">Clasificación configurada</option></select></FormField>
    {[["minPurchases", "Cantidad mínima de compras"], ["windowDays", "Ventana en días"], ["minCategories", "Categorías mínimas (opcional)"], ["maxFrequencyDays", "Frecuencia máxima entre compras (días, opcional)"]].map(([key, label]) => <FormField key={key} label={label}><input type="number" min="1" disabled={!draft.enabled} value={draft[key] ?? ""} onChange={event => setForm({ ...draft, [key]: event.target.value })} /></FormField>)}
    <Button loading={busy} disabled={result.status !== "ready"} onClick={save}>Guardar regla</Button>{message ? <p role="status">{message}</p> : null}
  </Panel>;
}

export function CustomerHistory({ profile, customer }) {
  const result = useAsyncData(async () => { const [page, last] = await Promise.all([customerHistoryPage(profile, customer), customerLastPurchase(profile, customer)]); return { ...page, last }; }, [profile.id, customer.id]);
  const [extra, setExtra] = useState([]), [next, setNext] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const page = next || result.data;
  const more = async () => { setBusy(true); setError(""); try { const nextPage = await customerHistoryPage(profile, customer, page.cursor); setExtra(current => [...current, ...nextPage.items]); setNext(nextPage); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
  const rows = [...new Map([...(result.data?.items || []), ...extra].map(sale => [sale.id, sale])).values()];
  return <Panel title="Historial de compras" description="Las anuladas conservan su referencia; no cuentan como compras válidas.">
    {result.status === "loading" ? <Skeleton lines={4} /> : null}
    {result.status === "error" ? <Toast tone="error">{result.error.message}</Toast> : null}
    {result.status === "ready" ? <><p>Última compra válida: {result.data.last ? formatDateTime(result.data.last) : "Sin compras válidas"}</p><DataTable columns={[
      { key: "date", label: "Fecha", render: sale => formatDateTime(saleDate(sale)) },
      { key: "items", label: "Productos", render: sale => (sale.items || []).map(item => `${item.qty ?? item.quantity ?? 0} × ${item.productName || item.name || item.productId}`).join(" · ") },
      { key: "total", label: "Importe", render: sale => formatMoney(sale.total) },
      { key: "status", label: "Estado", render: sale => <Badge tone={isActiveSale(sale) ? "success" : "neutral"}>{isActiveSale(sale) ? "Válida" : "Anulada / eliminada"}</Badge> },
    ]} rows={rows} empty={<p>Sin compras registradas.</p>} />{page?.hasMore ? <Button variant="secondary" loading={busy} onClick={more}>Más compras</Button> : null}</> : null}
    {error ? <Toast tone="error">{error}</Toast> : null}
  </Panel>;
}
