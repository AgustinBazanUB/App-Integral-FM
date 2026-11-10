import { OLIVIA_CAPABILITIES } from './oliviaCapabilities.mjs';

export const VERIFIED_METADATA = {
  repository: 'https://github.com/AgustinBazanUB/App-Integral-FM',
  branch: 'feat/olivia-conversacion-v8-1',
  commitSha: '77667cb650555211e412b06810f443df634e058b',
  stagingUrl: 'https://deploy-preview-63--appintegralflormia.netlify.app',
  stagingFirebaseProject: 'app-integral-fm-pruebas',
  prohibitedProductionFirebase: 'app-integral-fm'
};

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /AIza[0-9A-Za-z-_]{35}/g,
  /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g, // JWT
  /\b(?:pass|password|contrase[ñn]a|clave|token|secret)\s*[:=]\s*['"]?[^\s,'"]+['"]?/gi,
  /\b(?:\+?54\s?9?\s?)?(?:11|[2368]\d)\s?\d{4}[-\s]?\d{4}\b/g, // Argentine phone
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g // Email
];

export function sanitizeText(input) {
  if (!input || typeof input !== 'string') return '';
  let cleaned = input;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match) => {
      if (match.includes('@')) return '[email_sanitizado]';
      if (/^\+?54|^\d{2}\s?\d{4}/.test(match.trim())) return '[telefono_sanitizado]';
      if (/^Bearer|^AIza|^eyJ/i.test(match.trim())) return '[credencial_sanitizada]';
      return '[secreto_sanitizado]';
    });
  }
  return cleaned.trim();
}

const APP_INTEGRAL_MODULES = {
  'marketing/whatsapp': { title: 'Campañas WhatsApp', tools: ['get_whatsapp_campaigns'] },
  'marketing/meta-ads': { title: 'Meta Ads', tools: ['get_meta_ads_campaigns'] },
  'shipping': { title: 'Gestión de envíos', tools: ['get_shipments'] },
  'arca': { title: 'Facturación ARCA', tools: ['get_invoice_status'] },
  'quick-sales': { title: 'Ventas rápidas', tools: ['get_invoice_status'] },
  'warehouse': { title: 'Depósito e inventario', tools: ['list_warehouses', 'get_inventory_summary', 'get_stock_movements', 'resolve_transfer_origin'] },
  'locations': { title: 'Ubicaciones', tools: ['list_fair_events', 'prepare_create_location'] },
  'loyal-customers': { title: 'Clientes', tools: ['search_customers', 'get_customer', 'get_customer_history'] },
  'finance': { title: 'Finanzas', tools: ['get_financial_summary', 'get_expenses'] },
  'metrics': { title: 'Métricas generales', tools: ['get_sales_metrics', 'get_sales_history', 'forecast_product_demand'] },
  'administration': { title: 'Administración y usuarios', tools: ['get_users'] },
  'settings': { title: 'Configuración', tools: ['get_configuration_summary'] }
};

export function diagnoseIncidentReason({ requestText, operation, module, toolName, error }) {
  const sanitizedRequest = sanitizeText(requestText || '');
  const normalized = sanitizedRequest.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents for matching

  // Check if capability is absent in Olivia but exists in App Integral
  if (/whatsapp|mensajes?\s+masivos?|campana/.test(normalized) && /envi|crea|manda|inicia/.test(normalized)) {
    return {
      category: 'CAPABILITY_AUSENTE',
      module: 'marketing/whatsapp',
      summary: 'Operación existente en App Integral (Campaña WhatsApp masiva) no cubierta por la API de Olivia.',
      toolStatus: 'ausente'
    };
  }
  if (/facturar|emitir factura|comprobante arca/.test(normalized) && /emit|hac|gener|crea/.test(normalized)) {
    return {
      category: 'CAPABILITY_AUSENTE',
      module: 'arca',
      summary: 'Operación existente en App Integral (Emisión fiscal ARCA) requiere confirmación manual y carece de herramienta de mutación en Olivia.',
      toolStatus: 'ausente'
    };
  }
  if (/asignar repartidor|despachar envio|iniciar gps|ruta reparto/.test(normalized)) {
    return {
      category: 'CAPABILITY_AUSENTE',
      module: 'shipping',
      summary: 'Operación existente en Gestión de Envíos (Asignación/Despacho de reparto) no delegable por voz a Olivia.',
      toolStatus: 'ausente'
    };
  }

  if (error) {
    const isNetworkOr5xx = error.status >= 500 || /timeout|network|unavailable|failed/i.test(error.message || '');
    return {
      category: 'ERROR_SOFTWARE',
      module: module || 'core',
      summary: `Falla técnica de software: ${error.code || 'error_desconocido'}. ${error.message || 'Error de procesamiento'}`,
      toolStatus: toolName ? 'presente_con_falla' : 'no_verificado'
    };
  }

  const cleanedWords = normalized.replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const isGibberish = cleanedWords.every(w => /^(?:eh+|ah+|coso|hum|este|cosa|eso|aquello|nada)$/.test(w));
  if (normalized.length < 5 || /^[?¿!¡\s.]+$/.test(sanitizedRequest) || isGibberish || cleanedWords.length === 0) {
    return {
      category: 'PEDIDO_CONFUSO',
      module: module || 'conversacion',
      summary: 'Pedido confuso o sin datos suficientes para inferir intención.',
      toolStatus: 'no_verificado'
    };
  }

  return {
    category: 'INCIDENCIA_GENERAL',
    module: module || 'core',
    summary: 'Incidencia registrada en el procesamiento de la solicitud.',
    toolStatus: 'no_verificado'
  };
}

export function buildCodexPrompt(incident) {
  const {
    id,
    metadata = VERIFIED_METADATA,
    originalRequest,
    transcription,
    understanding = {},
    expectation,
    observedResult,
    operationStatus = 'failed',
    writeState = 'aborted',
    errorDetails = {},
    toolDiagnosis = {},
    stepsToReproduce = [],
    userRelato
  } = incident;

  const sanitizedReq = sanitizeText(originalRequest);
  const sanitizedTrans = sanitizeText(transcription || originalRequest);
  const sanitizedRelato = sanitizeText(userRelato || '');

  return [
    `### 1. ROL Y ENTORNO VERIFICADO`,
    `- Rol: Asistente técnico Codex / Ingeniero Senior QA App Integral Flor Mía.`,
    `- Repositorio: ${metadata.repository}`,
    `- Branch: ${metadata.branch}`,
    `- Commit SHA: ${metadata.commitSha}`,
    `- Entorno autorizado: Staging (${metadata.stagingUrl})`,
    `- Firebase de pruebas: ${metadata.stagingFirebaseProject} (PROHIBIDO PRODUCCIÓN: ${metadata.prohibitedProductionFirebase})`,
    ``,
    `### 2. PEDIDO ORIGINAL SANITIZADO Y TRANSCRIPCIÓN`,
    `- Pedido original del usuario: "${sanitizedReq}"`,
    `- Transcripción efectiva de voz: "${sanitizedTrans}"`,
    sanitizedRelato ? `- Relato adicional del usuario: "${sanitizedRelato}"` : `- Relato adicional: no provisto`,
    ``,
    `### 3. QUÉ ENTENDIÓ OLIVIA`,
    `- Intención detectada: ${understanding.intent || 'no verificada'}`,
    `- Clasificación de ruta: ${understanding.routeCategory || 'TASK'} (${understanding.route || 'delegate'})`,
    `- Slots identificados: ${JSON.stringify(understanding.slots || {})}`,
    `- Módulo destino: ${understanding.targetModule || toolDiagnosis.module || 'no verificado'}`,
    ``,
    `### 4. EXPECTATIVA Y RESULTADO OBSERVADO`,
    `- Expectativa: ${expectation || 'Ejecución segura con validación visual o respuesta informativa veraz.'}`,
    `- Resultado observado: ${observedResult || 'Operación no completada.'}`,
    `- Estado de la operación: ${operationStatus}`,
    `- Estado de escritura en base de datos: ${writeState} (${writeState === 'unknown' ? 'BLOQUEO: Estado desconocido impide reintento a ciegas' : 'Sin mutaciones inconsistentes'})`,
    ``,
    `### 5. ERROR Y DIAGNÓSTICO`,
    `- Código de error: ${errorDetails.code || 'SIN_CODIGO'}`,
    `- Mensaje / Síntoma: ${errorDetails.message || 'Falla en la atención de la solicitud'}`,
    `- Diagnóstico confirmado vs. hipótesis: ${errorDetails.diagnostic || 'Confirmado por auditoría de capacidades'}`,
    `- Capability / Herramienta: ${toolDiagnosis.toolName || 'N/A'} (Estado: ${toolDiagnosis.toolStatus || 'no_verificado'})`,
    ``,
    `### 6. PASOS PARA REPRODUCIR EN STAGING`,
    ...(stepsToReproduce.length > 0 ? stepsToReproduce.map((s, i) => `${i + 1}. ${s}`) : [
      `1. Abrir ${metadata.stagingUrl}/gestion en Google Chrome.`,
      `2. Activar Olivia (botón Conversar o panel lateral).`,
      `3. Enviar solicitud: "${sanitizedReq}".`,
      `4. Observar respuesta de Olivia y estado de la interfaz.`
    ]),
    `- Datos sintéticos recomendados: Depósito QA Olivia V81 / Aceite QA PR53 (solo staging).`,
    ``,
    `### 7. TAREAS PARA CODEX`,
    `1. Investigar de punta a punta: UI → transcripción → router (${understanding.routeCategory || 'TASK'}) → backend → Firestore.`,
    `2. Corregir la causa raíz del módulo afectado preservando el diseño integral (no parches cosméticos ni ifs puntuales).`,
    `3. Si falta la capacidad, implementar el contrato formal en OLIVIA_CAPABILITIES y su handler seguro.`,
    `4. Agregar tests unitarios y de integración para el caso de falla y su recuperación.`,
    `5. Ejecutar npm test, npm run build y verificar en Chrome sobre el preview de staging.`,
    `6. Revalidar regresiones adyacentes de DIRECT, FAST_READ y TASK.`,
    ``,
    `### 8. CRITERIOS DE ACEPTACIÓN Y SEGURIDAD`,
    `- Nunca ejecutar mutaciones comerciales sin confirmación visual explícita del usuario.`,
    `- Separación estricta de datos: operar exclusivamente contra ${metadata.stagingFirebaseProject}.`,
    `- Idempotencia: las solicitudes repetidas no duplican registros ni ejecutan escrituras desconocidas.`,
    `- Revisión del commit final con hash SHA documentado.`,
    ``,
    `### 9. LOG DE EVIDENCIAS Y ESTADO`,
    `- ID Incidencia: ${id}`,
    `- Fecha/Hora: ${incident.createdAt || new Date().toISOString()}`,
    `- Estado de resolución: PENDIENTE_CODEX`,
    `- Evidencia archivada: docs/olivia/antigravity-chrome-qa/INCIDENCIAS_SINTETICAS.jsonl`
  ].join('\n');
}

export function createIncident({
  conversationId,
  turnId,
  taskId,
  originalRequest,
  transcription,
  routeCategory = 'TASK',
  intent,
  slots = {},
  targetModule,
  toolName,
  error,
  expectation,
  observedResult,
  writeState = 'aborted',
  userRelato = '',
  stepsToReproduce = []
}) {
  const now = new Date().toISOString();
  const safeTurnId = turnId || taskId || 'turn_0';
  const safeConvId = conversationId || 'conv_active';
  const idempotencyKey = `incident_${safeConvId}_${safeTurnId}`;

  const diagnosis = diagnoseIncidentReason({
    requestText: originalRequest,
    module: targetModule,
    toolName,
    error
  });

  const operationStatus = error ? 'failed' : diagnosis.category === 'CAPABILITY_AUSENTE' ? 'unsupported' : 'uncompleted';

  const incident = {
    id: idempotencyKey,
    idempotencyKey,
    createdAt: now,
    status: 'new',
    operationStatus,
    writeState, // 'confirmed' | 'unknown' | 'aborted'
    preventBlindRetry: writeState === 'unknown',
    module: diagnosis.module || targetModule || 'general',
    category: diagnosis.category,
    summary: diagnosis.summary,
    originalRequest: sanitizeText(originalRequest),
    transcription: sanitizeText(transcription || originalRequest),
    userRelato: sanitizeText(userRelato),
    understanding: {
      intent,
      routeCategory,
      slots,
      targetModule: diagnosis.module || targetModule
    },
    expectation: expectation || 'Atención de solicitud con confirmación visual',
    observedResult: observedResult || diagnosis.summary,
    toolDiagnosis: {
      toolName: toolName || null,
      toolStatus: diagnosis.toolStatus,
      module: diagnosis.module
    },
    errorDetails: error ? {
      code: error.code || 'SOFTWARE_ERROR',
      message: sanitizeText(error.message),
      status: error.status || 500,
      diagnostic: error.diagnostic || 'Confirmado por runtime'
    } : {
      code: diagnosis.category,
      message: diagnosis.summary,
      status: 200,
      diagnostic: 'Autodiagnóstico por matriz de capacidades'
    },
    stepsToReproduce,
    conversationReply: getConversationalExplanation({
      category: diagnosis.category,
      summary: diagnosis.summary,
      writeState
    })
  };

  incident.promptForCodex = buildCodexPrompt(incident);
  return incident;
}

export function getConversationalExplanation({ category, summary, writeState }) {
  if (writeState === 'unknown') {
    return 'No pude confirmar si la operación se completó en el servidor. Por seguridad no voy a reintentarla automáticamente para no duplicar datos. El administrador ya tiene la incidencia guardada.';
  }
  if (category === 'CAPABILITY_AUSENTE') {
    return 'Esta operación existe en Flor Mía pero todavía no cuento con la herramienta para realizarla directamente. Registré la incidencia con el detalle para que el equipo técnico pueda incorporarla.';
  }
  if (category === 'ERROR_SOFTWARE') {
    return 'Ocurrió un error técnico al procesar este pedido y no se completó ningún cambio. La incidencia quedó guardada en el panel del administrador.';
  }
  return 'No pude completar tu pedido. Dejé la incidencia registrada para que podamos revisarla.';
}

export class IncidentStore {
  constructor() {
    this.incidents = new Map();
  }

  save(incident) {
    if (!incident || !incident.idempotencyKey) throw new Error('Incidencia requiere idempotencyKey');
    if (this.incidents.has(incident.idempotencyKey)) {
      // Idempotent: return existing without duplicating
      const existing = this.incidents.get(incident.idempotencyKey);
      if (incident.userRelato && incident.userRelato !== existing.userRelato) {
        existing.userRelato = incident.userRelato;
        existing.promptForCodex = buildCodexPrompt(existing);
      }
      return { incident: existing, duplicated: true };
    }
    this.incidents.set(incident.idempotencyKey, incident);
    return { incident, duplicated: false };
  }

  get(id) {
    return this.incidents.get(id) || null;
  }

  list() {
    return Array.from(this.incidents.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  clear() {
    this.incidents.clear();
  }
}

export const globalIncidentStore = new IncidentStore();
