# FM-MOD-09-WA — Redes Sociales / WhatsApp Inbox

## Estado

- Módulo Redes Sociales en `main`: base genérica.
- Existen ramas/PRs recientes con trabajo específico de WhatsApp Inbox + CRM.
- Diseño objetivo de producto: **PROPUESTO v0.2**.

## Objetivo

Crear una bandeja operativa para que la persona encargada de redes pueda detectar y responder conversaciones que necesitan atención comercial.

No se busca replicar WhatsApp completo dentro de FM.

## Contenido prioritario

Primera etapa:

- mensajes no leídos;
- conversaciones pendientes de respuesta;
- consultas de precio;
- consultas de producto;
- consultas de envío;
- señales simples de intención de compra.

## Priorización

La primera implementación debe favorecer reglas deterministas y de bajo costo.

La IA es opcional y posterior. Solo debería incorporarse si mejora materialmente la clasificación y con costos/privacidad controlados.

## Identidad CRM

`mensaje/contacto -> teléfono -> cliente`

### Cliente existente

Mostrar dentro del mismo workspace:

- nombre;
- zona;
- última compra;
- productos recientes;
- productos frecuentes;
- otro contexto comercial disponible y pertinente.

### Contacto nuevo

Mostrar claramente `No registrado` y ofrecer `Crear cliente`.

La creación debe usar la base y reglas del módulo Clientes.

## Edición inline

El usuario debe poder editar datos básicos del cliente sin abandonar la conversación.

Mínimo objetivo:

- nombre;
- zona/barrio.

Los cambios deben persistir en el CRM central.

## Experiencia conceptual

Layout recomendado:

- columna izquierda: conversaciones pendientes;
- área principal: conversación/contexto de respuesta;
- panel lateral o bloque contextual: ficha resumida del cliente;
- acción `Crear cliente` o `Editar cliente` según estado.

## Relaciones

- Clientes: identidad y datos CRM.
- Ventas: historial comercial.
- Marketing: segmentación y campañas futuras.
- Extensión WhatsApp: integración técnica según la arquitectura que se defina para Inbox; no asumir que el protocolo de campañas cubre automáticamente todas las necesidades de Inbox.

## Privacidad y performance

El diseño técnico posterior deberá evitar:

- duplicar conversaciones completas en Firestore sin necesidad;
- almacenar contenido de WhatsApp indefinidamente sin propósito;
- polling agresivo;
- exponer datos privados en diagnósticos.

## No objetivo

No construir una copia de todas las funciones de WhatsApp Web.