# Productos, Stock y Depósitos

## 1. Objetivo de la modificación

Separar correctamente cuatro conceptos que antes estaban demasiado mezclados en la experiencia de administración: el producto maestro, la ubicación de venta, el depósito y el stock físico. La meta es que un producto exista una sola vez en el catálogo de Flor Mía y que cada lugar solamente guarde su relación operativa con ese producto.

## 2. Problema anterior

Parte de la experiencia de Ubicaciones mezclaba catálogo, configuración local y stock. Esto hacía fácil interpretar que cada ubicación tenía su propia copia del producto. También existían registros legacy en `locationStock` que guardaban un campo `price` sin indicar si era un precio especial o una copia del precio maestro.

## 3. Nueva arquitectura

Se preservan las fuentes ya existentes en el proyecto:

- `products`: catálogo maestro y único de productos.
- `productCategories`: catálogo único de categorías.
- `locationStock/{locationId}/items/{productId}`: relación entre un producto y una ubicación de venta.
- `warehouses`: depósitos.
- `warehouseStock/{warehouseId}/items/{productId}`: relación entre un producto y un depósito.
- `stockMovements`: trazabilidad de movimientos.
- `stockTransfers`: resumen de transferencias.
- `inventoryOperations`: idempotencia para operaciones nuevas de inventario.

No se crea una segunda colección de productos y se preservan los `productId` existentes.

## 4. Diagrama textual

Producto
↓
Ubicación
↓
Stock + Precio

Producto
↓
Depósito
↓
Stock

## 5. Modelo de Productos

`products` continúa siendo la fuente de verdad. Entre los campos relevantes se encuentran:

- nombre;
- abreviación;
- descripción;
- categoría;
- precio predeterminado;
- alertas;
- estado activo/inactivo;
- imagen;
- configuración de botonera existente;
- metadatos de auditoría.

El módulo global `Productos` administra esos datos. Crear un producto no significa agregar stock a ningún lugar.

## 6. Modelo de stock de ubicación

Cada ubicación solamente muestra productos que poseen un registro en `locationStock/{locationId}/items`.

Los nuevos registros distinguen:

- `priceMode: default`: utiliza el precio maestro vigente del producto.
- `priceMode: custom`: utiliza `priceOverride`.

El precio efectivo se resuelve conceptualmente como:

`priceOverride ?? product.defaultPrice`

El campo legacy `price` se conserva por retrocompatibilidad, pero deja de ser la única fuente para determinar la intención comercial de los nuevos registros.

## 7. Modelo de depósito

Los depósitos viven en `warehouses` y su inventario en `warehouseStock/{warehouseId}/items/{productId}`.

Un depósito:

- tiene productos asignados;
- tiene stock;
- puede recibir ingresos;
- puede transferir stock;
- no tiene precio de venta.

La capa de dominio elimina campos de precio al hidratar inventario de depósito y las nuevas reglas rechazan campos comerciales de precio en `warehouseStock`.

## 8. Transferencias

La transferencia se diseñó como operación multiproducto desde un depósito hacia:

- una ubicación de venta;
- otro depósito.

La operación utiliza transacción Firestore para leer el stock disponible y aplicar origen y destino como una sola operación lógica. Se valida stock suficiente, cantidades positivas y destino diferente del origen.

Cuando el producto no existe en destino:

- si el destino es depósito, se crea el vínculo sin precio;
- si el destino es ubicación, se crea usando por defecto el precio maestro, salvo que el usuario defina un precio especial.

Cuando ya existe en destino, se conserva su configuración comercial actual.

## 9. Movimientos

Cada ingreso o transferencia genera trazabilidad en `stockMovements` con información suficiente para reconstruir la operación:

- tipo;
- producto;
- cantidad;
- inventario involucrado;
- stock anterior;
- stock nuevo;
- usuario;
- fecha;
- observación;
- transferencia u operación asociada cuando corresponda.

La interfaz limita inicialmente la cantidad de movimientos y permite cargar más bajo demanda.

## 10. Precios predeterminados y personalizados

Los productos tienen un `defaultPrice` maestro.

Una ubicación nueva puede:

1. usar el precio predeterminado; o
2. guardar un precio especial local.

Si usa el predeterminado, los consumidores de venta resuelven el valor maestro vigente. Si usa un precio especial, éste permanece independiente de cambios posteriores en `products.defaultPrice`.

## 11. Migración y retrocompatibilidad

No se implementó una migración destructiva.

Los registros legacy con `price` pero sin `priceMode` se interpretan conservadoramente como precio local existente para no modificar silenciosamente valores reales. Esta decisión evita asumir que un precio antiguo era una copia del maestro cuando no existe evidencia suficiente.

No se eliminan colecciones ni campos antiguos en esta etapa.

## 12. Firestore

Se evita duplicar documentos completos de producto en cada inventario. Los inventarios guardan los datos operativos necesarios y snapshots mínimos compatibles con el sistema existente.

Las operaciones críticas de stock utilizan transacciones. Las consultas de movimientos son limitadas y ampliables bajo demanda. El catálogo reutiliza los servicios/cachés existentes donde corresponde.

## 13. Security Rules

`firestore.rules` fue adaptado en la rama de preview para contemplar:

- permisos del módulo Productos;
- creación/edición de depósitos;
- inventario de depósitos;
- stock no negativo;
- prohibición de precio en depósitos;
- operaciones de inventario;
- movimientos de ubicación y depósito;
- transferencias.

Estas Rules NO fueron desplegadas a Firebase producción.

## 14. Permisos

Se mantiene la filosofía existente de permisos por módulo y acción. El frontend oculta o deshabilita acciones según `can(...)`, pero la protección importante también vive en Firestore Rules.

Los vendedores continúan limitados a sus ubicaciones y al flujo de ventas. Los responsables de depósito trabajan sobre `warehouse` y los administradores conservan acceso integral según el contrato existente.

## 15. UX y tooltips

Se creó un componente reutilizable `HelpTooltip` para las acciones nuevas y modificadas.

Incluye:

- mouse hover;
- focus de teclado;
- `aria-describedby`;
- portal al `body` para evitar clipping por `overflow`;
- alternativa de ayuda por tap mediante icono para dispositivos touch.

También se agregaron textos explicativos y estados vacíos en lenguaje cotidiano.

## 16. Archivos principales modificados

Entre los archivos principales se encuentran:

- `src/gestion/modules.js`
- `src/gestion/permissions.js`
- `src/gestion/ManagementApp.jsx`
- `src/gestion/routePreload.js`
- `src/gestion/pages/ProductsPage.jsx`
- `src/gestion/pages/LocationDetailPage.jsx`
- `src/gestion/pages/WarehousePage.jsx`
- `src/gestion/components/ProductForm.jsx`
- `src/gestion/components/HelpTooltip.jsx`
- `src/gestion/services/inventoryService.js`
- `src/modules/inventory/domain/inventory.js`
- `src/gestion/services/managementService.js`
- `src/gestion/services/sellerService.js`
- `src/gestion/seller/hooks.js`
- `firestore.rules`
- `src/styles/inventory.css`
- `tests/inventory-domain.test.mjs`

## 17. Tests agregados

Se agregó cobertura de dominio para:

- precio predeterminado;
- precio personalizado;
- compatibilidad legacy;
- inventario de depósito sin precio;
- suma de stock;
- cantidades inválidas;
- stock insuficiente;
- resumen multiproducto.

La suite completa de aplicación y Rules Emulator debe seguir ampliándose antes del merge definitivo.

## 18. Comandos de validación

El `package.json` actual define como principales:

- `npm ci`
- `npm test`
- `npm run test:rules`
- `npm run build`

No existen actualmente scripts `lint` ni `typecheck` definidos en `package.json`.

El Deploy Preview de Netlify construyó correctamente el HEAD asociado al Draft PR #16.

## 19. Riesgos conocidos

- Los precios legacy no expresan si originalmente eran predeterminados o especiales; se preservan conservadoramente.
- Las nuevas Rules están versionadas pero no desplegadas en producción.
- La validación funcional completa con datos reales requiere probar el preview autenticado.
- Debe completarse la cobertura del emulador para todos los escenarios de transferencia antes de mergear.

## 20. Pendientes manuales

En el Deploy Preview validar especialmente:

- creación y edición de Producto;
- incorporación de producto a ubicación;
- precio predeterminado vs. especial;
- ingreso de stock;
- alta de depósito;
- depósito vacío;
- producto en depósito sin precio;
- transferencia multiproducto;
- producto inexistente en destino;
- historial;
- Panel Vendedor;
- responsive y ayudas contextuales.

## 21. Procedimiento de rollback

Mientras este trabajo permanezca sin mergear, el rollback operativo consiste simplemente en no aprobar el Draft PR y continuar utilizando la versión anterior.

Si en una etapa futura se mergea, el rollback debe hacerse mediante un commit de reversión del PR, preservando datos nuevos y evaluando previamente cualquier registro creado con el nuevo esquema. No se deben borrar inventarios ni movimientos para retroceder UI.

## 22. Estado del Deploy Preview

Draft PR: `#16 — PREVIEW — Productos, Stock y Depósitos`

Deploy Preview:

`https://deploy-preview-16--appintegralflormia.netlify.app`

Estado de Netlify verificado para el HEAD inicial del PR: `success`.

## Seguridad de entrega

- NO MERGEAR sin aprobación manual del propietario.
- NO desplegar Netlify Production.
- NO desplegar Firestore Rules a producción desde esta rama sin autorización expresa.
