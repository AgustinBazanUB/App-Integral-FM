# FM-MOD-01 — Ubicaciones

## Estado

- Código: especializado.
- Diseño actual: existe.
- Diseño objetivo: **PROPUESTO v0.2**.
- Entry point actual: `/gestion/locations`.
- UI actual: `src/gestion/pages/LocationsPage.jsx`.

## Objetivo del módulo

Representar puntos de operación de Flor Mía donde se puede vender, asignar vendedores y mantener inventario local.

## Problema de UX detectado

La tarjeta actual expone varias acciones operativas y administrativas al mismo nivel. Esto dificulta priorizar la acción diaria más frecuente: cargar stock / abrir el punto de operación.

## Diseño objetivo v0.2

### Panel principal

Mostrar prioritariamente:

- ubicaciones activas;
- ubicaciones próximas/programadas que sea útil preparar;
- ubicaciones fijadas cuando aplique.

No mezclar permanentemente ubicaciones inactivas/finalizadas con las operativas.

### Tarjeta

Acciones visibles:

- `Abrir ubicación`;
- `Cargar stock`.

Menú `•••` para configuración secundaria:

- Editar.
- Fijar / desfijar.
- Pausar / activar.
- Dar de baja.
- Auditoría / historial cuando corresponda.

### Inactivas

Debe existir un acceso `Ubicaciones inactivas`.

Al abrir:

- buscador por nombre;
- listado ordenado alfabéticamente;
- estado visible;
- acción de reactivación cuando esté permitida.

## Relaciones

- Productos: inventario referencia catálogo maestro.
- Ventas: una ubicación puede ser origen de stock.
- Panel Vendedor: opera sobre ubicación asignada/seleccionada.
- Métricas: ventas y actividad pueden filtrarse por ubicación.
- Depósitos: reciben/envían stock mediante transferencias.

## No objetivo

No convertir Depósitos en una variante visual de Ubicaciones con las mismas responsabilidades. Ambos comparten conceptos de inventario, pero el depósito no es punto de venta.

## Pendiente de implementación

- reorganizar acciones de card;
- separar inactivas del listado operativo;
- revisar fijadas/próximas y orden de presentación;
- mantener permisos existentes;
- no modificar el modelo de datos solo por este cambio visual.