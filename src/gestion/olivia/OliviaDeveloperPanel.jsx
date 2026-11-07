import { latencyTracesCsv, latencyTracesJson } from '../../shared/oliviaLatencyTrace.mjs';

export default function OliviaDeveloperPanel({ estimate, quota, latency, voiceMetrics, voiceConfiguration, geminiLiveUsage, telemetry, turnTrace, connectionTrace, turnTraces = [], money }) {
  const ms = (value) => Number.isFinite(value) ? value.toFixed(0) : "—";
  const percentiles=value=>`${ms(value?.medianMs)} / ${ms(value?.p90Ms)} / ${ms(value?.p95Ms)} · n=${value?.count ?? 0}`;
  const modalityTokens=value=>value && Object.keys(value).length ? Object.entries(value).map(([modality,count])=>`${modality} ${Number(count).toLocaleString('es-AR')}`).join(' · ') : 'No informado por el proveedor';
  const geminiMeasurement=value=>({ 'provider-forwarded':'Tarifa aplicada a usageMetadata', 'estimated-audio-context-excluded':'Estimado por duración, sin contexto', unconfirmed:'Sin confirmar' }[value] || value || 'Sin medición');
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
    ['Transcripción de esta sesión',voiceMetrics?.transcriptionMode || 'Sin iniciar'],
    ['Ruta de voz Gemini Live',voiceMetrics?.geminiLiveStatus || (voiceConfiguration?.model?.includes('Gemini') ? 'Preparado' : 'Modo anterior')],
    ['Gemini · último error/fallback',voiceMetrics?.geminiLiveFallback || 'Sin fallas registradas'],
    ['Gemini · conexión desde micrófono listo (ms)',ms(voiceMetrics?.geminiConnect?.medianMs)],
    ['Gemini · click → sesión lista (ms)',ms(voiceMetrics?.clickToGeminiReady?.medianMs)],
    ['Gemini · ruta del último turno',`${voiceMetrics?.geminiLastRoute || 'Sin clasificar'} · turno ${voiceMetrics?.geminiLastTurnIndex ?? '—'}`],
    ['Gemini · clasificación backend · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.geminiClassification)],
    ['Gemini · política local determinística · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.geminiLocalClassification)],
    ['Gemini · fin de voz → primer audio programado · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.geminiVoiceEndToUsefulAudio)],
    ['Gemini · primer turno de sesión · TTFA P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.geminiFirstTurnVoiceEndToUsefulAudio)],
    ['Gemini · turnos posteriores · TTFA P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.geminiLaterTurnVoiceEndToUsefulAudio)],
    ['Gemini · último consumo',`${geminiMeasurement(voiceMetrics?.geminiLiveLastUsage?.measurement)} · ${voiceMetrics?.geminiLiveLastUsage?.inputTokens ?? '—'} entrada / ${voiceMetrics?.geminiLiveLastUsage?.outputTokens ?? '—'} salida`],
    ['Gemini · tokens de entrada/salida por modalidad',`${modalityTokens(voiceMetrics?.geminiLiveLastUsage?.inputTokensByModality)} / ${modalityTokens(voiceMetrics?.geminiLiveLastUsage?.outputTokensByModality)} · entrada incluye contexto según usageMetadata`],
    ['Gemini · costo calculado desde usageMetadata · último turno',money(voiceMetrics?.geminiLiveLastUsage?.costUsd,'USD')],
    ['Gemini · costo calculado acumulado de esta sesión',money(voiceMetrics?.geminiLiveLastUsage?.sessionSpendUsd,'USD')],
    ['Gemini · gasto calculado + reserva preventiva',`${money(geminiLiveUsage?.spendUsd,'USD')} + ${money(geminiLiveUsage?.reservedUsd,'USD')}`],
    ['Gemini · costo por tokens de usageMetadata / estimado solo por audio / sin confirmar',`${money(geminiLiveUsage?.usageMetadataEstimatedUsd,'USD')} / ${money(geminiLiveUsage?.estimatedUsd,'USD')} / ${geminiLiveUsage?.unconfirmedQueryCount ?? '—'} turnos`],
    ['Gemini · turnos / tope 660 / promedio / proyección',`${geminiLiveUsage?.queryCount ?? '—'} / ${geminiLiveUsage?.maxQueries ?? 660} / ${money(geminiLiveUsage?.averageUsdPerQuery,'USD')} / ${money(geminiLiveUsage?.projectionAt660Usd,'USD')}`],
    ['Gemini · presupuesto objetivo / aviso / techo',`${money(geminiLiveUsage?.targetUsd ?? 5,'USD')} / ${money(geminiLiveUsage?.warningUsd ?? 6,'USD')} / ${money(geminiLiveUsage?.hardLimitUsd ?? 10,'USD')}`],
    ['Gemini · estado preventivo',geminiLiveUsage?.hardLimitReached ? 'Techo mensual alcanzado' : geminiLiveUsage?.queryLimitReached ? 'Tope de turnos alcanzado' : geminiLiveUsage?.warningReached ? 'Aviso mensual alcanzado' : 'Dentro de los límites registrados'],
    ['Luna/Sol · costo estimado por tarifas / llamadas sin confirmar',`${money(geminiLiveUsage?.lunaSol?.estimatedUsd,'USD')} / ${geminiLiveUsage?.lunaSol?.unconfirmedCalls ?? '—'}`],
    ['Luna/Sol · llamadas y tokens de entrada/salida del mes',`${geminiLiveUsage?.lunaSol?.calls ?? '—'} · ${geminiLiveUsage?.lunaSol?.inputTokens ?? '—'} / ${geminiLiveUsage?.lunaSol?.outputTokens ?? '—'}`],
    ['Chirp · costo mensual estimado / caracteres / solicitudes',`${money(geminiLiveUsage?.chirp?.estimatedUsd,'USD')} / ${geminiLiveUsage?.chirp?.characters ?? '—'} / ${geminiLiveUsage?.chirp?.requests ?? '—'}`],
    ['Proveedores · total mensual estimado / costos sin confirmar',`${money(geminiLiveUsage?.combinedEstimatedSpendUsd,'USD')} / ${geminiLiveUsage?.combinedUnconfirmedCount ?? '—'}`],
    ["Silencio de fin de turno · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.silence)],
    ["Detección → transcripción final · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.turnToTranscript)],
    ["Fin real de voz → transcripción · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.voiceEndToTranscript)],
    ['Fin de voz → primer audio útil · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.voiceEndToUsefulAudio)],
    ['Fin de voz → audio final completo · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.voiceEndToComplete)],
    ['Charla breve · primer audio útil P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.['instant.voiceEndToUsefulAudio'])],
    ['Lectura · primer audio útil P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.['read.voiceEndToUsefulAudio'])],
    ['Acción/consulta compleja · primer audio útil P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.['controlled.voiceEndToUsefulAudio'])],
    ['HTTP hasta cabeceras · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.httpHeaders)],
    ['Servidor antes de cabeceras · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.httpServer)],
    ['Transporte/cola estimados · P50 / P90 / P95 (ms)',percentiles(voiceMetrics?.httpTransportEstimate)],
    ["Selección de intervención · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.selection)],
    ["Selector iniciado → clip disponible · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.fastAudioAvailable)],
    ["Turno confirmado → primera intervención · P50 / P90 / P95 (ms)",percentiles(voiceMetrics?.turnToFirstIntervention)],
    ["Selector · costo USD estimado mediano",money(voiceMetrics?.selectionCostUsd?.medianMs,'USD')],
    ["Transcripción → primer audio programado · mediana / P95 (ms)", `${ms(voiceMetrics?.transcriptToVoice?.medianMs)} / ${ms(voiceMetrics?.transcriptToVoice?.p95Ms)}`],
    ["TTFA programado · mediana / P95 (ms)", `${ms(voiceMetrics?.ttfaScheduled?.medianMs)} / ${ms(voiceMetrics?.ttfaScheduled?.p95Ms)}`],
    ["Última síntesis · caracteres / costo USD estimado", `${voiceMetrics?.lastCharacters ?? "—"} / ${money(voiceMetrics?.lastEstimatedCostUsd, "USD")}`],
    ["Medición de audio", "Gemini: tokens de usageMetadata tarifados o estimación por duración que excluye contexto; ningún importe reconcilia la factura. Chirp: primer bloque programado; no mide el inicio físico del altavoz."],
    ["Backend: retrieval / proveedor / herramientas (ms)", `${ms(telemetry?.retrievalMs)} / ${ms(telemetry?.providerMs)} / ${ms(telemetry?.toolsMs)}`],
    ["Llamadas de modelo / herramientas", `${telemetry?.modelCalls ?? "—"} / ${telemetry?.toolCalls ?? "—"}`],
    ["Skills", telemetry?.skills?.map((skill) => `${skill.name}@${skill.version}`).join(", ") || "Ninguna en esta consulta"],
    ["Documentos recuperados", telemetry?.documents?.map((doc) => doc.title).join(", ") || "Ninguno en esta consulta"],
    ["Request / response", `${telemetry?.requestId || "—"} / ${telemetry?.responseId || "—"}`],
    ["Contexto", "16 mensajes recientes, memoria acotada y referencias verificadas"],
    ["Costo de almacenamiento semántico", "Sin medición del proveedor"],
    ["Cotización", estimate?.reference ? `${money(estimate.reference.rate)} por USD · ${estimate.reference.date || "Manual"}` : "Sin cotización"],
  ];
  const traces=[connectionTrace,...turnTraces].filter(Boolean);
  const exportFile=(extension,content,type)=>{
    const url=URL.createObjectURL(new Blob([content],{type})),anchor=document.createElement('a');
    anchor.href=url;anchor.download=`olivia-voz-trazas-${new Date().toISOString().slice(0,10)}.${extension}`;anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const eventDetail=event=>[
    event.route?`ruta ${event.route}`:null,event.kind?`tipo ${event.kind}`:null,event.source?`origen ${event.source}`:null,
    event.provider?`proveedor ${event.provider}`:null,event.model?`modelo ${event.model}`:null,
    Number.isFinite(event.durationMs)?`${ms(event.durationMs)} ms`:null,event.status?`estado ${event.status}`:null,
    Number.isFinite(event.costUsd)?`USD ${event.costUsd}`:null,
  ].filter(Boolean).join(' · ');
  const renderTrace=trace=><details key={`${trace.origin}-${trace.id}`}><summary>{trace.origin==='client'?'Navegador':'Servidor'} · {trace.id}</summary><p>Turno: {trace.id} · Solicitud: {trace.requestId || trace.id} · reloj {trace.clock}</p><ol>{trace.events.map((event,index)=><li key={`${event.stage}-${index}`}>{event.stage}: {ms(event.ms)} ms{eventDetail(event)?` · ${eventDetail(event)}`:''}</li>)}</ol></details>;
  return <section className="fm-olivia-developer" aria-label="Métricas de desarrollo"><h3>Métricas de desarrollo</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><div className="fm-olivia-trace-export"><button type="button" onClick={()=>exportFile('json',latencyTracesJson(traces),'application/json')}>Exportar trazas JSON sanitizadas</button><button type="button" onClick={()=>exportFile('csv',latencyTracesCsv(traces),'text/csv;charset=utf-8')}>Exportar trazas CSV sanitizadas</button><small>Hasta 100 turnos en memoria por sesión; no se exportan transcripciones ni argumentos.</small></div>{connectionTrace?renderTrace(connectionTrace):null}{turnTraces.map(renderTrace)}{turnTrace && !turnTraces.some(trace=>trace.id===turnTrace.id)?renderTrace(turnTrace):null}{telemetry?.trace?renderTrace(telemetry.trace):null}{telemetry?.retrievalWarning ? <p>{telemetry.retrievalWarning}</p> : null}{estimate?.reference?.source?.startsWith("https://") ? <a href={estimate.reference.source} target="_blank" rel="noreferrer">Fuente de cotización</a> : null}</section>;
}
