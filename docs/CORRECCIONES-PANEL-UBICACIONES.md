# Correcciones del panel y Ubicaciones

## Alcance implementado

- El acceso principal ahora dice **Venta Rápida**, usa el icono `Zap` y abre `/gestion/quick-sales`.
- El panel incorpora mes y año, navegación anterior/siguiente y retorno al mes actual.
- Las tarjetas muestran ventas activas, total vendido, ticket promedio y ubicaciones visibles para el período seleccionado.
- El ritmo de ventas contiene exactamente los últimos siete días en hora argentina y completa con cero los días sin operaciones.
- `/gestion/metrics/sales` amplía el análisis por siete días, mes, rango o año y compara meses, ubicaciones, vendedores y formas de pago.
- La actividad reciente combina eventos de auditoría, ventas y movimientos de stock. `/gestion/actividad` agrega filtros y carga progresiva con cursor.
- Las doce tarjetas de módulos usan iconos Lucide semánticos en lugar de números.
- Ubicaciones comienza con **Ubicaciones y eventos**, buscador, filtros y acciones según permisos; ya no muestra métricas ni resúmenes de stock generales.
- `/gestion/locations/{locationId}` contiene, en este orden: Productos, Cargar stock, Vendedores y Descuentos.

## Consultas de Firestore

Las ventas del panel se consultan con:

- `status == "active"`;
- `createdAt >= inicio`;
- `createdAt < fin exclusivo`;
- `locationId in [...]` en grupos de hasta diez cuando el usuario no puede ver todas las ubicaciones;
- `orderBy("createdAt", "desc")`.

La actividad usa `orderBy("createdAt", "desc")`, `limit(pageSize + 1)` y `startAfter(cursor)`. Para usuarios limitados también incorpora `locationId in [...]`. Los filtros de fechas se aplican en Firestore; módulo, usuario y acción refinan cada página acotada.

## Integridad y compatibilidad

- Se reutilizan las colecciones legacy `products`, `locations`, `locationStock`, `sales`, `stockMovements`, `discounts`, `users` y `auditLogs`.
- No se realizó ninguna migración destructiva ni se escribió sobre datos existentes.
- Los productos maestros se unen dinámicamente con el stock local. Una ubicación nueva ya ve todo el catálogo con stock cero sin crear duplicados.
- `stockOperations/{operationId}` hace idempotente una carga múltiple. Stock, movimientos, cabecera y auditoría se confirman en la misma transacción.
- Las ventas rápidas validan los descuentos contra las definiciones reales y contra `enabledDiscountIds` cuando la ubicación ya fue configurada.
- Las asignaciones de vendedores actualizan `assignedSellerIds` y `allowedLocationIds` en una única transacción.
- Las bajas de ubicaciones son lógicas y conservan todo el historial.

## Reglas e índices preparados

Se agregaron índices `locationId + createdAt desc` para `auditLogs` y `stockMovements`. Se reutilizan los índices existentes de ventas por `status`, `locationId` y `createdAt`.

Las reglas nuevas:

- limitan actividad y movimientos a ubicaciones autorizadas;
- separan editar, archivar, restaurar, cargar/ajustar stock y asignar descuentos;
- impiden que un vendedor ajuste stock por fuera de una venta válida de la misma transacción;
- mantienen ventas, movimientos y auditoría como registros no eliminables.

## Validación

- `npm test`: 36 pruebas aprobadas.
- `npm run build`: build Vite aprobado.
- Firebase `--dry-run`: reglas compiladas e índices aceptados para `app-integral-fm`.
- Responsive público: sin scroll horizontal en 1440, 1200, 1024, 768, 480, 390 y 320 px; controles principales de 44 px o más.
- La suite conductual de reglas queda a cargo del workflow de GitHub porque el equipo local no tiene Java para iniciar el emulador.

## Despliegue seguro

1. Revisar el pull request y esperar que GitHub complete tests, emulador de reglas y build.
2. Desplegar reglas e índices únicamente a `app-integral-fm`:
   `firebase deploy --only firestore:rules,firestore:indexes --project app-integral-fm`.
3. Fusionar el pull request para que Netlify publique la aplicación validada.
4. Confirmar panel, actividad, una ubicación de prueba y una venta de prueba con perfiles administrador y vendedor.

No se debe ejecutar ningún comando contra `fm-stock-y-venta`; el sistema anterior continúa independiente.
