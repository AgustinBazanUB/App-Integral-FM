# Contrato Flor Mía Web-App ↔ Extensión WhatsApp

## Alcance

La Web-App prepara campañas. La extensión privada ejecuta técnicamente WhatsApp Web. La Web-App no conoce selectores DOM, tiempos internos, checkpoints, QR, credenciales ni tokens de WhatsApp.

Versión de extensión objetivo de este corte: **0.9.4**.

## Transporte

- Canal: `flor_mia_whatsapp_extension`.
- `protocolVersion`: `1`.
- La Web-App usa `window.postMessage()` con `targetOrigin = window.location.origin`.
- El content script escucha únicamente páginas autorizadas y valida `event.source`, `event.origin`, `channel`, `protocolVersion`, `type` y schema.
- Las respuestas puntuales usan `replyTo` con el `requestId` recibido.
- Los eventos de campaña incluyen `campaignId` y `sequence` entero monótonamente creciente.

### Ventanas de respuesta de la Web-App

- `PING`: 5 segundos.
- `PREPARE`: 30 segundos.
- `PREFLIGHT`: 35 segundos.
- `START / PAUSE / RESUME / STOP`: 35 segundos.

Estos timeouts son límites del bridge, no sustituyen los budgets internos ni las comprobaciones de seguridad. Pause/Stop tienen ACK visual inmediato y el control duplicado se bloquea sin esperar el siguiente render.

## Lifecycle y reconexión del bridge

Cada Content Bridge de la Web-App publica metadata de lifecycle:

```js
{
  bridgeInstanceId,
  bridgeGeneration,
  bridgeCreatedAt,
  extensionVersion,
  runtimeAvailable
}
```

La generación más nueva es la única que puede responder. Una instancia anterior que detecta que fue reemplazada deja de escuchar `window.message`, `chrome.storage.onChanged` y sus observers. Nunca deben responder dos bridges al mismo PING.

La Web-App maneja cuatro estados de conexión:

- `connected`;
- `reconnecting`;
- `needs_page_reload`;
- `disconnected`.

El heartbeat es un `PING` lightweight, no un preflight. Los PING concurrentes se deduplican. Mientras la página está visible se comprueba de forma espaciada; ante fallos hay backoff acotado y una sola reconexión activa. Al ocultarse la página, timers y request pendientes se cancelan.

Si un content script conserva un `chrome.runtime` invalidado después de recargar/actualizar la extensión, se marca stale, emite como máximo una señal local segura y deja de usar el runtime. La UI muestra **“Necesitamos reconectar la extensión”** y el botón **Reconectar** recarga únicamente la Web-App. No hace falta desinstalar la extensión.

Una suspensión normal del Service Worker MV3 no equivale a este error. El worker puede rehidratar campaña/checkpoints al despertar; no se mantiene vivo mediante keepalive agresivo.

## Contrato de teléfono

La UI acepta formatos argentinos habituales. Antes de construir la campaña, un móvil argentino inequívoco se normaliza a:

`549` + `10 dígitos nacionales`

Ejemplo: `11 5757-1979`, `+54 9 11 5757-1979`, `5491157571979`, variantes con espacios/guiones y el formato local legado `011 15-...` admitido producen el mismo canonical.

Reglas:

- el formato amigable puede seguir usándose para display;
- `recipients[].phone` enviado a la extensión usa el canonical;
- deduplicación usa ese mismo canonical;
- un número regional corto o ambiguo no se completa silenciosamente;
- la extensión vuelve a validar el payload y el destinatario antes de contenido.

WhatsApp puede exponer un JID argentino equivalente sin el indicador móvil `9`. Sólo se acepta la equivalencia controlada `549 + 10 nacionales` ↔ `54 + esos 10 nacionales`; nunca se usa para adivinar país o aceptar otro número.

## Mensajes

Web → extensión:
- `FLORMIA_EXTENSION_PING`
- `FLORMIA_EXTENSION_PREFLIGHT_REQUEST`
- `FLORMIA_CAMPAIGN_PREPARE`
- `FLORMIA_CAMPAIGN_START`
- `FLORMIA_CAMPAIGN_PAUSE`
- `FLORMIA_CAMPAIGN_RESUME`
- `FLORMIA_CAMPAIGN_STOP`
- `FLORMIA_CAMPAIGN_STATUS_REQUEST`
- `FLORMIA_CAMPAIGN_CANCEL_REQUEST`

Extensión → Web:
- `FLORMIA_EXTENSION_STATUS`
- `FLORMIA_CAMPAIGN_ACCEPTED`
- `FLORMIA_CAMPAIGN_STARTED`
- `FLORMIA_CAMPAIGN_PROGRESS`
- `FLORMIA_CAMPAIGN_PAUSED`
- `FLORMIA_CAMPAIGN_RESUMED`
- `FLORMIA_CAMPAIGN_COMPLETED`
- `FLORMIA_CAMPAIGN_ERROR`
- `FLORMIA_CAMPAIGN_STOPPED`
- `FLORMIA_CAMPAIGN_CANCELLED`

## Estado de extensión

`FLORMIA_EXTENSION_STATUS.payload` puede incluir:

```js
{
  operational: true,
  message: "Listo para enviar",
  extensionVersion: "0.9.4",
  configuredLimit: 1000,
  sentToday: 427,
  availableToday: 573,
  bridgeInstanceId: "...",
  bridgeGeneration: 4,
  bridgeCreatedAt: "...",
  runtimeAvailable: true,
  errorCode: "opcional"
}
```

Conexión/compatibilidad y verificación de destinatario son conceptos distintos: un status operativo o preflight GREEN nunca autoriza por sí solo a enviar contenido a un chat.

## Preparación de campaña

`FLORMIA_CAMPAIGN_PREPARE.payload` contiene:

```js
{
  campaignId,
  campaignName,
  createdBy,
  recipients: [{ recipientId, clientId, name, phone, source }],
  message,
  imageCount,
  imageOrder,
  images: [{ order, name, type, size, dataBase64 }],
  totalRecipients
}
```

`message` viaja como el string escrito por el usuario. El bridge no lo sustituye por placeholders, probes ni texto diagnóstico. La extensión conserva ese string en CampaignStore/checkpoint y sólo representa CRLF/CR como LF al escribir el `contenteditable`.

Las imágenes son temporales. Firestore conserva metadatos/snapshots, no Base64 persistente ni binarios. La extensión reconstruye el archivo para el step activo y libera las referencias cuando dejan de ser necesarias.

## Conversation Proof 0.9.4

Flujo previo a contenido:

`navigation request → fresh Content Script → handshake → conversation proof → contenido real`

### Strong proof

Puede provenir de evidencia semántica directamente vinculada al peer:

- `phone` retenido por la navegación `/send?phone=...` cuando coincide con el canonical esperado;
- `data-jid`, `data-chat-id`, `data-peer-id` o `data-contact-id` del header/main;
- consenso de JID de mensajes pertenecientes al chat.

Una evidencia fuerte distinta o conflictiva siempre bloquea.

### Causal proof

Si WhatsApp muestra un nombre guardado y no expone teléfono/JID utilizable, no se acepta `nombre + composer` por sí solos. Puede establecerse una lease causal únicamente si se conserva una cadena correlacionada:

1. tab de WhatsApp ya vinculado;
2. canonical esperado;
3. `navigationRequestId` único;
4. transición desde el Content Script anterior;
5. Content Script nuevo confirmado;
6. cronología de navegación válida;
7. ausencia de error de número inválido;
8. conversación/header/composer presentes;
9. huella semántica secundaria de esa conversación;
10. sin selección manual de otro chat;
11. sin evidencia fuerte contradictoria.

La lease se vuelve a validar inmediatamente antes del Send. Si cambia el chat, fingerprint, tab, generación o aparece evidencia contradictoria, falla cerrado.

### Fail

Se bloquea el envío ante número inválido, JID/teléfono distinto, identificadores conflictivos, navegación stale, selección manual, cambio de conversación o evidencia insuficiente sin cadena causal.

## Retry budget

Un proof sin evidencia nueva no consume bloques repetidos de 15 segundos. El proof está acotado a aproximadamente 4 segundos por generación de navegación y una falla `insufficient_evidence` pausa ese ciclo sin repetirlo inmediatamente.

El checkpoint distingue:

- `openConversationAttempts`: contador diagnóstico de aperturas;
- `openConversationFailures`: budget acumulativo de fallos.

Las aperturas confirmadas no consumen el budget de fallos, porque una reconciliación posterior puede necesitar volver a probar el chat. Los fallos de apertura/proof sí se acumulan a través de Resume y quedan limitados.

## Resume / Pause / Stop

- La Web-App usa un mutex síncrono además del estado visual para impedir doble Resume/Pause/Stop antes del próximo render.
- Un Resume duplicado que llega cuando la extensión ya está `running/waiting` es idempotente: devuelve el estado actual en vez de `INVALID_INPUT`.
- Pause/Stop abortan waits/proof pre-send cuando todavía no hubo `sendAttempted`.
- Si un Send pudo ocurrir, se completa la reconciliación necesaria antes de detenerse en una frontera segura.

## Diagnósticos

Preflight automático, status y health checks son no destructivos. No pueden escribir/borrar el composer, adjuntar probes, abrir previews sintéticos ni presionar Send.

El reporte técnico puede registrar etapa, duración, proof level/strategy, generación, request ID y counters sanitizados, pero no el texto privado ni snapshots DOM. Los reportes grandes se generan bajo demanda o por incidente, no como parte del heartbeat.

## Frecuencia y performance

- El Service Worker mantiene queue, campaña, delays, checkpoints y controles.
- El Content Script conoce sólo el contacto/step activo y funciona como adaptador DOM.
- No hay polling de 100 ms permanente.
- Los waits usan checks inmediatos + observers/eventos acotados + timeout/AbortSignal.
- El PING de estado no ejecuta compatibility discovery ni genera reportes.
- El heartbeat de la Web-App está single-flight y se detiene al ocultarse la página.

## Estado de implementación

El lado Flor Mía se mantiene en `/gestion/marketing/whatsapp` dentro del Deploy Preview. La rama normaliza destinatarios, preserva exactamente el mensaje, deduplica PING/control y expone reconexión simple.

La extensión 0.9.4 conserva CampaignEngine/ContactEngine, checkpoints durables y prevención at-most-once. Tests y build validan el contrato; **una prueba manual con un único contacto autorizado sigue siendo obligatoria** antes de declarar funcionamiento real en WhatsApp Web.
