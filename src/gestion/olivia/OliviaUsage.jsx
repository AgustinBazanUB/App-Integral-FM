import { formatDateTime } from "../formatters";
export default function OliviaUsage({ quota, estimate, money, compact, exhausted }) {
  return <footer className="fm-olivia-usage"><details open={!compact}><summary>Consumo y costos</summary><div>
    {quota?.unlimited ? <span>Administrador · <strong>Uso sin límite de tokens</strong></span> : quota ? <><span>Asistente IA disponible: <strong>{quota.remainingPercent}%</strong></span>{quota.renewsAt ? <small>Próxima renovación: {formatDateTime(quota.renewsAt)}</small> : null}{quota.remainingPercent <= 25 ? <small>{exhausted ? "Tu cupo está agotado. Podés solicitar una ampliación al Administrador." : "Tu cupo disponible es bajo."}</small> : null}</> : null}
    <div className="fm-olivia-costs"><div><small>Próxima consulta escrita · estimado</small><strong>{money(estimate?.estimatedCostArs)}</strong></div><div><small>Última llamada{quota?.lastCost?.estimated ? " · sin medición completa" : ""}</small><strong>{quota?.lastCost ? money(quota.lastCost.ars) : "Sin llamadas previas"}</strong></div></div>
    <small>Costo aproximado en ARS, con 5% sobre la conversión. El estimado escrito excluye archivos y almacenamiento semántico sin medición. La voz se contabiliza con medición de audio.</small>
  </div></details></footer>;
}
