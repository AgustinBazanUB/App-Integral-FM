# FM-MOD-04 — Clientes CRM

## Estado

- Código: especializado.
- Entry point: `/gestion/loyal-customers`.
- UI actual: `src/gestion/pages/LoyalCustomersPage.jsx`.
- Dominio: `src/gestion/customers/customerDomain.js`.
- Servicio: `src/gestion/services/customerService.js`.
- Diseño objetivo: **PROPUESTO v0.2**.

## Identidad

El teléfono normalizado es el identificador operativo principal del cliente.

Principios:

- no duplicar el mismo cliente por variaciones de formato del teléfono;
- la creación y la edición son operaciones distintas;
- una venta debe enlazar al cliente existente cuando pueda resolverlo;
- Venta Rápida, Panel Vendedor, Marketing e Inbox deben reutilizar esta identidad.

## Resolución rápida por teléfono

`FM-MOD-04-CLIENT-MATCH`

Flujo:

`ingresar teléfono -> normalizar -> buscar -> existente / nuevo`

Existente:

- mostrar nombre;
- zona;
- confirmación rápida de selección.

Nuevo:

- permitir alta con pocos campos;
- conservar validación de unicidad.

## CRM de consumo

El detalle del cliente debe evolucionar desde una ficha de contacto a una ficha comercial.

Información objetivo cuando exista evidencia suficiente:

- última compra;
- compras recientes;
- productos comprados;
- productos frecuentes;
- volumen/cantidad en período;
- frecuencia aproximada;
- ritmo estimado de recompra.

Estos indicadores no deben inventarse: se calculan a partir de ventas vinculadas al cliente.

## Uso futuro

El historial podrá alimentar herramientas de seguimiento como:

- detectar que una recompra habitual está atrasada;
- sugerir una oportunidad comercial;
- dar contexto al responder WhatsApp;
- segmentar campañas por comportamiento.

La automatización de mensajes no forma parte del diseño detallado de esta ficha todavía.

## Zonas

### Estructura v0.2

No usar subzonas internas como `Tribunales` o `Microcentro`.

Modelo conceptual:

`jurisdicción -> barrio`

Ejemplo:

`CABA -> San Nicolás`

### Barrios cercanos

Un barrio puede relacionarse con otros barrios considerados cercanos/adyacentes.

La relación debe ser reutilizable por cualquier módulo.

Ejemplo de uso:

`Marketing -> seleccionar Belgrano -> sugerir barrios cercanos`

No se define todavía el algoritmo exacto (adyacencia manual, coordenadas, distancia o híbrido); eso se resolverá al diseñar el sistema geográfico en profundidad.

## Relaciones

- Venta Rápida.
- Panel Vendedor.
- Métricas e historial.
- Redes Sociales / WhatsApp Inbox.
- Marketing / WhatsApp.
- Envíos en etapas futuras.

## No objetivo

No crear bases de clientes separadas por módulo.