
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

## Mensajes

Web → extensión:
- `FLORMIA_EXTENSION_PING`
- `FLORMIA_CAMPAIGN_PREPARE`
- `FLORMIA_CAMPAIGN_CANCEL_REQUEST`

Extensión → Web:
- `FLORMIA_EXTENSION_STATUS`
- `FLORMIA_CAMPAIGN_ACCEPTED`
- `FLORMIA_CAMPAIGN_PROGRESS`
- `FLORMIA_CAMPAIGN_PAUSED`
- `FLORMIA_CAMPAIGN_COMPLETED`
- `FLORMIA_CAMPAIGN_ERROR`
- `FLORMIA_CAMPAIGN_CANCELLED`

## Estado de extensión

`FLORMIA_EXTENSION_STATUS.payload`:

```js
{
  operational: true | false,
  message: "texto comprensible",
  extensionVersion: "opcional",
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
  images: [{ order, name, type, size, data: ArrayBuffer }],
  totalRecipients
}
```

El `ArrayBuffer` es temporal y se transfiere únicamente en memoria. Firestore conserva sólo metadatos de imágenes. El orden lógico definido por la Web-App es Imagen 1 → Imagen 2 → Imagen 3 → Texto. La extensión debe garantizar el orden técnico real.

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
