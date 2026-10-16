# Integraciones del FM Product System

## 1. Web App ↔ Firebase / Firestore

Responsabilidades de la Web App:

- autenticar y aplicar permisos de UI;
- consultar datos acotados según módulo;
- ejecutar servicios de dominio existentes;
- mantener operaciones sensibles transaccionales cuando corresponda;
- no duplicar colecciones únicamente para facilitar una pantalla.

El mapa detallado de colecciones sigue pendiente de una etapa específica de Data Architecture.

## 2. Web App ↔ Chrome Extension ↔ WhatsApp Web

Repositorio Web App:

`AgustinBazanUB/App-Integral-FM`

Repositorio extensión:

`AgustinBazanUB/Flor-Mia-WhatsApp-Sender`

Flujo conceptual:

`WhatsAppCampaignsPage -> campaignService -> extensionBridge -> web-app-bridge -> Service Worker -> CampaignEngine -> ContactEngine -> WhatsApp Web`

Retorno:

`WhatsApp Web -> extensión -> evento/snapshot saneado -> Web App -> reconciliación -> UI / persistencia autorizada`

Principio de separación:

- La Web App conoce campaña, destinatarios, contenido, estado y UX.
- La Web App no debe conocer selectores DOM ni la mecánica interna de WhatsApp Web.
- La extensión no es el CRM ni la fuente de verdad de Clientes.
- La extensión ejecuta la capa técnica y devuelve resultados identificables/saneados.

## 3. CRM ↔ Ventas

Tanto Venta Rápida como Panel Vendedor deben utilizar una única resolución de cliente por teléfono.

`teléfono normalizado -> cliente existente / alta nueva -> sale.clientId -> historial del cliente`

El objetivo es que una compra hecha desde cualquier superficie alimente la misma identidad.

## 4. CRM ↔ WhatsApp Inbox

`mensaje/contacto -> teléfono -> lookup CRM -> contexto comercial`

El Inbox puede:

- mostrar cliente existente;
- mostrar consumo e historial disponible;
- crear un cliente si todavía no existe;
- editar datos básicos como nombre/zona;
- responder sin obligar a navegar al módulo Clientes.

Los cambios de CRM realizados desde el Inbox deben usar el mismo servicio/base de Clientes, no una colección propia del Inbox.

## 5. Zonas ↔ Marketing

Modelo objetivo:

`jurisdicción -> barrio -> barrios cercanos`

Ejemplo:

`CABA -> Belgrano -> [barrios cercanos]`

Marketing puede usar esa relación para sugerir ampliación de segmentación geográfica.

No se diseñan subzonas internas tipo `Tribunales`/`Microcentro` para esta etapa.

## 6. Productos ↔ Inventario

`Producto maestro -> inventario por Ubicación / Depósito`

Producto representa identidad comercial global.

Inventario representa cantidad/estado dentro de un contenedor físico.

En ubicaciones de venta puede existir configuración comercial local como precio efectivo. En depósitos no existe precio de venta como responsabilidad del depósito.

## 7. Depósitos ↔ Ubicaciones

`Depósito origen -> transferencia -> Ubicación destino`

Una transferencia registra movimiento de salida e ingreso correspondiente.

La propuesta v0.2 permite, con confirmación explícita, que una transferencia deje el origen negativo cuando el usuario declara que el stock físico existe pero el registro está desactualizado. Ese estado debe disparar una revisión visible y auditable.

## 8. Venta Rápida ↔ Inventario

Toda Venta Rápida debe declarar origen de stock.

Origen permitido en diseño v0.2:

- ubicación;
- depósito.

La venta se incorpora a las métricas generales. El origen es una dimensión para análisis, no un sistema de ventas separado.

## 9. Meta Ads ↔ IA / Drive / Meta

Estado del mapa:

- planificación interna: existente/en evolución;
- IA de estrategia/creatividad: integrada por etapas;
- Google Drive / assets: etapa existente en ramas de trabajo, con cierre operativo dependiente de configuración real;
- validación/producción/render: roadmap;
- Meta Marketing API: roadmap;
- resultados y aprendizaje: roadmap.

Cada integración futura debe conservar la separación entre datos internos de CampaignProject y objetos externos reales de proveedores.