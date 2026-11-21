import { formatDateTime } from "../formatters";
import { monthlyProviderSummary } from './interactionCosts.mjs';
export default function OliviaUsage({ quota, estimate, money, compact, exhausted, geminiUsage, interactionCost, voiceActive = false }) {
  const monthly=monthlyProviderSummary(geminiUsage);
  const last=interactionCost?.usd==null?'Sin medición conjunta':`${money(interactionCost.usd,'USD')}${interactionCost.pending?' + pendiente':interactionCost.estimated?' · estimado':''}`;
  return <footer className="fm-olivia-usage">
    {!quota?.unlimited && quota ? <span className="fm-olivia-quota" title={quota.renewsAt ? `Renovación: ${formatDateTime(quota.renewsAt)}` : undefined}>Cupo disponible: <strong>{quota.remainingPercent}%</strong>{quota.remainingPercent <= 25 ? exhausted ? " · Agotado" : " · Cupo bajo" : ""}</span> : null}
    <div className="fm-olivia-costs"><div><small>Próxima · {voiceActive?'voz de duración abierta':'texto estimado'}</small><span>{!voiceActive&&Number.isFinite(estimate?.estimatedCostArs)?money(estimate.estimatedCostArs):'Estimación no disponible'}</span></div><div><small>Última interacción · Gemini + Luna/Sol</small><span>{last}</span></div><div><small>Total registrado · {monthly.period || 'mes'}</small><span>{monthly.usd==null?'Sin medición conjunta':`${money(monthly.usd,'USD')} · estimado`}{monthly.pending?` · ${monthly.pending} sin confirmar`:''}</span></div></div>
  </footer>;
}
