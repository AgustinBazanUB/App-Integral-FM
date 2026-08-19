# Contrato Flor Mía Web-App ↔ Extensión WhatsApp

## Alcance

La Web-App prepara campañas. La extensión privada ejecuta técnicamente WhatsApp Web. La Web-App no conoce selectores DOM, tiempos, tandas, reintentos, cookies, QR, credenciales ni tokens de WhatsApp.

## Transporte

- Canal: `flor_mia_whatsapp_extension`.
- `protocolVersion`: `1`.
- La Web-App usa `window.postMessage()` con `targetOrigin = window.location.origin`.
- El content script escucha únicamente páginas autorizadas y valida `event.source`, `event.origin`, `channel`, `protocolVersion`, `type` y schema.
- Las respuestas usan `replyTo` con el `requestId` recibido cuando responden a una solicitud puntual.
- Los eventos de campaña incluyen `campaignId` y un `sequence` entero monótonamente creciente.

### Ventanas de respuesta de la Web-App

La Web-App usa ventanas diferentes según el tipo de operación para evitar falsos timeouts mientras la extensión realiza trabajo real:

- `PING`: 5 segundos.
- `PREPARE`: 30 segundos.
- `PREFLIGHT`: 35 segundos.
- `START / PAUSE / RESUME / STOP`: 35 segundos.

Estos timeouts son límites de espera de la Web-App; no sustituyen los timeouts técnicos internos ni las comprobaciones de seguridad de la extensión. La interfaz acusa visualmente Pause/Stop de inmediato (`Pausando…` / `Deteniendo…`) y evita clicks duplicados mientras espera la transición durable de la extensión.

Si la extensión se recarga o actualiza mientras el Deploy Preview permanece abierto, el content script anterior pierde su contexto de extensión. La pestaña debe recargarse para inyectar el bridge de la versión nueva. La extensión responde este caso como `EXTENSION_CONTEXT_INVALIDATED` y no debe intentar usar nuevamente `chrome.runtime` desde ese contexto viejo.

## Contrato de teléfono

La UI acepta formatos argentinos habituales para no exigir E.164 al usuario. Antes de construir la campaña, la Web-App normaliza un móvil argentino inequívoco a:

`549` + `10 dígitos nacionales`

Ejemplo: `11 5757-1979`, `+54 9 11 5757-1979` y el formato local legado equivalente producen `5491157571979`.

Reglas de integración:

- el valor amigable/nacional puede seguir usándose para display y administración;
- `recipients[].phone` enviado a la extensión debe ser el valor WhatsApp canónico;
- la deduplicación de destinatarios usa ese mismo canonical;
- la Web-App no adivina otro país ni completa silenciosamente un número ambiguo;
- la extensión vuelve a validar el payload y compara el destinatario real antes de permitir contenido.

WhatsApp puede exponer internamente un JID argentino equivalente sin el indicador móvil `9`. Esa equivalencia sólo puede aceptarse de forma controlada cuando el payload ya declaró inequívocamente `549 + 10 dígitos`; nunca se usa para adivinar un país o aceptar un teléfono distinto.

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

`FLORMIA_EXTENSION_STATUS.payload`:

```js
{
  operational: true | false,
  message: "texto comprensible",
  extensionVersion: "0.9.2",
  configuredLimit: 1000,
  sentToday: 427,
  availableToday: 573,
  errorCode: "opcional"
}
```

La vista primaria usa un modelo mental simple: **Conectado / Listo para enviar** o **Necesita revisión**. Compatibilidad de UI y verificación de destinatario son conceptos distintos: un preflight GREEN no prueba por sí mismo que el chat activo corresponda al destinatario esperado. El límite diario es autoridad exclusiva de la extensión.

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

`dataBase64` es únicamente un formato temporal de transporte dentro del mensaje Web-App → extensión. La Web-App obtiene los bytes desde el `File`/`ArrayBuffer`, los serializa para el bridge y no persiste esa representación en Firestore, Firebase Storage, GitHub ni Netlify. La extensión reconstruye los bytes del archivo original antes de preparar el adjunto. Firestore conserva sólo metadatos de imágenes.

El orden lógico definido por la Web-App es Imagen 1 → Imagen 2 → Imagen 3 → Texto. La extensión garantiza el orden técnico real.

## Seguridad de conversación y envío

Antes del primer step de contenido la extensión debe completar:

`openConversation → wait conversation → proveConversation → contenido`

- composer visible no prueba identidad;
- la URL `/send?phone=...` no prueba identidad por sí sola;
- sólo evidencia estructurada fuerte del peer activo permite avanzar;
- si no puede demostrarse el destinatario, la campaña se pausa sin enviar;
- si `sendAttempted=true`, Pause/Stop espera la reconciliación necesaria antes de cruzar la frontera segura;
- un resultado ambiguo nunca se reintenta a ciegas.

## Progreso

Los eventos de progreso incluyen:

```js
{
  channel: "flor_mia_whatsapp_extension",
  protocolVersion: 1,
  type: "FLORMIA_CAMPAIGN_PROGRESS",
  campaignId: "...",
  sequence: 12,
  payload: { sent: 240, progress: { completed: 240 }, finalSummary: { failed: 3 } }
}
```

La extensión incrementa `sequence`. La Web-App ignora secuencias antiguas y nunca permite que enviados supere `totalRecipients`.

## Datos prohibidos

No enviar ni almacenar en Flor Mía: cookies, tokens, contraseñas, QR, localStorage de WhatsApp, selectores internos, configuraciones de timing/tandas/reintentos ni binarios persistentes de las imágenes.

## Frecuencia de estado

La pantalla no ejecuta diagnósticos pesados para refrescar un badge. Usa PING al cargar/recuperar foco y eventos push de campaña. `PREFLIGHT` completo se reserva para una comprobación solicitada explícitamente o un punto técnico donde realmente sea necesario.

La extensión puede informar progreso tantas veces como sea útil, siempre con `sequence` creciente. La Web-App actualiza los contadores del documento principal, pero sólo crea un evento/auditoría cuando cambia el estado operativo, evitando ruido y escrituras innecesarias.

## Estado de implementación

El lado Flor Mía está implementado en `/gestion/marketing/whatsapp`. La Web-App valida origen, versión y schema, normaliza destinatarios antes del handoff, transfiere imágenes únicamente en memoria, persiste sólo metadatos y snapshots de destinatarios en subcolecciones y rechaza preparar una campaña mientras la extensión no informe `operational: true`.

La extensión 0.9.2 conserva CampaignEngine/ContactEngine, checkpoints durables, prevención de duplicados y prueba de contexto de conversación antes de permitir contenido.
