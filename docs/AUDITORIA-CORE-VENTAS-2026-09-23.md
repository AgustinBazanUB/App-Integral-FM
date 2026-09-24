# Auditoría núcleo de ventas — Productos, Ubicaciones y Panel Vendedor

Fecha: 23 de septiembre de 2026  
Rama auditada: `audit/core-sales-20260923`  
Base: `migration/legacy-stock-products-20260923`

## A. Resumen ejecutivo

El núcleo auditado queda apto para iniciar pruebas operativas reales una vez integrado y desplegado junto con las reglas de Firestore correspondientes. La auditoría no se publicó directamente a producción.

Se revisó el circuito:

`Producto maestro → producto habilitado en ubicación → stock de ubicación → Panel Vendedor → venta → edición/anulación`

También se revisó el cambio Administrador ↔ Panel Vendedor. La aplicación ya utiliza navegación interna sobre la misma sesión y el mismo árbol de autenticación, sin requerir un segundo login ni una recarga completa deliberada. Además, el arranque administrativo ya precarga recursos relevantes del vendedor.

Las divergencias funcionales más importantes encontradas fueron:

1. el sistema bloqueaba ventas cuando el stock digital era insuficiente, aunque la solución vigente exige permitir registrar la venta física real y aceptar stock negativo con advertencia;
2. los umbrales de alerta estaban parcialmente modelados como atributos del producto maestro, cuando deben pertenecer al producto dentro de cada ubicación;
3. la creación de producto desde una ubicación utilizaba todavía campos legacy de identificación y no dejaba explícita la semántica de precio base heredado;
4. la vista diaria del vendedor no mostraba el efectivo cobrado;
5. la suscripción de stock del Panel Vendedor volvía a consultar Firestore después de recibir el mismo stock por listener;
6. el bloqueo contra doble confirmación dependía sólo del estado React y no de un lock síncrono.

Todos esos puntos fueron corregidos en esta rama.

## B. Problemas encontrados

| Prioridad | Módulo | Problema | Causa | Estado |
|---|---|---|---|---|
| P0 | Panel Vendedor / Stock | Una venta física era bloqueada si el stock digital no alcanzaba. | Validaciones de UI, servicio y reglas exigían stock no negativo. | Corregido |
| P0 | Venta | Dos eventos de confirmación muy próximos podían entrar antes del re-render de `loading`. | Protección basada sólo en estado React. | Corregido |
| P1 | Productos / Ubicaciones | Alertas amarilla/roja aparecían en producto maestro y podían heredarse a nuevas ubicaciones. | Modelo legacy mezclaba catálogo e inventario local. | Corregido |
| P1 | Producto creado desde Ubicación | Se seguía usando `abbreviation` como identificador principal y no quedaba explícito el modo de precio predeterminado. | Compatibilidad histórica no alineada con el modelo nuevo. | Corregido |
| P2 | Panel Vendedor | La vista diaria no mostraba efectivo cobrado. | Resumen diario incompleto. | Corregido |
| P2 | Rendimiento | Cada actualización del listener de stock disparaba una segunda lectura de la colección y luego lecturas de producto. | El hook ignoraba los documentos entregados por el listener. | Corregido |
| P2 | Suite global | Cinco pruebas estáticas ya fallaban en la rama base antes de esta auditoría. | Tests desactualizados respecto de la implementación de Ubicaciones. | Preexistente / fuera del cambio funcional de esta auditoría |
| Pendiente funcional | Offline | Política exacta ante conflictos de stock al sincronizar varias ventas offline. | La solución propuesta la marca expresamente como pendiente. | No inventada |

## C. Correcciones realizadas

### Venta con stock digital insuficiente

Archivos principales:

- `src/gestion/seller/SellerPanel.jsx`
- `src/gestion/services/sellerService.js`
- `firestore.rules`

Cambios:

- el stock disponible deja de truncarse artificialmente a cero;
- se puede incrementar cantidad aun cuando el saldo digital sea insuficiente;
- se muestra una advertencia clara;
- confirmar sigue habilitado si el vendedor verificó mercadería física;
- la transacción puede dejar `currentStock` negativo;
- edición de venta puede recalcular también a saldo negativo;
- las reglas siguen impidiendo que el vendedor haga un ajuste libre de stock: la modificación debe estar vinculada a una venta/edición/anulación y a su movimiento de inventario.

### Protección contra doble confirmación

Archivo:

- `src/gestion/seller/SellerPanel.jsx`

Se agregó un `submitLockRef` síncrono además del estado visual `busy`. Esto impide que dos clicks o eventos de teclado consecutivos inicien dos transacciones antes de que React alcance a deshabilitar el botón.

### Alertas exclusivamente por ubicación

Archivos principales:

- `src/gestion/components/ProductForm.jsx`
- `src/gestion/components/LocationProductForm.jsx`
- `src/gestion/pages/ProductsPage.jsx`
- `src/gestion/services/inventoryService.js`
- `src/gestion/services/locationEnhancementsService.js`
- `scripts/migrate-legacy-inventory.mjs`

Cambios:

- se retiraron los umbrales de alerta del formulario maestro;
- Productos comunica que stock y alertas se administran por ubicación;
- una nueva asignación local nace con umbrales locales en cero;
- la migración no promueve alertas locales a la definición maestra;
- alertas legacy de una ubicación se conservan en esa ubicación.

### ID de producto y precio al crear desde Ubicaciones

Archivos:

- `src/gestion/components/LocationProductForm.jsx`
- `src/gestion/services/locationEnhancementsService.js`

Cambios:

- el formulario usa `productCode` como ID operativo canónico;
- se mantiene `abbreviation` como alias legacy para compatibilidad;
- se crean `productCodeKey` y `abbreviationKey`;
- el inventario local nuevo queda explícitamente en `PRICE_MODES.DEFAULT`;
- `priceOverride` queda `null`;
- `masterDefaultPrice` conserva el precio base.

Así, una ubicación que usa precio predeterminado puede seguir el precio maestro y una ubicación que use override puede mantener su precio propio.

### Resumen diario del vendedor

Archivos:

- `src/gestion/seller/sellerDomain.js`
- `src/gestion/seller/SellerPanel.jsx`
- `src/styles/seller-panel.css`

La vista “Mis ventas de hoy” muestra ahora:

- cantidad de ventas activas;
- total vendido;
- efectivo cobrado, incluyendo la porción de efectivo de pagos combinados.

Ventas anuladas no se suman.

## D. Mejoras de UX

- La inconsistencia de stock se presenta como advertencia operativa y no como bloqueo.
- El vendedor no tiene que corregir ficticiamente el stock digital para registrar una venta real.
- El resumen de jornada muestra directamente el efectivo a rendir.
- Las métricas diarias se apilan en pantallas pequeñas.
- El formulario maestro ya no presenta alertas que conceptualmente pertenecen a una ubicación.
- Se mantiene el flujo de venta existente y no se rediseñó arbitrariamente el Panel Vendedor.

## E. Mejoras de rendimiento

### Stock del Panel Vendedor

Antes:

1. el listener de `locationStock` recibía los documentos;
2. el hook descartaba esos documentos;
3. volvía a consultar `locationStock`;
4. hidrataba los productos maestros mediante lecturas por ID.

Después:

1. el hook reutiliza directamente los documentos entregados por el listener;
2. hidrata con el producto maestro;
3. los productos maestros se cachean temporalmente por ID;
4. la caché se invalida cuando se edita un producto maestro.

Esto elimina una lectura redundante de la colección de stock ante cada actualización del listener y reduce lecturas repetitivas de productos.

No se inventan métricas de milisegundos: no se realizó una medición de navegador real en esta auditoría.

### Administrador ↔ Vendedor

Se validó que la arquitectura actual ya utiliza navegación interna entre `/gestion` y `/vendedor`, conserva sesión y no requiere un segundo árbol de autenticación. El Panel Vendedor también permanece disponible sin carga lazy adicional y los recursos principales se precalientan desde la aplicación de gestión.

No se encontró una razón para reescribir esta arquitectura.

## F. Modelo de datos

Se reforzó la separación:

### Producto maestro

Contiene, entre otros:

- nombre;
- ID/código;
- categoría;
- descripción;
- precio base;
- imagen;
- tecla rápida;
- estado.

### Producto dentro de una ubicación

Contiene, entre otros:

- producto referenciado;
- stock;
- modo de precio;
- override de precio;
- alertas amarilla/roja;
- estado local.

No se ejecutó una migración destructiva ni se eliminó información histórica.

## G. Tests y validaciones

### Validación específica de esta auditoría

Se creó una validación temporal de CI y se ejecutó contra el commit auditado.

Resultado:

- pruebas del núcleo auditado: **PASS**;
- reglas Firestore con emulador: **PASS**;
- build Vite de producción: **PASS**.

La validación temporal se retiró después de obtener el resultado exitoso.

Pruebas agregadas/ajustadas cubren:

- alertas fuera del producto maestro;
- ID y modo de precio al crear desde ubicación;
- venta que puede llevar stock digital a negativo con advertencia;
- bloqueo de ajustes libres de stock del vendedor;
- resumen diario y efectivo en pagos simples/combinados;
- lock síncrono contra doble confirmación;
- eliminación de la segunda lectura de stock del Panel Vendedor.

### Suite global preexistente

`npm test` en la rama base `migration/legacy-stock-products-20260923` ya fallaba en cinco pruebas estáticas antes de esta auditoría. La rama auditada conserva exactamente esos cinco fallos y no agrega fallos nuevos a la suite general.

Los cinco tests preexistentes son:

- “los formularios con cierres inline quedan cubiertos por el fix global”;
- “cargar stock abre directamente la sección correcta y valida actividad”;
- “los productos se crean desde la ubicación con alcance local predeterminado”;
- “la vista de productos está agrupada por categoría”;
- “stock, navegación y venta actual tienen reglas responsive compactas”.

Estas pruebas apuntan a estructuras/textos anteriores de `LocationDetailPage` y deben reconciliarse con la versión vigente en un cambio separado o dentro de la rama de migración que las introdujo.

## H. Decisiones funcionales pendientes

No se inventaron reglas para:

1. resolución de conflictos cuando varias ventas offline se sincronizan contra un stock que cambió;
2. política técnica definitiva de baja/eliminación irreversible de ubicaciones;
3. otros puntos que la Solución Propuesta marque explícitamente como pendiente, preliminar o futuro.

## I. Archivos modificados

Código y reglas:

- `src/gestion/seller/SellerPanel.jsx`
- `src/gestion/seller/sellerDomain.js`
- `src/gestion/seller/hooks.js`
- `src/gestion/services/sellerService.js`
- `src/gestion/services/inventoryService.js`
- `src/gestion/services/locationEnhancementsService.js`
- `src/gestion/components/ProductForm.jsx`
- `src/gestion/components/LocationProductForm.jsx`
- `src/gestion/pages/ProductsPage.jsx`
- `src/styles/seller-panel.css`
- `firestore.rules`
- `scripts/migrate-legacy-inventory.mjs`

Tests:

- `tests/core-sales-audit.test.mjs`
- `tests/seller-panel.test.mjs`
- `tests/firestore.rules.mjs`
- `tests/performance-metrics.test.mjs`

Documentación:

- `docs/versions/V1.1-PANEL-VENDEDOR.md`
- este informe.

## J. Riesgos restantes

Antes de usar esta rama como versión productiva:

1. integrar primero la rama de migración base de la que depende este trabajo;
2. revisar y aprobar este cambio;
3. desplegar conjuntamente aplicación y reglas de Firestore;
4. realizar una venta de humo/controlada en una ubicación real con un usuario Vendedor;
5. verificar una edición y una anulación;
6. verificar que una venta con stock digital 0 produzca advertencia, registre la venta y deje el saldo negativo;
7. reconciliar los cinco tests preexistentes de la rama base para recuperar una suite global completamente verde.

La resolución de conflictos offline sigue siendo un pendiente funcional documentado; por eso no se presenta como cerrado.
