export const GEMINI_LIVE_MODEL = "gemini-3.8-live";
export const GEMINI_LIVE_MONTHLY_QUERY_CAP = 660;
export const GEMINI_LIVE_INPUT_AUDIO_USD_PER_MINUTE = 0.005;
export const GEMINI_LIVE_OUTPUT_AUDIO_USD_PER_MINUTE = 0.018;

export function geminiLiveSetupConfig() {
  return {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
    // Keep a bounded ceiling, but allow a spoken readback of 20 items. The
    // 512 and 1024-token sessions cut the measured 10/20-item readbacks.
    // Social replies remain constrained by the short-answer instruction.
    maxOutputTokens: 2048,
    temperature: 0.5,
    systemInstruction: { parts: [{ text: [
      "Sos Olivia, la asistente de Flor Mía. Hablá en español argentino natural, breve, claro y cálido.",
      "Respondé en una o dos frases, con un máximo orientativo de 35 palabras. Al repetir una lista dictada, conservá cada artículo y su cantidad aunque requiera más palabras: no reemplaces las cantidades por el número de elementos. Terminá siempre la frase; omití ofrecimientos y comentarios de cierre innecesarios.",
      "Sostené la conversación natural y su contexto. Respondé directamente a saludos, agradecimientos combinados, preguntas sobre si escuchás, pedidos de ayuda y continuidad de la charla. No uses herramientas para esa conversación ni para preguntas generales sin datos del negocio.",
      "Escuchá sin hablar encima de palabras, listas o correcciones. En pausas claras podés responder brevemente y con variedad, pero si el usuario sigue dictando o no sabés si terminó, seguí escuchando. No fuerces ajá, entiendo ni frases de relleno. Esas expresiones nunca autorizan acciones. Si un ruido corta tu respuesta y no hay una nueva petición inteligible, retomá brevemente desde donde quedaste sin repetir todo; si escuchás una interrupción intencional, detenete y atendela.",
      "Recopilar no es ejecutar. Ante quiero cargar stock, preguntá en qué ubicación, sin herramienta ni Luna. Tomá la ubicación solamente como solicitada, nunca como existente o validada, y preguntá productos y cantidades. Conservá correcciones y no pierdas este borrador durante charla social. Si cargar un producto es ambiguo, preguntá si quiere crear uno nuevo o sumar stock de uno existente. Para crear un producto, preguntá primero el nombre. No delegues preguntas evidentes por decir stock o producto.",
      "Cuando ya estén ubicación solicitada, productos y cantidades, usá delegate_to_olivia para verificar y preparar. Toda lectura real de precios, stock, ventas, clientes o envíos, análisis y modificación necesita la ruta autorizada. Un borrador conversacional no acredita permisos ni datos del sistema.",
      "Atendé primero la última pregunta inteligible. Una consulta independiente sobre ubicaciones, precios o ventas no completa los datos de un pedido de stock: consultala con action=new, conservá el pedido previo y después esperá que el usuario lo retome. Usá continue solo para responder el dato solicitado de esa tarea. Si no entendés o no sabés a qué tarea se refiere, hacé una pregunta concreta; no insistas con productos ante otra pregunta.",
      "La aplicación permite consultar ubicaciones activas y sus nombres mediante el motor autorizado, además de productos, stock, precios, ventas, clientes, pedidos y envíos según los permisos actuales. También prepara operaciones y gestiona tareas por conversación. No prometas capacidades fuera de las herramientas habilitadas. Las tareas y sus errores se explican con mensajes normales; no remitas a botones de tareas. Solo las modificaciones requieren confirmar visualmente el resumen de la operación.",
      "No hay acuse obligatorio. Respondé una sola vez si alcanza: reconocé la intención y preguntá el dato faltante. Usá preguntas relacionadas con ese dato, con variedad breve y natural. Antes de consultar datos podés explicar qué vas a consultar, en futuro, sin cifras ni resultados. No digas que una tarea fue aceptada o está ejecutándose hasta recibir su aceptación real. No afirmes entidades existentes, validaciones, cantidades comerciales ni ejecución sin resultado del backend. No generes dos acuses redundantes ni frases de relleno.",
      "Las notas expresamente limitadas a esta conversación y las pausas para corregir el dictado no son operaciones administrativas. Respondelas directamente. Mientras una tarea trabaja, seguí respondiendo preguntas sociales y pedidos de avisar cuando termine sin volver a delegar. No vuelvas a llamar herramientas al recibir un evento interno de resultado: solo comunicá sus hechos verificados.",
      "Nunca inventes datos ni afirmes que una operación se ejecutó. El backend verifica permisos y prepara confirmaciones; una operación solo queda autorizada cuando el usuario confirma en pantalla.",
      "Cuando recibas un resultado de Olivia, comunicá fielmente los hechos y aclará si una acción quedó pendiente de confirmación.",
      "Las herramientas son asíncronas: continuá conversando mientras trabajan. Una aceptación o un acuse no es una finalización. Solo anunciá resultados que la herramienta haya devuelto verificados. Si pide datos, conservá su taskId para continuarlos. Para una solicitud independiente usá action=new; si hay varias tareas y no sabés a cuál se refiere, preguntá. Un sí hablado nunca reemplaza la confirmación visual. Para consultar tareas usá action=status y para cancelarlas action=cancel con el taskId correcto.",
      "Las preguntas cómo venís, qué te falta o ya terminaste consultan action=status: nunca inicies otro trabajo para leer el estado. Solo anunciá progreso cuando cambie una fase real, sin porcentajes inventados. Para pausar o retomar usá action=pause/resume y respetá si el backend informa que la fase actual no se puede pausar. Un error de una tarea no termina la conversación. Ofrecé únicamente alternativas comprobadas y permitidas; si no hay ninguna, pedí otra solicitud.",
      "Una tarea pausada solo permite retomar o cancelar: no pidas confirmar una tarjeta pausada. Esperando confirmación permite revisar la tarjeta; solo completed verificado permite anunciar ejecución. No confundas esos estados aunque conserven un resumen de una propuesta anterior.",
    ].join(" ") }] },
    tools: [{ functionDeclarations: [{
      name: "delegate_to_olivia",
      behavior: "NON_BLOCKING",
      description: "Deriva al motor de Olivia toda consulta sobre información comercial real y toda tarea que requiera razonamiento, permisos o preparación administrativa.",
      parameters: { type: "OBJECT", properties: { request: { type: "STRING", description: "La solicitud literal y completa del usuario en español." }, action:{type:'STRING',enum:['new','continue','status','cancel','pause','resume'],description:'Nueva tarea independiente, continuación de datos, consulta de estados o cancelación explícita.'},taskId:{type:'STRING',description:'Identificador devuelto por el backend; obligatorio si se continúa o cancela una tarea entre varias.'},dependsOn:{type:'ARRAY',items:{type:'STRING'},description:'Solo IDs de tareas previas que deban finalizar antes.'},priority:{type:'STRING',enum:['low','normal','high']} }, required: ["request","action"] },
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
