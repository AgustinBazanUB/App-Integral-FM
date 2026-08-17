# Contrato Flor Mía Web-App ↔ Extensión WhatsApp

## Alcance

La Web-App prepara campañas. La extensión privada ejecuta técnicamente WhatsApp Web. La Web-App no conoce selectores DOM, tiempos, tandas, reintentos, cookies, QR, credenciales ni tokens de WhatsApp.

## Transporte

- Canal: `flor_mia_whatsapp_extension`.
- `protocolVersion`: `1`.
- La Web-App usa `window.postMessage()` con `targetOrigin = window.location.origin`.
- El content script debe escuchar únicamente la página autorizada, validar `event.source`, `event.origin`, `channel`, `protocolVersion`, `type` y schema.
- Las respuestas deben usar `replyTo` con el `requestId` recibido cuando respondan a una solicitud puntual.
- Los eventos de campaña deben incluir `campaignId` y un `sequence` entero monótonamente creciente.

### Ventanas de respuesta de la Web-App

La Web-App usa ventanas diferentes según el tipo de operación para evitar falsos timeouts mientras la extensión realiza trabajo real:

- `PING`: 5 segundos.
- `PREPARE`: 30 segundos.
- `PREFLIGHT`: 35 segundos.
- `START / PAUSE / RESUME / STOP`: 35 segundos.

Estos timeouts son límites de espera de la Web-App; no sustituyen los timeouts técnicos internos ni las comprobaciones de seguridad de la extensión.

Si la extensión se recarga o actualiza mientras el Deploy Preview permanece abierto, el content script anterior pierde su contexto de extensión. La pestaña debe recargarse para inyectar el bridge de la versión nueva. La extensión responde este caso como `EXTENSION_CONTEXT_INVALIDATED` y no debe intentar usar nuevamente `chrome.runtime` desde ese contexto viejo.

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
  extensionVersion: "0.9.1.2",
  configuredLimit: 1000,
  sentToday: 427,
  availableToday: 573,
  errorCode: "opcional"
}
```

La Web-App sólo interpreta dos estados principales: Operativa o Error / requiere revisión. El límite diario es autoridad exclusiva de la extensión.

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

El orden lógico definido por la Web-App es Imagen 1 → Imagen 2 → Imagen 3 → Texto. La extensión debe garantizar el orden técnico real.

## Progreso

Los eventos de progreso deben incluir:

```js
{
  channel: "flor_mia_whatsapp_extension",
  protocolVersion: 1,
  type: "FLORMIA_CAMPAIGN_PROGRESS",
  campaignId: "...",
  sequence: 12,
  payload: { sentCount: 240, errorCount: 3 }
}
```

La extensión debe incrementar `sequence`. La Web-App ignora secuencias antiguas y nunca permite que `sentCount` supere `totalRecipients`.

## Datos prohibidos

No enviar ni almacenar en Flor Mía: cookies, tokens, contraseñas, QR, localStorage de WhatsApp, selectores internos, configuraciones de timing/tandas/reintentos ni binarios persistentes de las imágenes.

## Frecuencia de progreso

La extensión puede informar progreso tantas veces como sea útil, siempre con `sequence` creciente. La Web-App actualiza los contadores del documento principal, pero sólo crea un evento/auditoría cuando cambia el estado operativo (inicio/reanudación, pausa, finalización, error o cancelación), evitando ruido y escrituras innecesarias.

## Estado de implementación de la Web-App

El lado Flor Mía de este contrato está implementado en la ruta `/gestion/marketing/whatsapp`. La versión web valida el origen, versión y schema de los mensajes, transfiere imágenes únicamente en memoria, persiste sólo metadatos y snapshots de destinatarios en subcolecciones, y rechaza preparar una campaña mientras la extensión no informe estado `operational: true`.
