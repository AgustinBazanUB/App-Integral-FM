export default function OliviaDeveloperPanel({ estimate, quota, latency, voiceMetrics, voiceConfiguration, telemetry, money }) {
  const ms = (value) => Number.isFinite(value) ? value.toFixed(0) : "—";
  const rows = [
    ...(voiceConfiguration ? [["Modelo de conversación", voiceConfiguration.model], ["Cerebro y acciones de voz", `${voiceConfiguration.backendModel} / ${voiceConfiguration.reasoningEffort}`], ["Voz fija de Olivia", voiceConfiguration.voice]] : []),
    ["Modelo / razonamiento", `${telemetry?.model || estimate?.model || "—"} / ${telemetry?.reasoningEffort || estimate?.reasoningEffort || "—"}`],
    ["Ruta / motivo", `${telemetry?.route || estimate?.route || "—"} / ${telemetry?.routingReason || estimate?.routingReason || "—"}`],
    ["Tarea", telemetry?.taskId || "—"],
    ["Tokens próximos estimados", estimate?.estimatedTokens ?? "—"],
    ["Entrada / salida / total de última llamada", `${quota?.inputTokens ?? "—"} / ${quota?.outputTokens ?? "—"} / ${quota?.totalTokens ?? "—"}`],
    ["Consumo / reservas", `${quota?.usedTokens ?? 0} / ${quota?.reservedTokens ?? 0}`],
    ["Último costo USD", money(quota?.actualCostUsd, "USD")],
    ["Click → mensaje visible (ms)", ms(latency?.visibleMs)],
    ["Mensaje → request (ms)", ms(latency?.requestMs)],
    ["Request → primer texto (ms)", ms(latency?.firstDeltaMs)],
    ["Primer texto → completa (ms)", latency?.firstDeltaMs != null ? ms(latency.totalMs - latency.firstDeltaMs) : "—"],
    ["Voz natural · Chirp 3 HD", voiceConfiguration?.voice || "No disponible"],
    ["Fin de habla → transcripción · mediana / P95 (ms)", `${ms(voiceMetrics?.turnToTranscript?.medianMs)} / ${ms(voiceMetrics?.turnToTranscript?.p95Ms)}`],
    ["Transcripción → primer audio programado · mediana / P95 (ms)", `${ms(voiceMetrics?.transcriptToVoice?.medianMs)} / ${ms(voiceMetrics?.transcriptToVoice?.p95Ms)}`],
    ["TTFA programado · mediana / P95 (ms)", `${ms(voiceMetrics?.ttfaScheduled?.medianMs)} / ${ms(voiceMetrics?.ttfaScheduled?.p95Ms)}`],
    ["Última síntesis · caracteres / costo USD estimado", `${voiceMetrics?.lastCharacters ?? "—"} / ${money(voiceMetrics?.lastEstimatedCostUsd, "USD")}`],
    ["Medición de audio", "Primer bloque programado por el navegador; no mide el inicio físico del altavoz"],
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
