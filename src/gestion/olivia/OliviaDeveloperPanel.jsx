export default function OliviaDeveloperPanel({ estimate, quota, latency, voiceMetrics, telemetry, money }) {
  const ms = (value) => Number.isFinite(value) ? value.toFixed(0) : "—";
  const rows = [
    ["Modelo / razonamiento", `${estimate?.model || "—"} / ${estimate?.reasoningEffort || "—"}`],
    ["Tokens próximos estimados", estimate?.estimatedTokens ?? "—"],
    ["Entrada / salida / total de última llamada", `${quota?.inputTokens ?? "—"} / ${quota?.outputTokens ?? "—"} / ${quota?.totalTokens ?? "—"}`],
    ["Consumo / reservas", `${quota?.usedTokens ?? 0} / ${quota?.reservedTokens ?? 0}`],
    ["Último costo USD", quota?.actualCostUsd != null ? Number(quota.actualCostUsd).toFixed(6) : "Sin medición"],
    ["Click → mensaje visible (ms)", ms(latency?.visibleMs)],
    ["Mensaje → request (ms)", ms(latency?.requestMs)],
    ["Request → primer texto (ms)", ms(latency?.firstDeltaMs)],
    ["Primer texto → completa (ms)", latency?.firstDeltaMs != null ? ms(latency.totalMs - latency.firstDeltaMs) : "—"],
    ["Voz → transcripción, desde fin de habla (ms)", ms(voiceMetrics?.voiceToTranscriptionMs)],
    ["Transcripción → herramienta (ms)", ms(voiceMetrics?.transcriptionToToolMs)],
    ["Herramienta → respuesta (ms)", ms(voiceMetrics?.toolToResponseMs)],
    ["Respuesta → audio (ms)", ms(voiceMetrics?.responseToAudioMs)],
    ["Backend: retrieval / proveedor / herramientas (ms)", `${ms(telemetry?.retrievalMs)} / ${ms(telemetry?.providerMs)} / ${ms(telemetry?.toolsMs)}`],
    ["Llamadas de modelo / herramientas", `${telemetry?.modelCalls ?? "—"} / ${telemetry?.toolCalls ?? "—"}`],
    ["Skills", telemetry?.skills?.map((skill) => `${skill.name}@${skill.version}`).join(", ") || "Ninguna en esta consulta"],
    ["Documentos recuperados", telemetry?.documents?.map((doc) => doc.title).join(", ") || "Ninguno en esta consulta"],
    ["Request / response", `${telemetry?.requestId || "—"} / ${telemetry?.responseId || "—"}`],
    ["Contexto", "16 mensajes recientes, memoria acotada y referencias verificadas"],
    ["Costo de almacenamiento semántico", "Sin medición del proveedor"],
    ["Cotización", estimate?.reference ? `${money(estimate.reference.rate)} por USD · ${estimate.reference.date || "Manual"}` : "Sin cotización"],
  ];
  return <section className="fm-olivia-developer" aria-label="Métricas de desarrollo"><h3>Métricas de desarrollo</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{telemetry?.retrievalWarning ? <p>{telemetry.retrievalWarning}</p> : null}{estimate?.reference?.source?.startsWith("https://") ? <a href={estimate.reference.source} target="_blank" rel="noreferrer">Fuente de cotización</a> : null}</section>;
}
