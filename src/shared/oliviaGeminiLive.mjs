export const GEMINI_LIVE_MODEL = "gemini-3.8-live";
export const GEMINI_LIVE_MONTHLY_QUERY_CAP = 660;
export const GEMINI_LIVE_INPUT_AUDIO_USD_PER_MINUTE = 0.005;
export const GEMINI_LIVE_OUTPUT_AUDIO_USD_PER_MINUTE = 0.018;

export function geminiLiveSetupConfig() {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    // Keep a bounded ceiling, but allow a spoken readback of 20 items. The
    // 512-token sessions cut the measured 10/20-item readbacks mid-list.
    maxOutputTokens: 1024,
    temperature: 0.5,
    systemInstruction: { parts: [{ text: [
      "Sos Olivia, la asistente de Flor Mía. Hablá en español argentino natural, breve, claro y cálido.",
      "Respondé en una o dos frases, con un máximo orientativo de 35 palabras. Al repetir una lista dictada, conservá cada artículo y su cantidad aunque requiera más palabras: no reemplaces las cantidades por el número de elementos. Terminá siempre la frase; omití ofrecimientos y comentarios de cierre innecesarios.",
      "Sostené la conversación natural y su contexto. Respondé directamente a saludos, agradecimientos combinados, preguntas sobre si escuchás, pedidos de ayuda y continuidad de la charla. No uses herramientas para esa conversación ni para preguntas generales sin datos del negocio.",
      "Para cualquier dato comercial, pregunta sobre precios, stock, ventas, clientes o envíos, o tarea compleja o administrativa, usá delegate_to_olivia.",
      "Al delegar, decí antes exactamente 'Dale, lo reviso.' como único acuse. El reproductor autoriza esa frase neutral; las variantes quedan silenciadas por seguridad. No confirmes que recibiste listas incompletas, no afirmes datos ni resultados sin verificar y no asegures que una operación se ejecutó.",
      "Las notas expresamente limitadas a esta conversación y las pausas para corregir el dictado no son operaciones administrativas. Respondelas directamente. Mientras una tarea trabaja, seguí respondiendo preguntas sociales y pedidos de avisar cuando termine sin volver a delegar. No vuelvas a llamar herramientas al recibir un evento interno de resultado: solo comunicá sus hechos verificados.",
      "Nunca inventes datos ni afirmes que una operación se ejecutó. El backend verifica permisos y prepara confirmaciones; una operación solo queda autorizada cuando el usuario confirma en pantalla.",
      "Cuando recibas un resultado de Olivia, comunicá fielmente los hechos y aclará si una acción quedó pendiente de confirmación.",
      "Las herramientas son asíncronas: continuá conversando mientras trabajan. Una aceptación o un acuse no es una finalización. Solo anunciá resultados que la herramienta haya devuelto verificados. Si pide datos, conservá su taskId para continuarlos. Para una solicitud independiente usá action=new; si hay varias tareas y no sabés a cuál se refiere, preguntá. Un sí hablado nunca reemplaza la confirmación visual. Para consultar tareas usá action=status y para cancelarlas action=cancel con el taskId correcto.",
    ].join(" ") }] },
    tools: [{ functionDeclarations: [{
      name: "delegate_to_olivia",
      behavior: "NON_BLOCKING",
      description: "Deriva al motor de Olivia toda consulta sobre información comercial real y toda tarea que requiera razonamiento, permisos o preparación administrativa.",
      parameters: { type: "OBJECT", properties: { request: { type: "STRING", description: "La solicitud literal y completa del usuario en español." }, action:{type:'STRING',enum:['new','continue','status','cancel'],description:'Nueva tarea independiente, continuación de datos, consulta de estados o cancelación explícita.'},taskId:{type:'STRING',description:'Identificador devuelto por el backend; obligatorio si se continúa o cancela una tarea entre varias.'},dependsOn:{type:'ARRAY',items:{type:'STRING'},description:'Solo IDs de tareas previas que deban finalizar antes.'},priority:{type:'STRING',enum:['low','normal','high']} }, required: ["request","action"] },
    }] }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        // NaturalVoiceConversation closes short turns locally at 500–950 ms
        // and keeps lists open up to 2 s. Align Gemini's own VAD ceiling with
        // the longest local window so its earlier default cannot split lists.
        silenceDurationMs: 2000,
      },
      activityHandling: "START_OF_ACTIVITY_INTERRUPTS",
    },
    sessionResumption: {},
    contextWindowCompression: { triggerTokens: 3000, slidingWindow: { targetTokens: 1200 } },
  };
}

export function geminiLiveRawSetup(model = GEMINI_LIVE_MODEL, handle = null) {
  const config = geminiLiveSetupConfig();
  return {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: config.responseModalities,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      speechConfig: config.speechConfig,
    },
    systemInstruction: config.systemInstruction,
    tools: config.tools,
    inputAudioTranscription: config.inputAudioTranscription,
    outputAudioTranscription: config.outputAudioTranscription,
    realtimeInputConfig: config.realtimeInputConfig,
    sessionResumption: handle ? { handle } : {},
    contextWindowCompression: config.contextWindowCompression,
  };
}

const INPUT_USD_PER_MILLION = { AUDIO: 3, TEXT: 0.75, VIDEO: 1 };
const OUTPUT_USD_PER_MILLION = { AUDIO: 12, TEXT: 4.5, VIDEO: 1 };

function modalityTokens(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const result = {};
  for (const row of value) {
    const modality = String(row?.modality || "").toUpperCase();
    const tokenCount = Number(row?.tokenCount);
    if (!Object.hasOwn(INPUT_USD_PER_MILLION, modality) || !Number.isSafeInteger(tokenCount) || tokenCount < 0) return null;
    result[modality] = (result[modality] || 0) + tokenCount;
  }
  return result;
}

function costForTokens(rows, rates) {
  return Object.entries(rows).reduce((total, [modality, tokens]) => total + tokens * rates[modality] / 1_000_000, 0);
}

export function geminiLiveProviderCost(usageMetadata) {
  const promptTokens = modalityTokens(usageMetadata?.promptTokensDetails);
  const toolPromptTokens = modalityTokens(usageMetadata?.toolUsePromptTokensDetails);
  const inputTokens = promptTokens && toolPromptTokens
    ? { ...promptTokens, ...Object.fromEntries(Object.entries(toolPromptTokens).map(([modality, count]) => [modality, (promptTokens[modality] || 0) + count])) }
    : promptTokens || toolPromptTokens;
  const outputTokens = modalityTokens(usageMetadata?.responseTokensDetails);
  if (!inputTokens || !outputTokens) return { measurement: "unconfirmed", inputTokens: null, outputTokens: null, costUsd: null };
  const inputCostUsd = costForTokens(inputTokens, INPUT_USD_PER_MILLION);
  const outputCostUsd = costForTokens(outputTokens, OUTPUT_USD_PER_MILLION);
  return {
    measurement: "provider-forwarded",
    inputTokens: Object.values(inputTokens).reduce((total, count) => total + count, 0),
    outputTokens: Object.values(outputTokens).reduce((total, count) => total + count, 0),
    inputTokensByModality: inputTokens,
    outputTokensByModality: outputTokens,
    inputCostUsd,
    outputCostUsd,
    costUsd: inputCostUsd + outputCostUsd,
  };
}

export function estimateGeminiLiveAudioCost({ inputAudioSeconds = 0, outputAudioSeconds = 0 } = {}) {
  const input = Number(inputAudioSeconds), output = Number(outputAudioSeconds);
  if (![input, output].every((value) => Number.isFinite(value) && value >= 0)) return null;
  return {
    measurement: "estimated-audio-only",
    inputAudioSeconds: input,
    outputAudioSeconds: output,
    estimatedCostUsd: input * GEMINI_LIVE_INPUT_AUDIO_USD_PER_MINUTE / 60 + output * GEMINI_LIVE_OUTPUT_AUDIO_USD_PER_MINUTE / 60,
    excludesAccumulatedContext: true,
  };
}

export function geminiLiveMonthlyProjection({ spendUsd = 0, queryCount = 0, daysElapsed = 0, daysInMonth = 0 } = {}) {
  const averageUsdPerQuery = queryCount > 0 ? spendUsd / queryCount : null;
  return {
    spendUsd,
    queryCount,
    averageUsdPerQuery,
    projectionAt660Usd: averageUsdPerQuery == null ? null : averageUsdPerQuery * 660,
    projectedMonthEndUsd: daysElapsed > 0 && daysInMonth >= daysElapsed ? spendUsd / daysElapsed * daysInMonth : null,
  };
}
