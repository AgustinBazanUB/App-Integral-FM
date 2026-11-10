import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeText,
  diagnoseIncidentReason,
  buildCodexPrompt,
  createIncident,
  getConversationalExplanation,
  IncidentStore,
  VERIFIED_METADATA
} from '../src/shared/oliviaIncidentReports.mjs';

test('Caso 81: sanitización elimina claves, passwords, tokens JWT, teléfonos y emails', () => {
  const dirty = 'Usuario juan@example.com con pass: "superSecret123", token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID y tel +54 9 11 5555-1234 llamó con API key AIzaSyBfJUuxIpQm0rFmbrlhSP420zgGw2AnqRs';
  const clean = sanitizeText(dirty);

  assert.doesNotMatch(clean, /juan@example\.com/);
  assert.doesNotMatch(clean, /superSecret123/);
  assert.doesNotMatch(clean, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/);
  assert.doesNotMatch(clean, /5555-1234/);
  assert.doesNotMatch(clean, /AIzaSyBfJUuxIpQm0rFmbrlhSP420zgGw2AnqRs/);
  assert.match(clean, /\[email_sanitizado\]/);
  assert.match(clean, /\[credencial_sanitizada\]/);
  assert.match(clean, /\[telefono_sanitizado\]/);
});

test('Caso 81: módulo existente en App Integral no cubierto por Olivia genera CAPABILITY_AUSENTE', () => {
  const incident = createIncident({
    conversationId: 'conv_123',
    turnId: 'turn_45',
    originalRequest: 'Mandá una campaña de WhatsApp a todos los clientes del local',
    transcription: 'Manda una campana de whatsapp a todos los clientes del local',
    routeCategory: 'TASK',
    targetModule: 'marketing/whatsapp'
  });

  assert.equal(incident.category, 'CAPABILITY_AUSENTE');
  assert.equal(incident.module, 'marketing/whatsapp');
  assert.equal(incident.toolDiagnosis.toolStatus, 'ausente');
  assert.equal(incident.operationStatus, 'unsupported');
  assert.match(incident.conversationReply, /no cuento con la herramienta para realizarla directamente/);
  assert.doesNotMatch(incident.conversationReply, /ya la realicé|completado exitosamente/);
});

test('Caso 81: falla de software o API genera ERROR_SOFTWARE con diagnóstico sanitizado', () => {
  const rawError = {
    code: 'firestore/deadline-exceeded',
    message: 'Request to Firestore with key AIzaSyBfJUuxIpQm0rFmbrlhSP420zgGw2AnqRs timed out after 10000ms',
    status: 504
  };

  const incident = createIncident({
    conversationId: 'conv_api_err',
    turnId: 'turn_02',
    originalRequest: 'Cargá 10 unidades de aceite en el depósito central',
    targetModule: 'warehouse',
    toolName: 'prepare_warehouse_intake',
    error: rawError
  });

  assert.equal(incident.category, 'ERROR_SOFTWARE');
  assert.equal(incident.errorDetails.code, 'firestore/deadline-exceeded');
  assert.doesNotMatch(incident.errorDetails.message, /AIzaSyBfJUuxIpQm0rFmbrlhSP420zgGw2AnqRs/);
  assert.match(incident.conversationReply, /Ocurrió un error técnico/);
});

test('Caso 81: pedido confuso o sin datos suficientes no inventa stack traces ni rutas', () => {
  const incident = createIncident({
    conversationId: 'conv_confuso',
    turnId: 'turn_99',
    originalRequest: '??? ehhh coso',
    targetModule: null
  });

  assert.equal(incident.category, 'PEDIDO_CONFUSO');
  assert.equal(incident.toolDiagnosis.toolStatus, 'no_verificado');
  assert.match(incident.promptForCodex, /no verificado|no provisto/);
  assert.doesNotMatch(incident.promptForCodex, /TypeError: cannot read property/);
});

test('Caso 81: estado UNKNOWN de escritura activa preventBlindRetry y advertencia conversacional', () => {
  const incident = createIncident({
    conversationId: 'conv_unknown_write',
    turnId: 'turn_50',
    originalRequest: 'Confirmá la venta rápida #48',
    targetModule: 'quick-sales',
    writeState: 'unknown',
    error: { code: 'network_interrupted_during_commit', message: 'Connection dropped while committing sale' }
  });

  assert.equal(incident.writeState, 'unknown');
  assert.equal(incident.preventBlindRetry, true);
  assert.match(incident.conversationReply, /No pude confirmar si la operación se completó/);
  assert.match(incident.conversationReply, /no voy a reintentarla automáticamente para no duplicar datos/);
  assert.match(incident.promptForCodex, /BLOQUEO: Estado desconocido impide reintento a ciegas/);
});

test('Caso 81: idempotencia por turno/tarea no duplica incidencias en el almacén', () => {
  const store = new IncidentStore();

  const inc1 = createIncident({
    conversationId: 'conv_idem',
    turnId: 'turn_01',
    originalRequest: 'Emitir factura ARCA para la venta 12'
  });

  const res1 = store.save(inc1);
  assert.equal(res1.duplicated, false);
  assert.equal(store.list().length, 1);

  // Retry same turn
  const inc2 = createIncident({
    conversationId: 'conv_idem',
    turnId: 'turn_01',
    originalRequest: 'Emitir factura ARCA para la venta 12'
  });

  const res2 = store.save(inc2);
  assert.equal(res2.duplicated, true);
  assert.equal(store.list().length, 1);
});

test('Caso 81: acción manual "Reportar problema" conserva el relato editable del usuario', () => {
  const store = new IncidentStore();

  const inc = createIncident({
    conversationId: 'conv_user_feedback',
    turnId: 'turn_05',
    originalRequest: 'Pasame el balance de la sucursal',
    userRelato: 'Le pedí el balance del local de hoy pero me mostró el de ayer y no entendió la corrección.'
  });

  store.save(inc);
  const saved = store.get(inc.id);
  assert.match(saved.userRelato, /Le pedí el balance del local de hoy/);
  assert.match(saved.promptForCodex, /Relato adicional del usuario: "Le pedí el balance del local de hoy/);

  // Updating the user note updates the prompt
  const updatedInc = {
    ...inc,
    userRelato: 'Nota actualizada por el administrador: verificar zona horaria de Mendoza.'
  };
  const resUpdate = store.save(updatedInc);
  assert.equal(resUpdate.duplicated, true);
  assert.match(resUpdate.incident.userRelato, /verificar zona horaria de Mendoza/);
  assert.match(resUpdate.incident.promptForCodex, /verificar zona horaria de Mendoza/);
});

test('Caso 81: el prompt generado para Codex contiene las 9 secciones en el orden exacto requerido', () => {
  const incident = createIncident({
    conversationId: 'conv_codex_order',
    turnId: 'turn_order_01',
    originalRequest: 'Asigná el repartidor Carlos al envío FM-100',
    targetModule: 'shipping',
    routeCategory: 'TASK',
    intent: 'assign_courier',
    slots: { courierName: 'Carlos', shipmentCode: 'FM-100' },
    userRelato: 'El chofer ya estaba en el local y Olivia no tiene opción de asignarlo'
  });

  const prompt = incident.promptForCodex;

  const section1 = prompt.indexOf('### 1. ROL Y ENTORNO VERIFICADO');
  const section2 = prompt.indexOf('### 2. PEDIDO ORIGINAL SANITIZADO Y TRANSCRIPCIÓN');
  const section3 = prompt.indexOf('### 3. QUÉ ENTENDIÓ OLIVIA');
  const section4 = prompt.indexOf('### 4. EXPECTATIVA Y RESULTADO OBSERVADO');
  const section5 = prompt.indexOf('### 5. ERROR Y DIAGNÓSTICO');
  const section6 = prompt.indexOf('### 6. PASOS PARA REPRODUCIR EN STAGING');
  const section7 = prompt.indexOf('### 7. TAREAS PARA CODEX');
  const section8 = prompt.indexOf('### 8. CRITERIOS DE ACEPTACIÓN Y SEGURIDAD');
  const section9 = prompt.indexOf('### 9. LOG DE EVIDENCIAS Y ESTADO');

  assert.ok(section1 >= 0, 'Section 1 exists');
  assert.ok(section2 > section1, 'Section 2 follows Section 1');
  assert.ok(section3 > section2, 'Section 3 follows Section 2');
  assert.ok(section4 > section3, 'Section 4 follows Section 3');
  assert.ok(section5 > section4, 'Section 5 follows Section 4');
  assert.ok(section6 > section5, 'Section 6 follows Section 5');
  assert.ok(section7 > section6, 'Section 7 follows Section 6');
  assert.ok(section8 > section7, 'Section 8 follows Section 7');
  assert.ok(section9 > section8, 'Section 9 follows Section 8');

  // Verify staging isolation verified in Section 1
  assert.match(prompt, /app-integral-fm-pruebas/);
  assert.match(prompt, /PROHIBIDO PRODUCCIÓN: app-integral-fm/);
  assert.match(prompt, /Commit SHA: 77667cb/);
});
