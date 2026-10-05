export default function OliviaDeveloperPanel({ estimate, quota, latency, voiceMetrics, voiceCosts, telemetry, money }) {
  const ms = (value) => Number.isFinite(value) ? value.toFixed(0) : "—";
  const rows = [
    ["Modelo / razonamiento", `${telemetry?.model || estimate?.model || "—"} / ${telemetry?.reasoningEffort || estimate?.reasoningEffort || "—"}`],
    ["Ruta / motivo", `${telemetry?.route || estimate?.route || "—"} / ${telemetry?.routingReason || estimate?.routingReason || "—"}`],
    ["Tarea", telemetry?.taskId || "—"],
    ["Tokens próximos estimados", estimate?.estimatedTokens ?? "—"],
    ["Entrada / salida / total de última llamada", `${quota?.inputTokens ?? "—"} / ${quota?.outputTokens ?? "—"} / ${quota?.totalTokens ?? "—"}`],
    ["Consumo / reservas", `${quota?.usedTokens ?? 0} / ${quota?.reservedTokens ?? 0}`],
    ["Último costo USD", money(quota?.actualCostUsd, "USD")],
    ...(voiceCosts ? [
      ["Modelo de voz", voiceCosts.voiceModel || "—"],
      ["Transcripción · sesión", voiceCosts.transcription.included ? "Incluida en la voz" : money(voiceCosts.transcription.ars)],
      ["Voz y contexto · sesión", money(voiceCosts.voice.ars)],
      ["Luna / consultas del negocio · sesión", money(voiceCosts.backend.ars)],
      ["Consultas del negocio medidas", voiceCosts.backend.queries],
      ["Total de la conversación", money(voiceCosts.totalArs)],
      ["Total de la conversación USD", money(voiceCosts.totalUsd, "USD")],
      ["Medición de la conversación", voiceCosts.complete ? "Completa" : voiceCosts.truncated ? "Parcial: historial de consultas excedido" : "Pendiente: falta medición o conversión"],
    ] : []),
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
