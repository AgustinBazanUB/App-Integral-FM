import { formatDateTime } from "../formatters";
export default function OliviaUsage({ quota, estimate, money, voiceCosts, compact, exhausted }) {
  return <footer className="fm-olivia-usage">
    {!quota?.unlimited && quota ? <span className="fm-olivia-quota" title={quota.renewsAt ? `Renovación: ${formatDateTime(quota.renewsAt)}` : undefined}>Cupo disponible: <strong>{quota.remainingPercent}%</strong>{quota.remainingPercent <= 25 ? exhausted ? " · Agotado" : " · Cupo bajo" : ""}</span> : null}
    <div className="fm-olivia-costs"><div><small>Próxima consulta escrita · estimado</small><strong>{money(estimate?.estimatedCostArs)}</strong></div><div>{voiceCosts ? <><small>Conversación de voz · total{voiceCosts.complete ? "" : " pendiente"}</small><strong>{voiceCosts.complete ? money(voiceCosts.totalArs) : "Pendiente de medición"}</strong>{!voiceCosts.complete && voiceCosts.knownArs > 0 ? <small>Subtotal medido: {money(voiceCosts.knownArs)}</small> : null}</> : <><small>Última llamada{quota?.lastCost?.estimated ? " · sin medición completa" : ""}</small><strong>{quota?.lastCost ? money(quota.lastCost.ars) : "Sin llamadas previas"}</strong></>}</div></div>
  </footer>;
}
