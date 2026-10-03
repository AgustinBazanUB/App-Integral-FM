# Migración del sistema anterior — 3 de octubre de 2026

## Auditoría y alcance

Origen leído: `AgustinBazanUB/FM-stock-y-ventas`, revisión `8113ebd831032340b21848c8c3f5e617e831b30b`, Firestore `fm-stock-y-venta`. Destino: `app-integral-fm`, aplicación publicada en `appintegralflormia.netlify.app`. Los datos comerciales están en Firestore; Git contiene el código y las fotografías.

El destino ya tenía una copia parcial: 1.329 ventas coincidentes, 13 ventas propias y una conciliación de stock del 23/09. Faltaban 1.309 ventas, movimientos históricos y una ubicación archivada. Las rutas de fotos antiguas estaban guardadas en productos, pero sus archivos no estaban incluidos en la aplicación.

El catálogo del origen contiene 55 productos, 11 categorías y 24 ubicaciones, incluidas las inactivas y archivadas. Se respetó el alias de Vino BAZAN creado en la migración anterior para evitar sobrescribir el Malbec del sistema nuevo. `DEPO SAN MARTIN` conserva su reclasificación como depósito: su inventario se actualiza en `warehouseStock`, sin reactivar la ubicación archivada. La ubicación histórica ausente, `DEPOSITO LOCAL`, se incorporó con su estado archivado original.

## Baja de las 13 ventas propias

El propietario solicitó quitar las 13 ventas del sistema nuevo durante la migración. La selección quedó fijada por IDs en un archivo privado; no se extendió a ventas originales ni a ventas futuras.

Se aplicó una baja lógica mediante máscara de campos: `deleted`, `deletedAt`, `deletedBy`, `deletedByName`, `deletionReason`, `cleanupOperationId`. Se conservan importes, productos, estados originales, fechas y referencias fiscales para auditoría. Una venta tiene un comprobante ARCA autorizado: no se borró ni modificó el comprobante, ni se realizó una anulación fiscal.

Sólo se devolvieron las 7 unidades cuyo descuento seguía vigente después del snapshot anterior, en 4 saldos. Las ventas anuladas no se devolvieron otra vez; tampoco se repusieron los descuentos anteriores ya reemplazados por el snapshot del 23/09. Baja, auditoría y movimientos compensatorios se confirmaron en un único commit atómico de 37 escrituras, con precondiciones de versión. No se registró un reembolso financiero.

Los lectores habituales de Panel General, Métricas, Finanzas, ubicación, vendedor y CRM omiten `deleted:true`, conservando las anulaciones comerciales normales. Los cursores paginados avanzan sobre los documentos originales aunque una página sólo contenga ventas archivadas. Actividad y los comprobantes mantienen el vínculo histórico.

## Importación aplicada

| Elemento | Resultado |
| --- | --- |
| Ventas nuevas importadas | 1.309 |
| Ventas visibles finales | 2.638: 2.572 activas y 66 anuladas |
| Importe de las ventas activas | $109.300.400, igual al snapshot del origen |
| Ventas propias archivadas | 13, conservadas para auditoría |
| Referencias de producto corregidas | 15 ventas coincidentes, sin cambiar importes ni fechas |
| Movimientos históricos incorporados | 2.658, sin ejecutar descuentos de stock nuevamente |
| Contadores | 73 incorporados; 3 avanzados; ninguno retrocedió |
| Descuentos | 5 incorporados; 1 actualizado desde el origen |
| Stock nuevo | 33 filas de ubicación y 1 de depósito |
| Stock actualizado | 217 filas de ubicación y 7 de depósito |
| Inventarios verificados contra el origen | 300 saldos; 292 precios por ubicación |
| Catálogo final | 56 productos: los 55 originales más el producto propio conservado |
| Fotografías | 66 archivos originales; 33 opciones de galería |

Las 4.582 escrituras de importación se agruparon en 46 commits. Cada actualización de stock y su movimiento `legacy_sync_snapshot` comparten un grupo atómico. Los IDs originales y las precondiciones `exists:false`/`updateTime` permiten detectar duplicados y conflictos. El journal privado permite retomar una operación interrumpida; antes de reintentar una respuesta perdida se verifica si el commit ya se aplicó.

El saldo proviene del snapshot actual del origen más los movimientos propios posteriores que aún estén vigentes. Después de la baja autorizada esa diferencia fue cero. Se verificaron los saldos y los precios contra el origen, incluyendo los precios particulares de cada ubicación. No se volvió a ejecutar `createSale`, ni se sumaron ingresos desde facturas.

Una lectura posterior del destino y la regeneración del plan dieron **cero escrituras y cero conflictos**. Se compararon todos los campos afectados contra el plan y los campos originales de las 13 ventas fuera de la máscara de baja. La metadata de `invoices`, `financialEntries`, `users`, `roles` y `settings` permaneció idéntica antes y después.

## Archivos y dependencias

- `scripts/migrate-legacy-data.mjs`: transporte Firestore REST con la sesión existente de Firebase CLI, captura privada, planificación, aplicación, journal y verificación. El endpoint de escritura apunta exclusivamente al proyecto destino.
- `scripts/legacy-migration/domain.mjs`: codecs, aliases, planificación, conciliación y guardas de colecciones, referencias fiscales y concurrencia.
- `scripts/legacy-migration/cleanup.mjs`: baja administrativa limitada a las 13 ventas identificadas y devolución comprobada de stock vigente.
- `public/images/legacy-products/*`: originales JPG/WebP y manifiesto SHA-256 verificado contra Git del sistema anterior.
- `src/data/legacyProductImages.js`, `src/data/productImages.js`: incorporación a la galería existente para que editar un producto no descarte su foto antigua.
- `src/gestion/services/dashboardService.js`, `locationSalesService.js`, `sellerService.js`, `src/gestion/customers/crmService.js`, `src/modules/locations/domain/metrics.js`: exclusión de bajas en los lectores habituales y estadísticas de anulaciones.
- `tests/legacy-migration.test.mjs`, `archived-sales-history.test.mjs`, `dashboard-services.test.mjs`, `dashboard-summary.test.mjs`: verificaciones de integridad, bajas, stock, precios, aliases, pagos, paginación e imágenes.

Los snapshots, planes, IDs autorizados y journals están en `.firebase-migration-private/2026-10-03/`, excluido de Git. No se incorporan credenciales, exportaciones de usuarios, clientes ni ventas individuales al repositorio. No hay nuevas colecciones de negocio, reglas, índices ni dependencias de la aplicación. El ejecutor administrativo requiere Firebase CLI instalado globalmente y una cuenta con acceso a ambos proyectos; no copia usuarios ni permisos.

## Operación y verificación

```powershell
# Auditoría de ambos proyectos; guarda exports privados.
node scripts/migrate-legacy-data.mjs audit --folder .firebase-migration-private/AAAA-MM-DD
# Sólo releer destino, reutilizando el snapshot de origen ya validado.
node scripts/migrate-legacy-data.mjs audit-destination --folder .firebase-migration-private/AAAA-MM-DD
# Plan sin escrituras, revisar conflictos y advertencias.
node scripts/migrate-legacy-data.mjs plan --folder .firebase-migration-private/AAAA-MM-DD --operation identificador-unico
# Aplicación explícita del plan revisado y verificación.
node scripts/migrate-legacy-data.mjs apply --folder .firebase-migration-private/AAAA-MM-DD
```

`cleanup-plan` requiere un archivo privado `authorized-cleanup-ids.json` con exactamente los 13 IDs autorizados; no es una herramienta de borrado general. No se deben ampliar esos IDs ni usarla para otras operaciones. La anulación comercial habitual y su bloqueo de ventas con comprobante fiscal siguen intactos.

Validación local: 504 tests aprobados, lint focalizado sin errores, comprobación de tipos de los archivos de aplicación afectados sin errores, build de Vite y build productivo de Netlify aprobados con las 11 Functions existentes. Las cuatro Functions ARCA y `arcaService.js` no cambiaron. No se emitieron comprobantes reales, no se cambiaron secretos y no se habilitó emisión automática. La API de Cloud Functions del proyecto está deshabilitada; no se habilitó para esta tarea.

## Pendientes y límites

- Se conservaron cinco saldos negativos existentes: uno en Caminos y Sabores y cuatro en Casa Mendoza. Necesitan conteo físico; no se inventaron unidades ni se reemplazaron por cero.
- El origen no guarda el canal comercial real de estas ventas históricas. Se conservó el dato ausente; no se dedujo WhatsApp/Instagram de una ubicación.
- La copia es un snapshot, no una sincronización continua. Ventas nuevas en el sistema anterior requieren otra migración revisada. Cambios posteriores en ventas ya coincidentes provocan un conflicto, no una sobrescritura automática.
- La lectura adicional del origen después de aplicar devolvió `429 Quota exceeded`. Se detuvo esa lectura, sin modificar el origen ni habilitar facturación. La verificación final usa el snapshot de origen cuyo digest se comprobó inmediatamente antes de importar y una lectura nueva completa del destino. Evitar exportaciones históricas repetidas y respetar la cuota disponible antes de otra auditoría.
- Las configuraciones administrativas actuales de ubicaciones, depósitos, usuarios y permisos se conservan. Crear descuentos históricos no habilita automáticamente nuevos descuentos en una ubicación.
- No hay rollback automático que borre datos en producción. Los exports anteriores y posteriores y los journals se conservan privados para una restauración selectiva revisada. No revertir inventarios si hubo ventas posteriores ni borrar comprobantes fiscales. Revertir el deploy estático no revierte Firestore.
