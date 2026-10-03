import { useState } from "react";
import { Button, DataTable, FormField, Panel, Skeleton, Toast } from "../../design-system";
import { operatingAverage } from "../../modules/locations/domain/operatingMetrics";
import { argentinaParts } from "../../modules/locations/domain/time";
import { useAsyncData } from "../hooks";
import { normalizedRole } from "../permissions";
import { formatMoney } from "../formatters";
import { getOperatingHolidays, saveOperatingHolidays } from "../services/operatingCalendarService";
export default function OperatingMetricsPanel({ profile, sales, range, locations }) {
  const holidays = useAsyncData(getOperatingHolidays, [profile.id]);
  const year = String(argentinaParts(range.start).year);
  const [editing, setEditing] = useState(false), [dates, setDates] = useState(""), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const rows = locations.map(location => ({ id: location.id, name: location.name, ...operatingAverage(sales, range, location, holidays.data || {}) }));
  const save = async () => { setBusy(true); setMessage(""); try { await saveOperatingHolidays(profile, year, dates.split(/[\s,;]+/).filter(Boolean)); await holidays.refresh(); setEditing(false); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  return <Panel title="Promedio operativo" description="Cada ubicación utiliza su propio calendario. La fórmula conjunta para múltiples horarios está pendiente de definir.">
    {holidays.status === "error" ? <Toast tone="error">{holidays.error.message}</Toast> : null}
    {holidays.status === "loading" ? <Skeleton lines={3} /> : null}
    {holidays.status === "ready" ? <DataTable rows={rows} columns={[{ key: "name", label: "Ubicación" }, { key: "denominator", label: "Bloques / días / meses" }, { key: "average", label: "Promedio", render: row => row.average == null ? "Sin datos suficientes" : `${formatMoney(row.average)} / ${row.unit}` }, { key: "note", label: "Criterio" }]} /> : null}
    {["admin", "general_admin"].includes(normalizedRole(profile)) ? <Button variant="secondary" onClick={() => { setDates((holidays.data?.[year] || []).join("\n")); setEditing(true); }}>Configurar feriados {year}</Button> : null}
    {editing ? <div><FormField label={`Feriados ${year}`} hint="Una fecha AAAA-MM-DD por línea. Guardar vacío declara expresamente un calendario sin feriados; no se consulta un proveedor externo."><textarea value={dates} onChange={event => setDates(event.target.value)} rows={5} /></FormField><Button loading={busy} onClick={save}>Guardar calendario</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button></div> : null}
    {message ? <Toast tone="error">{message}</Toast> : null}
  </Panel>;
}
