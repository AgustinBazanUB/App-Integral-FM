# WhatsApp Inbox + CRM — Redes Sociales

Estado: primera versión funcional en rama `feature/whatsapp-inbox-crm`.

## Principios no negociables

**WhatsApp Web es la fuente principal de los mensajes.**

**Firestore no replica el historial completo de WhatsApp.**

La Web App utiliza WhatsApp como superficie de conversación y el módulo Clientes como fuente de verdad comercial. La extensión Chrome es el puente técnico entre ambas superficies.

## Arquitectura encontrada

### Web App

La aplicación de gestión está construida con React + Vite. La navegación privada se resuelve desde `src/gestion/ManagementApp.jsx`, con módulos definidos en `src/gestion/modules.js` y permisos centralizados en `src/gestion/permissions.js`.

Antes de esta implementación:

- Redes Sociales utilizaba la página genérica del módulo.
- Marketing ya tenía `/gestion/marketing/whatsapp` para campañas masivas.
- Existía `src/gestion/marketing/whatsapp/extensionBridge.js` para campañas y estado de la extensión.
- Clientes ya tenía un dominio y servicios reutilizables; no fue reescrito.

### Clientes / CRM

La identidad real de un cliente se basa en el teléfono normalizado.

`src/gestion/customers/customerDomain.js` contiene:

- `normalizeCustomerPhone`;
- `isValidCustomerPhone`;
- `customerDocumentId`;
- `buildCustomerDraft`;
- `customerZoneLabel`.

`customerDocumentId` genera un ID determinístico a partir del teléfono normalizado. Variantes como `+54 9 11 1234-5678`, `5491112345678` y `11-1234-5678` convergen al mismo teléfono nacional y, por lo tanto, a la misma identidad CRM.

`src/gestion/services/customerService.js` ya provee:

- `findCustomerByPhone`;
- `saveCustomerFromAdmin`;
- `updateCustomerFromAdmin`;
- `listActiveCustomerZones`.

La nueva bandeja reutiliza esas funciones y no crea otra colección de clientes ni otro algoritmo anti-duplicados.

### Zonas

Las zonas configuradas viven en `customerZones`. En el cliente se conservan los campos existentes `zoneId`, `zoneName` y `customZone`.

El Inbox no crea un modelo paralelo de zonas.

### Etiquetas

No se encontró un modelo persistente de etiquetas CRM en Clientes en la rama actual de la Web App. La extensión 0.9.6 sí posee etiquetas/listas de WhatsApp para el flujo de exportación de contactos, pero resolver etiquetas por cada chat obligaría a abrir el hub de Etiquetas de WhatsApp y recorrer listas, una operación visual y costosa que puede interferir con la atención.

Por esta razón:

- el contrato de chat deja `labels: string[]` preparado;
- la ficha puede representar etiquetas compatibles si llegan a estar disponibles;
- no se crea una colección paralela `customerTags`;
- no se escanean las listas de etiquetas en cada apertura de chat;
- asignación/edición de etiquetas desde Inbox queda para una etapa posterior, cuando exista un contrato estable y compartido.

## Nueva ruta

La bandeja se accede desde:

`Redes Sociales → WhatsApp`

Ruta:

`/gestion/social/whatsapp`

Las campañas masivas continúan en:

`/gestion/marketing/whatsapp`

Ambos flujos permanecen separados.

## Componentes principales

### `src/gestion/pages/WhatsAppInboxPage.jsx`

Interfaz comercial con:

- buscador;
- lista de conversaciones;
- contador visual de no leídos por chat;
- filtros `Todos`, `No leídos`, `Sin zona`, `Nuevos contactos`;
- conversación de texto reciente;
- envío de texto;
- estados `Enviando`, `Enviado` y `Error`;
- ficha rápida CRM;
- creación o edición de cliente según permisos;
- edición de zona;
- estado de conexión;
- estados vacíos y errores comprensibles;
- navegación responsive.

### `src/gestion/social/whatsapp/inboxBridge.js`

Cliente de comunicación del Inbox. Utiliza un canal dedicado:

`flor_mia_whatsapp_inbox_extension`

No reutiliza el canal de comandos de campañas.

Comandos permitidos:

- `FLORMIA_INBOX_GET_CHATS_REQUEST`;
- `FLORMIA_INBOX_GET_MESSAGES_REQUEST`;
- `FLORMIA_INBOX_SEND_TEXT_REQUEST`.

Respuestas:

- `FLORMIA_INBOX_CHATS`;
- `FLORMIA_INBOX_MESSAGES`;
- `FLORMIA_INBOX_TEXT_SENT`;
- `FLORMIA_INBOX_ERROR`.

El bridge valida canal, versión, `requestId`, `replyTo`, tipo de respuesta y payload básico. `SEND_TEXT` está limitado a 4.096 caracteres.

## Flujo Web App ↔ extensión ↔ WhatsApp

```text
Redes Sociales → WhatsApp
        ↓
inboxBridge.js
        ↓ window.postMessage, mismo origen
content/inbox-web-app-bridge.ts
        ↓ chrome.runtime.sendMessage
background/inbox-service-worker.ts
        ↓ chrome.tabs.sendMessage
content/inbox-runtime.ts
        ↓
WhatsAppAdapter / inbox-adapter.ts
        ↓
WhatsApp Web
```

La extensión valida el origen real de la Web App antes de aceptar comandos.

## WhatsApp Adapter

La capa DOM está encapsulada en la extensión, no en esta Web App.

La Web App no conoce:

- selectores CSS de WhatsApp;
- `data-testid`;
- estructura interna del panel de chats;
- clases de burbujas;
- estructura del composer.

Si WhatsApp cambia, el primer lugar a revisar debe ser `src/whatsapp/inbox-adapter.ts` de la extensión.

## Lectura de chats

La pantalla solicita hasta 80 chats visibles por defecto. La extensión limita el contrato a un máximo de 100.

No se ejecuta polling periódico. La actualización sucede:

- al entrar a la pantalla;
- al pulsar `Actualizar`;
- al abrir o enviar dentro de una conversación cuando corresponde refrescar el bloque reciente.

El Inbox no crea listeners Firestore para mensajes.

## Mensajes recientes

Al abrir un chat se solicitan hasta 50 mensajes de texto visibles. El contrato acepta como máximo 100.

Si el DOM contiene más mensajes, la respuesta marca `hasMore` para dejar preparada una futura estrategia incremental.

No se importan en esta etapa:

- imágenes;
- audio;
- documentos;
- stickers;
- reacciones;
- llamadas.

No se guardan mensajes en Firestore.

## Envío de texto

Flujo:

1. la Web App valida que exista texto;
2. envía `SEND_TEXT` al bridge del Inbox;
3. la extensión abre la conversación seleccionada;
4. el adapter reutiliza el composer y selector de envío centralizados;
5. observa un mensaje saliente con el texto esperado;
6. devuelve `sent` y `verified`;
7. la Web App refresca el bloque reciente.

La interfaz distingue `Enviando`, `Enviado` y `Error`.

Si WhatsApp consume el composer pero no expone una evidencia visual fuerte, puede devolver `verified: false` sin fingir una confirmación inexistente.

## Integración CRM

### Lookup

Para cada teléfono verificable:

```text
WhatsApp phone
→ normalizeCustomerPhone
→ findCustomerByPhone
→ customerDocumentId determinístico
→ getDoc del cliente concreto
```

La pantalla mantiene una caché local por teléfono normalizado durante la sesión del Inbox para evitar lecturas repetidas del mismo cliente.

No se realiza una consulta completa de `customers` por cada chat.

### Cliente existente

Si existe:

- se muestra `Cliente registrado`;
- se visualiza nombre, teléfono y zona;
- el usuario con permiso puede actualizar nombre/zona;
- el guardado utiliza `updateCustomerFromAdmin`.

### Nuevo contacto

Si no existe:

- se muestra `Nuevo contacto`;
- no se crea automáticamente;
- el teléfono y nombre disponible quedan precompletados;
- el usuario debe elegir zona según las reglas reales de Clientes;
- el guardado utiliza `saveCustomerFromAdmin`.

Spam, proveedores o consultas irrelevantes no ingresan automáticamente al CRM.

## Anti-duplicados

No existe un alta especial para WhatsApp.

`saveCustomerFromAdmin` conserva la misma validación que Clientes. El teléfono se normaliza y el documento final se identifica de forma determinística. Si el cliente ya existe, la operación debe relacionarse con ese cliente en lugar de crear una identidad paralela.

## Filtro Sin zona

El filtro se resuelve en memoria a partir de los clientes ya relacionados con los chats visibles.

Un chat entra en `Sin zona` cuando:

- tiene teléfono verificable;
- el teléfono corresponde a un cliente existente;
- `customerZoneLabel(customer)` no devuelve una zona válida.

No se agregó una consulta Firestore nueva para este filtro.

## Firestore

Esta etapa no agrega colecciones ni campos de mensajes.

Lecturas nuevas:

- un `getDoc` por teléfono CRM único que todavía no esté cacheado en la sesión;
- catálogo activo de `customerZones`, reutilizando la caché del servicio existente.

Escrituras:

- únicamente cuando el usuario crea o edita explícitamente un cliente;
- pasan por los servicios actuales de Clientes y su auditoría.

No hay:

- una escritura por mensaje;
- colección `whatsappMessages`;
- historial duplicado;
- listener global nuevo;
- polling Firestore.

## Permisos

El acceso a `/gestion/social/whatsapp` usa los permisos reales del módulo `social`.

Los controles CRM respetan por separado:

- `loyal-customers.view`;
- `loyal-customers.edit`;
- `loyal-customers.create`.

Un perfil con permiso de atención pero sin permiso de edición de Clientes no obtiene privilegios nuevos por entrar al Inbox.

## Responsive

Desktop principal:

1. lista de chats;
2. conversación;
3. ficha CRM.

A resoluciones intermedias la ficha puede pasar debajo. En móvil la UI cambia a navegación:

`Chats → Conversación → Cliente`.

No se fuerzan tres columnas diminutas.

## Estados de conexión

La pantalla diferencia de forma explícita:

- extensión no disponible;
- bridge de Inbox desactualizado/no disponible;
- WhatsApp Web cerrado;
- sesión de WhatsApp pendiente;
- error de lectura;
- lista vacía;
- conversación no seleccionada;
- error al cargar mensajes;
- error al enviar.

El Inbox no representa un problema técnico como `0 conversaciones`.

## Seguridad y privacidad

- canal externo dedicado y limitado;
- origen del content script validado por la extensión;
- sólo tres comandos de Inbox;
- límites de tamaño para IDs, listas y texto;
- no se acepta código o acción arbitraria;
- no se usa `eval`;
- mensajes se renderizan como texto React, no como HTML inyectado;
- no se registra el contenido de conversaciones en logs de producción;
- no se persisten mensajes en Firebase.

## Limitaciones actuales

1. WhatsApp Web es externo y puede cambiar su DOM.
2. Un contacto guardado puede mostrar nombre sin exponer su teléfono en la fila/encabezado. En ese caso se permite conversar, pero no se fuerza una relación CRM falsa.
3. El contador de no leídos depende de la semántica visible que WhatsApp expone.
4. Abrir un chat en WhatsApp normalmente lo marca como leído; la Web App refleja ese cambio local después de abrirlo.
5. Sólo se trabaja con el bloque de mensajes de texto que WhatsApp tenga cargado en el DOM.
6. Las etiquetas por chat no se escanean automáticamente porque el adapter 0.9.6 requiere abrir y recorrer el hub de etiquetas; hacerlo por cada conversación sería costoso y podría interferir con la exportación de contactos.
7. No se implementa IA de zona en esta etapa.
8. No se implementan estados comerciales `Pendiente/Respondido/Cerrado` todavía.

## Troubleshooting

### “Extensión no detectada”

- confirmar que Flor Mía WhatsApp Sender esté habilitada;
- usar un dominio autorizado;
- recargar la Web App.

### “El puente de WhatsApp Inbox no respondió”

- actualizar la extensión a la versión que contiene Inbox (rama actual: 0.9.6.1);
- recargar la extensión desde Chrome si se usa unpacked;
- recargar Web App y WhatsApp Web.

### “WhatsApp Web está cerrado”

Abrir `web.whatsapp.com` en una pestaña de la misma sesión de Chrome.

### “WhatsApp necesita iniciar sesión”

Completar QR/inicio de sesión en WhatsApp Web y reintentar.

### “Teléfono no expuesto por WhatsApp”

No se crea un cliente automáticamente. La conversación sigue disponible, pero el vínculo CRM queda pendiente hasta contar con un teléfono verificable.

## Archivos agregados/modificados en Web App

- `src/gestion/pages/WhatsAppInboxPage.jsx`;
- `src/gestion/social/whatsapp/inboxBridge.js`;
- `src/styles/whatsapp-inbox.css`;
- `src/gestion/ManagementApp.jsx`;
- `src/gestion/routePreload.js`;
- `src/gestion/pages/GenericModulePage.jsx`;
- `src/gestion/components/icons.jsx`;
- `src/main.jsx`;
- `tests/whatsapp-inbox-light.test.mjs`;
- `docs/whatsapp-inbox-crm.md`.

## Pendientes recomendados

- estrategia estable de etiquetas CRM/WhatsApp por contacto sin escanear el hub en cada chat;
- paginación/incremental de historial;
- clasificación comercial `Pendiente/Respondido/Cerrado`;
- sugerencia de zona por IA con confirmación manual;
- multimedia;
- pruebas manuales con múltiples variantes reales de WhatsApp Web;
- checklist exhaustiva y edge cases en la etapa de QA pesada.
