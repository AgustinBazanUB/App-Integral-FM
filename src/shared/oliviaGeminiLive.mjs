export const GEMINI_LIVE_MODEL = "gemini-3.8-live";
export const GEMINI_LIVE_MONTHLY_QUERY_CAP = 660;
export const GEMINI_LIVE_INPUT_AUDIO_USD_PER_MINUTE = 0.005;
export const GEMINI_LIVE_OUTPUT_AUDIO_USD_PER_MINUTE = 0.018;

export function geminiLiveSetupConfig() {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    maxOutputTokens: 512,
    temperature: 0.5,
    systemInstruction: { parts: [{ text: [
      "Sos Olivia, la asistente de Flor Mía. Hablá en español argentino natural, breve, claro y cálido.",
      "Respondé en una o dos frases, con un máximo orientativo de 35 palabras. Terminá siempre la frase; omití ofrecimientos y comentarios de cierre innecesarios.",
      "Respondé directamente solo a saludos, agradecimientos y charla simple que no requiera datos del negocio.",
      "Para cualquier dato comercial, pregunta sobre precios, stock, ventas, clientes o envíos, o tarea compleja o administrativa, usá delegate_to_olivia.",
      "Al delegar, podés decir antes una única frase neutral y breve para indicar que vas a revisar la solicitud, como 'Dale, lo reviso'. No confirmes que recibiste listas incompletas, no afirmes datos ni resultados sin verificar y no asegures que una operación se ejecutó.",
      "Nunca inventes datos ni afirmes que una operación se ejecutó. El backend verifica permisos y prepara confirmaciones; una operación solo queda autorizada cuando el usuario confirma en pantalla.",
      "Cuando recibas un resultado de Olivia, comunicá fielmente los hechos y aclará si una acción quedó pendiente de confirmación.",
    ].join(" ") }] },
    tools: [{ functionDeclarations: [{
      name: "delegate_to_olivia",
      description: "Deriva al motor de Olivia toda consulta sobre información comercial real y toda tarea que requiera razonamiento, permisos o preparación administrativa.",
      parameters: { type: "OBJECT", properties: { request: { type: "STRING", description: "La solicitud literal y completa del usuario en español." } }, required: ["request"] },
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
