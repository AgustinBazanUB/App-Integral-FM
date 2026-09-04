# FM-MOD-10-WA — Marketing / WhatsApp

## Estado

- Código: especializado y avanzado.
- Entry point: `/gestion/marketing/whatsapp`.
- UI: `src/gestion/pages/WhatsAppCampaignsPage.jsx`.
- Dominio: `src/gestion/marketing/whatsapp/campaignDomain.js`.
- Servicio: `src/gestion/marketing/whatsapp/campaignService.js`.
- Bridge: `src/gestion/marketing/whatsapp/extensionBridge.js`.
- Contrato: `docs/whatsapp-extension-contract.md`.

## Rol dentro de FM

Marketing/WhatsApp prepara campañas masivas con destinatarios explícitos y controla su estado.

No ejecuta directamente selectores o automatización DOM de WhatsApp Web.

## Flujo de producto actual

Wizard principal:

1. Información.
2. Destinatarios.
3. Mensaje.
4. Imágenes.
5. Revisión.

Destinatarios pueden provenir de:

- Clientes Flor Mía;
- Excel autorizado/importado.

La selección normaliza y deduplica teléfonos antes de preparar una campaña.

## Integración con extensión

`FM Web App -> extensionBridge -> Flor-Mia-WhatsApp-Sender -> WhatsApp Web`

La extensión devuelve estado/progreso y la Web App reconcilia los eventos con su campaña.

## Relación futura con zonas

El selector de destinatarios podrá beneficiarse del modelo geográfico definido en Clientes:

`barrio seleccionado -> sugerencia de barrios cercanos`

Ejemplo de uso:

una feria en Belgrano puede partir de clientes de Belgrano y sugerir ampliar a barrios cercanos.

La sugerencia no debe seleccionar ni enviar automáticamente sin que el usuario pueda revisar la audiencia.

## Relación con CRM

La campaña utiliza la base central de Clientes.

No crear una base paralela de contactos permanentes dentro de Marketing.

## Diferencia respecto de WhatsApp Inbox

- **Marketing/WhatsApp:** campañas salientes masivas preparadas explícitamente.
- **Redes/WhatsApp Inbox:** atención de conversaciones pendientes y contexto CRM.

Pueden compartir integración técnica y entidades, pero tienen objetivos de producto distintos.

## Extensión

La extensión privada es otro sistema/repo y debe permanecer representada como frontera separada en el Master Map.

Capas principales auditadas:

- `src/background/`;
- `src/campaign/`;
- `src/engine/`;
- `src/content/`;
- `src/whatsapp/`;
- `src/storage/`;
- `src/compatibility/`;
- `src/diagnostics/`;
- `src/popup/`.

## No objetivo

No trasladar la lógica DOM de WhatsApp Web al repositorio principal.