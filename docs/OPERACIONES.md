# Operaciones: auditoría y adaptación

Base de trabajo: `21b5f7e2614702f742455eb280a2fa2b0b701b81`, posterior al Panel General; ARCA validada en `e548672e28b49210042e20c53e49af357f9df54f`. Rama `codex/modulo-operaciones`.

Fuentes verificadas en la carpeta provista de Drive: [Parte 1 A–C](https://drive.google.com/file/d/1TT2CBwml1vuP-LTUvojKOboLwwt_QgmN/view), secciones B y C; [Parte 2 D–F](https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view), sección F. Versiones 0.2. Se leyó el prompt adjunto de Operaciones.

## Arquitectura encontrada antes de modificar código

- `/gestion/locations` y `/gestion/locations/:id/{products,stock,sellers,discounts}`: `LocationsPage`, `LocationDetailPage`; catálogo y picker reutilizable, vendedores, descuentos, stock y consulta de movimientos. Accesos Cargar stock desde tarjetas y Panel existentes.
- `/gestion/warehouse` y detalle `WarehousePage`: depósitos separados y vacíos al crearse, productos del catálogo, ingresos, transferencias y movimientos. El depósito no tiene vendedores ni precio comercial propio.
- `products` y `productCategories`: catálogo maestro; `locationStock/{locationId}/items/{productId}` y `warehouseStock/{warehouseId}/items/{productId}`: relaciones por ID al maestro con snapshots de identidad, cantidades y configuración local. No son productos globales nuevos.
- `inventoryService`: altas/ingresos y transferencia transaccionales; `inventoryOperations` y `stockTransfers` registran idempotencia. `locationManagementService` también conserva operaciones de carga masiva en `stockOperations`; no se reemplazarán estos registros históricos.
- `stockMovements`: historial inmutable; `auditLogs`: auditoría existente usada por Actividad. Ventas descuentan/restauran stock por sus servicios; los comprobantes fiscales y sus bloqueos permanecen fuera de este trabajo.
- Precio central de inventario: `effectiveLocationPrice`, `priceMode=default/custom`, `priceOverride`, compatibilidad legacy `price` como precio propio. `joinMasterProducts`, usado por ventas, aún resuelve `local.price` directamente: puede quedar obsoleto cuando cambia el precio base.
- Ubicaciones: `store/fair/event` y tipos heredados, incluido `warehouse_store` dentro de la lista de tipos. Fechas `scheduleStartAt/EndAt`, pausas y estado activo/deleted. Baja lógica sin borrar ventas ni stock; no existe purga automática. Falta calendario semanal/horario de atención. Vendedores enlazan `assignedSellerIds` y `users.allowedLocationIds`. Descuentos enlazan `enabledDiscountIds` con vigencia y permisos.
- Alertas: umbrales locales rojo/amarillo en cada item; algunas altas todavía copian umbrales del maestro. Colección central `alerts`, superficie genérica, sin generación automática cerrada. No se creará otro sistema de alertas.

## Problemas identificados

1. Transferencia sólo Depósito → Ubicación/Depósito; acredita toda la cantidad esperada, sin conteo físico/incidencia ni responsable de traslado diferenciado. Estado existente `completed`.
2. Duplicar un producto en las líneas de una transferencia/carga puede sobrescribir el mismo movimiento y calcular deltas incorrectos. Falta rechazo explícito de duplicados.
3. Stock recibido/inicial y ajustes requieren trazabilidad consistente. La configuración local de precio/umbrales en `saveLocationProductSettings` no registra auditoría.
4. El historial aplica `limit` antes de ordenar por fecha en cliente: puede mostrar movimientos antiguos en lugar de los últimos.
5. Falta ajuste físico en depósitos y acceso de ajuste actual en ubicación. Las altas no separan estrictamente habilitar producto (configurar) de cargar cantidades (permiso loadStock).
6. Carga y transferencia validan `active` directamente; una ubicación futura/inactiva necesita poder recibir una transferencia según F.4, conservando control diferente al ingreso rápido de una ubicación activa.
7. Falta calendario operativo consistente y snapshots de cambios para futura reconstrucción histórica por Métricas.

## Criterios de adaptación

Se ampliará el modelo existente, sin migraciones destructivas, productos duplicados ni colecciones nuevas. Se conservará `completed` para la transferencia inmediata verificada por quien la confirma; los estados formales y la recepción asíncrona de otro usuario siguen pendientes de definición. Cantidades prevista/preparada/recibida y pérdidas quedarán explícitas, sin acreditar pérdidas al destino. Los umbrales nuevos se definirán en inventario, no se copiarán del maestro. No se implementarán métricas ni se tocará ARCA.

## Implementación final

- Ubicaciones nuevas: Local, Feria o Evento. Los tipos heredados pueden consultarse y editarse sin reclasificar documentos. Los depósitos nuevos siguen creándose exclusivamente en su módulo, vacíos, sin vendedores ni precios comerciales.
- Crear/editar ubicación guarda calendario y auditoría en una transacción. Una clave estable por formulario evita duplicar la creación por reintento. El calendario contiene `timeZone=America/Argentina/Buenos_Aires`, `weekdays` ISO (lunes=1, domingo=7), apertura/cierre `HH:mm`, `overnight` y fechas específicas `YYYY-MM-DD` únicas. Se validan fechas reales, pares de horarios y hasta 120 fechas. La auditoría conserva calendario/vigencia anterior y nuevo. Una llamada legacy sin calendario conserva el anterior. No se agregan cálculos de horas ni se cambia la aceptación de ventas fuera del horario configurado.
- Pausar/reactivar limpia los campos de pausa temporal anteriores; baja/restauración sigue siendo lógica. No se borran ventas, stock, asignaciones ni movimientos. Se invalida el caché compartido de ubicaciones después de guardar.
- Habilitar un producto vincula su ID global al inventario local. Configurar requiere `configureLocationProducts`; cantidades iniciales positivas requieren además `loadStock` y ubicación activa. En ubicaciones inactivas se permite habilitar con cero y recibir transferencias. El acceso Cargar stock desde ubicación/Panel sigue usando el flujo existente.
- Precio efectivo único: `effectiveLocationPrice`. Inventario, selector de ventas y panel de vendedor reutilizan el helper. `default` toma el precio maestro vigente; `custom` admite cero; `price` legacy se conserva como precio propio. Las ventas históricas mantienen sus precios guardados. Los umbrales nuevos comienzan en cero en el inventario local, no heredados del producto maestro; la configuración local registra auditoría sin modificar cantidades.
- Ajuste físico compartido para ubicación/depósito: transacción, permiso `adjustStock` (depósito también requiere `edit`), stock anterior/real/delta, usuario, timestamp de servidor y motivo opcional con texto descriptivo por defecto. La idempotencia y el bloqueo inmediato del submit evitan repetir el delta.
- El servicio y formulario de transferencia se reutilizan para los cuatro recorridos. Mantienen el permiso existente `warehouse.transferStock`; no se otorgaron permisos nuevos a roles. El transportista puede ser un tercero. Quien confirma certifica preparación y recepción; ambos responsables registrados son ese usuario. Se mantienen hasta 40 productos por transacción y se rechazan IDs repetidos, enteros inválidos, stock insuficiente y recepción mayor que preparación.
- Transferencias hacia/desde ubicaciones inactivas se admiten para preparación o devolución de ferias. Se rechazan propietarios eliminados y depósitos inactivos. Se conserva la restricción de producto habilitado/no eliminado en origen. Un destino existente conserva precio, umbrales y estado del producto; un destino nuevo usa la referencia global y configuración local explícita.
- Los movimientos se consultan por inventario y producto, ordenados por `createdAt desc` antes del límite (30 inicialmente, máximo 120). Se mantienen carga progresiva y estados vacío/error. El formulario de transferencia usa un solo scroll y campos de conteo accesibles también en móvil.

### Conteo físico de una transferencia

Para cada producto, `quantity` es lo previsto según el registro digital, `preparedQuantity` lo físicamente preparado y `receivedQuantity` lo recibido. Debe cumplirse `0 ≤ recibidas ≤ preparadas ≤ previstas ≤ stock origen`.

Cliente y servicio comparten esta validación. Un conteo físico en blanco no equivale a cero: debe completarse explícitamente, evitando registrar pérdidas por un campo vaciado accidentalmente.

`missingQuantity = previstas − preparadas`; `lostQuantity = preparadas − recibidas`. Se descuentan **las previstas** del origen, incluyendo la corrección del faltante detectado, y se acreditan **sólo las recibidas** al destino. Los dos movimientos guardan los cuatro conteos, stock anterior/nuevo, referencia de transferencia y observación. No se descuenta dos veces una pérdida ni se crea una colección de incidencias paralela.

Ejemplo probado: origen digital 20, preparación física 19, recepción 18, destino anterior 10 → origen 0, destino 28, faltante 1 y pérdida 1. La transferencia conserva `status=completed` y `totalQuantity=20` por compatibilidad; la UI informa `receivedQuantity=18`. Reintentar con el mismo ID no modifica stocks ni duplica logs. Si una validación/escritura falla, la transacción no modifica ningún inventario.

## Modelo y colecciones utilizados

| Colección existente | Uso final |
| --- | --- |
| `locations` | Punto de venta, vigencia, estado, calendario, vendedores y descuentos enlazados. |
| `warehouses` | Almacenamiento separado de ventas, vendedores y precios. |
| `products`, `productCategories` | Catálogo global. Se consultan; sólo las operaciones explícitas de catálogo crean productos. |
| `locationStock/{id}/items/{productId}` | Cantidades, precio base/propio y umbrales locales; referencia estable al maestro. |
| `warehouseStock/{id}/items/{productId}` | Cantidades y referencia al maestro; no agrega campos de precio. |
| `inventoryOperations` | Idempotencia de habilitación/ingresos/ajustes individuales. |
| `stockOperations` | Compatibilidad con carga masiva existente, sin borrar registros anteriores. |
| `stockTransfers` | Transferencia inmediata, actores, conteos físicos, pérdidas y estado existente. |
| `stockMovements` | Historial inmutable con deltas, referencias y conteos. |
| `auditLogs` | Actividad existente, incluyendo cambios de calendario/configuración e incidencias. |
| `users`, `discounts`, `sales`, `alerts` | Relaciones existentes conservadas; no se crean modelos paralelos. |

No se aplican migraciones destructivas ni se reescriben snapshots históricos. Transferencias antiguas sin conteos nuevos mantienen el total anterior como fallback visual. La firma legacy `originWarehouse` continúa aceptada por el servicio. Las reglas nuevas reconocen ajustes autorizados y calendario; rechazan fabricar registros de ajuste sin `adjustStock`. No se modificaron reglas de ventas ni de facturación.

## Archivos afectados

| Archivos | Cambio |
| --- | --- |
| `src/gestion/pages/LocationsPage.jsx` | Tipos, calendario, compatibilidad de edición y bloqueo de creación repetida. |
| `src/gestion/pages/LocationDetailPage.jsx`, `WarehousePage.jsx` | Accesos y reutilización de ajuste/transferencia, separación habilitar/cargar. |
| `src/gestion/components/InventoryTransferModal.jsx`, `InventoryAdjustmentModal.jsx` | Formularios compartidos, recepción física, estados y guardas de submit. |
| `src/gestion/services/inventoryService.js` | Transferencias/ajustes atómicos e idempotentes, auditoría local, consultas ordenadas. |
| `src/gestion/services/locationManagementService.js`, `locationEnhancementsService.js` | Calendario/lifecycle, cargas legacy, umbrales y compatibilidad de configuración. |
| `src/modules/inventory/domain/inventory.js`, `src/modules/locations/domain/locations.js`, `dashboard.js` | Validación de líneas duplicadas/conteos, calendario y precio central. |
| `src/gestion/seller/SellerPanel.jsx`, `src/gestion/services/sharedResources.js` | Precio central y maestro con caché compartido. No cambian flujos fiscales. |
| `src/gestion/services/dashboardService.js` | Contexto de depósitos para movimientos legacy en Actividad. Sin cambiar indicadores del Panel. |
| `src/styles/location-enhancements.css` | Calendario y layout de conteos responsive. |
| `firestore.rules`, `firestore.indexes.json` | Permisos operativos focalizados; dos índices de historial por propietario/producto/fecha. |
| `tests/operations-services.test.mjs`, `tests/firestore.operations.rules.mjs`, `tests/location-enhancements.test.mjs`, `package.json` | Pruebas ligeras, texto del bloqueo de carga directa actualizado y registro de pruebas de reglas en el comando existente. |
| `docs/OPERACIONES.md` | Auditoría, modelo, decisiones, validación y pendientes. |

## Verificación

- `npm test`: 457/457, incluidos 12 casos de Operaciones. Adaptador local comprueba lecturas antes de escrituras, commit atómico, concurrencia/idempotencia, cuatro recorridos, pérdidas, permisos, precios, calendario y preservación de históricos.
- Emulador Firestore local, separado de Firebase real: 46/46 pruebas existentes de reglas generales y recuperación fiscal; 3/3 nuevas con servicios reales para transferencia parcial, ajustes/calendario y permisos negativos. `tests/firestore.operations.rules.mjs` también queda integrado en `npm run test:rules`.
- TypeScript 5.9 `allowJs/checkJs/noEmit`: cero diagnósticos en los tres helpers de dominio y servicios `inventoryService`, `locationManagementService`, `sharedResources`. El proyecto es JavaScript/JSX y no tiene `tsconfig`; no se afirma una conversión a TypeScript ni typecheck integral de componentes heredados.
- ESLint focalizado sobre los JS/JSX modificados y pruebas nuevas: cero errores de variables/uso, referencias indefinidas, claves duplicadas, código inalcanzable o condiciones constantes.
- Builds Gestión y Ecommerce completos. Se conserva el aviso previo de chunks mayores de 500 kB.
- Navegador con páginas/formularios reales y adaptador sintético en memoria: edición y persistencia de calendario; pausa/reactivación; navegación Cargar stock; ingreso 20→23; ajuste 23→22 con historial; transferencia 20/19/18 a feria inactiva; habilitación con cero desde catálogo; depósito sin precios; estados vacío/error. A 390 px no aparece scroll horizontal y el formulario mantiene un solo scroll vertical. No se escribió Firebase real ni se ejecutó E2E pesado.
- Servicios/componentes fiscales, backend ARCA y sus puntos de entrada comparados con la base: intactos. La modificación del panel de vendedor se limita a resolver el precio visible con el helper; los flujos de emisión, recuperación y protección fiscal no cambian.

## Pendientes funcionales y riesgos conocidos

1. F.4 contempla notificación y aceptación cuando otra persona recibe. Estados formales, rechazos, recepción asíncrona, reservas durante tránsito y contratos de notificación requieren definición. No se simula ese flujo con `completed`: el formulario exige confirmar personalmente ambos conteos. El responsable físico del traslado sí se registra.
2. Reglas de contenedores/cajas, motivos obligatorios en casos específicos y generación automática de alertas no están cerradas. Se conserva observación opcional y el módulo/umbrales existentes, sin crear un generador alternativo.
3. El calendario describe atención configurada; el cómputo de horas efectivas y de ventas fuera de horario pertenece a Métricas. Los períodos históricos tienen snapshots auditados desde este cambio; no se reconstruye información anterior desconocida.
4. Tipos legacy como `warehouse_store` no se convierten a depósitos ni se borran. Una reclasificación futura exige migración compatible y resolución explícita de ventas/vendedores históricos. Tampoco se implementa purga a 30 días sin contrato de retención/reautenticación.
5. Deben publicarse las reglas e índices operativos mediante el despliegue normal de Firebase para usar las nuevas queries/permisos en ese entorno. Este trabajo no despliega a producción. Los registros históricos sin `createdAt` no aparecen en queries ordenadas por ese campo; no se inventan fechas.
6. Los servicios nuevos siempre escriben stock y trazabilidad juntos. La matriz heredada de reglas concede a roles operativos escrituras directas amplias sobre cantidades; este cambio restringe los registros de ajuste, pero no reescribe todos los permisos ni elimina compatibilidad de ventas antiguas. Endurecer completamente el acceso directo requiere auditar/migrar esos escritores, además de los servicios actuales.
7. La hidratación de inventario consulta el maestro por producto; el vendedor agrega catálogo activo cacheado por 60 segundos para resolver precios. No se agregan listeners de históricos ni denormalizaciones. Una estrategia de catálogo grande/paginación y exclusión mutua global ante altas concurrentes sigue siendo una mejora del catálogo existente, no un segundo modelo de productos.
