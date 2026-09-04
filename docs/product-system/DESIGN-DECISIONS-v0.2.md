# Decisiones de diseño aprobadas — v0.2

Fecha: 2026-09-03.

Este documento registra decisiones de producto tomadas durante la conversación de diseño. No implica que estén implementadas.

## FM-MOD-01 — Ubicaciones

### Jerarquía de acciones

- Cada tarjeta de ubicación debe priorizar las acciones operativas frecuentes.
- `Cargar stock` debe ser una acción visible y rápida.
- `Abrir ubicación` puede permanecer visible como acceso principal.
- Las acciones administrativas y poco frecuentes deben moverse a un menú de tres puntos (`•••`).

El menú de tres puntos representa configuración propia de la ubicación y puede incluir:

- editar;
- fijar / desfijar;
- pausar / activar;
- dar de baja;
- auditoría u otras acciones administrativas futuras.

### Organización visual

- El panel operativo debe priorizar ubicaciones activas y próximas.
- Las ubicaciones inactivas no deben mezclarse continuamente con las activas.
- Debe existir una sección o acceso `Ubicaciones inactivas`.
- Dentro de esa sección debe existir buscador.
- El listado de inactivas debe estar ordenado alfabéticamente.
- Una ubicación inactiva puede reactivarse y volver al panel operativo.

## FM-MOD-03 — Venta Rápida

### Experiencia base

La Venta Rápida debe sentirse coherente con el Panel Vendedor:

- catálogo de productos disponibles desde el primer paso;
- selección rápida de productos/cantidades;
- descuentos;
- forma de pago;
- cliente;
- confirmación.

### Origen de stock obligatorio

Toda Venta Rápida debe registrar de dónde sale físicamente la mercadería.

El origen puede ser:

- una ubicación de venta;
- un depósito.

Ejemplo: una venta personal puede descontar stock desde `Depósito · Mi casa`.

La venta sigue siendo una venta normal para métricas. No se crea un universo paralelo de “ventas externas”. Debe poder filtrarse posteriormente por origen o tipo de origen.

### Cliente en Venta Rápida

- El teléfono se utiliza para buscar al cliente.
- Si existe, no se crea otro registro.
- La UI debe indicar `Cliente encontrado` y permitir seleccionarlo con una acción mínima.
- Nombre y zona se muestran automáticamente.
- Si no existe, puede crearse rápidamente.
- La venta debe quedar vinculada al cliente para alimentar su historial.

## Panel Vendedor — cliente

El selector de cliente del Panel Vendedor debe reutilizar exactamente la misma lógica de resolución por teléfono de Venta Rápida.

No deben existir dos comportamientos distintos para identificar un cliente según desde dónde se realiza la venta.

## FM-MOD-04 — Clientes

### Identidad

- El teléfono es el identificador operativo principal.
- La base debe evitar duplicados por número normalizado.
- Las ventas vinculadas alimentan el historial del cliente.

### Contexto comercial

El detalle del cliente debe evolucionar para mostrar información de consumo, por ejemplo:

- últimas compras;
- productos comprados;
- productos frecuentes;
- cantidad o volumen estimado en un período;
- última compra;
- ritmo aproximado de recompra.

El objetivo futuro es poder detectar oportunidades de recompra y alimentar herramientas de Marketing/WhatsApp.

### Zonas

No se crearán subzonas comerciales tipo `Tribunales` o `Microcentro` dentro de un barrio.

Estructura deseada:

`Zona geográfica -> barrio`

Ejemplo:

`CABA -> San Nicolás`

Cada barrio debe poder tener relaciones reutilizables con `barrios cercanos`.

Esto permitirá que Marketing pueda seleccionar un barrio objetivo y sugerir barrios adyacentes/cercanos para ampliar una campaña local, una feria o un evento.

La relación de cercanía debe diseñarse como dato reutilizable por otras partes de FM, no como una regla exclusiva de WhatsApp.

## FM-MOD-07 — Depósitos

### Rol del depósito

Un depósito es almacenamiento y movimiento de inventario, no un punto de venta.

Acciones núcleo:

1. `Ingresar stock`.
2. `Transferir stock`.

### Transferencia

La transferencia debe registrar:

- origen;
- destino;
- producto(s);
- cantidad(es);
- observación opcional;
- usuario y fecha para auditoría.

El destino normalmente será una ubicación de venta, aunque la arquitectura puede admitir otros inventarios válidos.

### Stock negativo con advertencia

Si el stock registrado del origen no alcanza, la operación no debe bloquearse necesariamente.

Puede permitirse continuar con una advertencia explícita cuando el usuario confirma que físicamente la mercadería existe aunque el sistema esté desactualizado.

Ejemplo:

- stock registrado: 18;
- transferencia: 20;
- nuevo stock lógico: -2.

La UI debe advertir que el origen quedará negativo y generar una condición visible de revisión de inventario.

La decisión no elimina auditoría: el movimiento debe quedar registrado.

## FM-MOD-09 — Redes Sociales / WhatsApp Inbox

### Alcance

La sección WhatsApp dentro de Redes Sociales no busca replicar WhatsApp completo.

Debe funcionar como un **Inbox operativo de mensajes pendientes**, especialmente:

- mensajes no leídos;
- conversaciones que requieren respuesta;
- consultas comerciales;
- posibles oportunidades.

### Priorización

Primera etapa: reglas simples y económicas, sin depender de IA.

Ejemplos de señales:

- mensaje no leído;
- palabras o patrones comerciales;
- consulta de precio;
- consulta de producto;
- consulta de envío;
- intención de compra.

La IA puede agregarse posteriormente si aporta valor suficiente y su costo es razonable.

### CRM contextual

Cada conversación debe intentar resolver el contacto por teléfono contra la base de Clientes.

Si el cliente existe, mostrar contexto sin salir del Inbox:

- nombre;
- zona;
- última compra;
- productos recientes;
- productos frecuentes;
- otros datos comerciales útiles disponibles.

Si el contacto no existe:

- mostrar `No registrado`;
- permitir `Crear cliente` rápidamente.

### Edición inline de cliente

Desde el mismo Inbox se deben poder editar datos básicos del cliente sin navegar al módulo Clientes.

Como mínimo:

- nombre;
- zona.

Los cambios deben actualizar la misma base central de Clientes.

## Principio transversal

Clientes, ventas, Panel Vendedor, Marketing y Redes Sociales deben compartir una única identidad de cliente y componentes/lógica reutilizables. No deben existir copias paralelas de CRM por módulo.