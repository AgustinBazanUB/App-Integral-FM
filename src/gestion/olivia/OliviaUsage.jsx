import { formatDateTime } from "../formatters";
export default function OliviaUsage({ quota, estimate, money, compact, exhausted }) {
  return <footer className="fm-olivia-usage">
    {!quota?.unlimited && quota ? <span className="fm-olivia-quota" title={quota.renewsAt ? `Renovación: ${formatDateTime(quota.renewsAt)}` : undefined}>Cupo disponible: <strong>{quota.remainingPercent}%</strong>{quota.remainingPercent <= 25 ? exhausted ? " · Agotado" : " · Cupo bajo" : ""}</span> : null}
    <div className="fm-olivia-costs"><div><small>Próxima consulta escrita · estimado</small><strong>{money(estimate?.estimatedCostArs)}</strong></div><div><small>Última llamada{quota?.lastCost?.estimated ? " · sin medición completa" : ""}</small><strong>{quota?.lastCost ? money(quota.lastCost.ars) : "Sin llamadas previas"}</strong></div></div>
  </footer>;
}
