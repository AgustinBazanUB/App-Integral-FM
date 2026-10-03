# Panel General del Administrador

## Auditoría previa — 2 de octubre de 2026

Base solicitada: `e548672e28b49210042e20c53e49af357f9df54f` (ARCA validada). El checkout inicial estaba en otra rama, `feature/meta-ads-campaign-planner`; se preservó y se creó `codex/modulo-panel-general` desde la base solicitada. `tmp/` preexistente no forma parte de la entrega.

Fuentes consultadas en Drive: [Parte 3 G–I](https://drive.google.com/file/d/1V7o_dkOc1mHnIolE3g0U3X1jjhB8TYZz/view), [Parte 1 A–C](https://drive.google.com/file/d/1TT2CBwml1vuP-LTUvojKOboLwwt_QgmN/view), [Parte 2 D–F](https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view). La sección H define el Panel; H.3–H.7 define acciones, indicadores, pagos y alertas; H.8 reemplaza la actividad cronológica por ritmo de ventas y formas de pago.

### Implementación encontrada antes de modificar código

- Ruta inicial `/gestion` (también `/gestion/dashboard`), resuelta por `ManagementApp.jsx`. Vendedores mantienen su panel separado. `ManagementShell` genera navegación por permisos. No existe un acceso al futuro asistente en esta base; no se creará una función de IA.
- `DashboardPage.jsx`: saludo fijo, Venta Rápida, selector de stock con ubicaciones operativamente activas, cuatro indicadores, barras de facturación, actividad cronológica con filtro por tipo y tarjetas de módulos. Las tarjetas de módulos estaban dentro de la condición de éxito de ventas.
- `DashboardFilters.jsx`: períodos día/mes/semana/año, calendario argentino, bloqueo de futuros, selección múltiple de ubicaciones activas e inactivas. Se conservarán porque son funcionales y permiten consultar historial.
- `useAsyncData`: loading/error/ready y descarte de respuestas antiguas. `listLocationsShared`: caché compartida de 30 segundos.
- `dashboardService.listSalesByRange`: consulta de `sales` por ubicaciones autorizadas, `status=active` y `createdAt >= inicio, < fin`; grupos de diez ubicaciones; caché de 60 segundos y deduplicación por ID. No consulta facturas. Índices de ventas ya declarados.
- `dashboardService.listActivityPage`: consultas separadas a ventas, auditoría y movimientos de stock. Se eliminará su uso en el Panel, conservando el servicio y el módulo Actividad.
- `domain/dashboard.js`: resumen y series temporales compartidas con ubicación; excluye anuladas/eliminadas y deduplica. `domain/payments.js`: configuración central `credit`, `debit`, `alias`, `cash` y `salePaymentParts` para cobros múltiples; Métricas ya reutiliza este desglose.
- Alertas: `GenericModulePage` y colección central `alerts`; registros con `active`, `deleted`, `status`, `name`, `notes` y fechas. No hay un generador de alertas de umbrales ni contrato cerrado de severidad/origen en esta base. El Panel consumirá esta misma colección; no generará alertas desde inventarios.
- Componentes reutilizables: HeroBanner, Panel, StatCard, ChartContainer, Skeleton, EmptyState, Modal, Button, Badge y navegación Link.

## Decisiones de adaptación

Se conservarán estructura, rutas, filtros y flujos existentes. Todos los indicadores comerciales y pagos usarán la misma respuesta de ventas del período. Las alertas operativas mostrarán pendientes actuales, independientemente del período histórico; esta distinción será visible. Se priorizarán críticas/rojas, preventivas/amarillas y resto, con enlace al origen cuando el registro lo permita y los permisos autoricen; en otro caso, al módulo Alertas.

No se modificará ARCA, ni se sumarán facturas a ventas, ni se crearán agregados o colecciones nuevas. No se implementará el futuro asistente, comparaciones analíticas ni promedios por calendario operativo propios de Métricas.

## Cambios realizados y archivos afectados

| Archivo | Cambio |
| --- | --- |
| `src/gestion/pages/DashboardPage.jsx` | Saludo por hora de Buenos Aires; eliminación de la actividad y sus consultas; pagos del mismo dataset; campanita en el encabezado y alertas debajo de ritmo/formas de pago; módulos disponibles durante loading/error; reintentos controlados; picker de stock con loading/error y revalidación del estado operativo al navegar. |
| `src/gestion/dashboardPresentation.js` | Selectores de saludo y distribución de cobros. Reutiliza `summarizeSales`, configuración central y `salePaymentParts`. |
| `src/gestion/components/DashboardPayments.jsx` | Barras de participación, alternancia porcentaje/monto y consulta del segmento por mouse/teclado; categorías con cero; estados vacíos e información de cobros sin clasificación. |
| `src/gestion/components/DashboardAlerts.jsx` | Campanita con contador y desplegable animado; resumen de seis alertas debajo de pagos; grupos rojo/amarillo/verde, estados propios y enlaces autorizados. Ambas vistas reciben el mismo resultado de la única consulta del Panel. |
| `src/gestion/services/alertsService.js` | Lectura de la colección configurada por el módulo Alertas, sólo `active=true`, caché compartida de 30 segundos y solicitudes simultáneas deduplicadas. Para no administradores se consulta su `responsibleId`, conforme a las reglas existentes. |
| `src/modules/alerts/domain/alerts.js` | Exclusión de cerradas/eliminadas, prioridad estable y resolución del contexto. Agrupación compartida crítica/preventiva/aviso. Sin severidad se presenta un aviso verde; no se asigna criticidad por un umbral inventado. |
| `src/gestion/services/dashboardService.js` | Invalidación explícita de caché para reintentar; consultas de ventas y servicio de Actividad conservados. |
| `src/styles/dashboard-filters.css` | Controles y alertas accesibles, tokens existentes, barras con escala y etiquetas espaciadas en pantallas pequeñas. |
| `tests/dashboard-summary.test.mjs` | Pagos múltiples, facturadas, descuentos, anulaciones, deduplicación, rangos, ausencia de ventas, priorización y navegación por permisos. |
| `tests/dashboard-services.test.mjs` | Adaptador Firestore en memoria: constraints, costo/caché, permisos, agrupación, origen central de alertas, errores y reintentos. No conecta servicios reales. |
| `tests/admin-experience.test.mjs`, `tests/management-ui.test.mjs` | Actualización de expectativas anteriores de actividad en el Panel, según H.8; el módulo Actividad conserva su paginación y presentación. |
| `docs/PANEL-GENERAL.md` | Auditoría, decisiones, validaciones y pendientes. |

La respuesta comercial lleva una clave del alcance/fechas. Durante un cambio de filtro no se muestran cifras de la consulta anterior bajo el nuevo período. Cantidad, facturación, ticket, ritmo y pagos derivan exclusivamente de la misma lista de ventas únicas, activas y no eliminadas. Una venta con comprobante autorizado sigue contando una vez por su `sale.total`, después de descuentos. No se leen ni suman facturas.

Los pagos mantienen los identificadores y etiquetas centrales actuales (`credit`, `debit`, `alias`, `cash`). `multiple` se reparte por sus montos guardados y no constituye otra categoría de cobro. Un importe sin método conocido se muestra como «Sin forma de pago identificada»; un desglose superior al total se señala sin corregir ni redistribuir silenciosamente sus datos.

Las relaciones implementadas de alertas son `locationId` y contexto de stock (`productId`, `type`/`entityType` de stock). Sólo se navega si el usuario puede consultar esa ubicación y, para stock, tiene `viewStock`. Para alertas genéricas o relaciones desconocidas se abre `/gestion/alerts`; no se siguen URLs arbitrarias de registros.

## Firestore y costo

- Ventas: se conserva el rango exclusivo final y los grupos de diez IDs. Para N ubicaciones son `ceil(N / 10)` consultas sobre las ventas del período, con caché de 60 segundos. Una selección vacía no hace lecturas. No se limita arbitrariamente el número de ventas, porque truncar daría cifras incorrectas.
- Ubicaciones: se conserva la caché compartida de 30 segundos y los permisos existentes. El historial puede incluir ubicaciones inactivas; el selector de carga sólo admite activas actuales.
- Se eliminan del Panel las consultas extra de Actividad a ventas, auditoría y movimientos: aproximadamente tres consultas por grupo de ubicaciones, con hasta siete documentos por fuente cuando no había filtro de tipo (más cuando lo había).
- Pagos: cero consultas adicionales. Se calculan a partir de las ventas ya leídas.
- Alertas: una consulta de pendientes `active=true`, con caché de 30 segundos; no vuelve a consultar al cambiar día/mes o ubicaciones comerciales. Para responsables se agrega la igualdad `responsibleId`. Son campos de la colección existente y no requieren una colección nueva.
- Se ordenan todas las alertas activas antes de recortar a seis en la UI. Limitar por recencia antes de ordenar podría ocultar una crítica antigua. El costo depende del volumen de pendientes activos, no de todo el histórico; si crece considerablemente, la futura definición central de severidad permitirá estudiar paginación por prioridad e índices. No se agregó esa denormalización sin contrato funcional.
- `dailySummaries` está declarada como colección del módulo genérico de Métricas; esta base no tiene un generador ni un contrato de agregados que garantice las mismas fechas, ubicaciones y cobros del Panel. No se usó como una segunda fuente con cifras posiblemente inconsistentes.

## Validación

- Suite completa `node --test tests/*.test.mjs`: **445 tests pasados**, sin fallos ni skips. Incluye los tests existentes de ARCA, vendedor, ubicaciones, stock, Métricas y Actividad, además de los nuevos tests del Panel.
- Suite focalizada del Panel (`dashboard-summary`, `dashboard-services`, `dashboard-filters`): **22 tests pasados**.
- Lint focalizado con ESLint: sin errores de variables, referencias, claves duplicadas, código inalcanzable o condiciones constantes en los archivos cambiados.
- Typecheck focalizado con TypeScript 5.9.3, `allowJs/checkJs`, sin emisión: **0 errores** en los nuevos selectores y servicio de alertas. La base es JS/JSX y no tiene `tsconfig`, scripts de lint/typecheck ni tipos declarados para todas las props del design system. Una comprobación ampliada de JSX/servicios antiguos detecta errores heredados de inferencia (props opcionales interpretadas como obligatorias y tipos de constraints); no se hizo una migración global fuera del alcance. Los componentes también se verifican por compilación y smoke real de navegador.
- Builds `npm run build`, `npm run build:gestion` y `npm run build:ecommerce`: correctos. Continúa la advertencia existente de chunks superiores a 500 kB.
- Smoke ligero de componente en Edge headless, con componentes/routing/hooks/CSS reales y adaptadores de lectura sintéticos: navegación a Venta Rápida y stock, picker sólo activo, día/mes, monto/porcentaje, alerta crítica al stock, selección vacía, sin ventas, fallo de ventas, fallo de alertas y recuperación. Sin errores JavaScript. Vista y modales comprobados a 1366/768/390/320 px sin desbordes horizontales; capturas desktop/mobile revisadas visualmente.
- ARCA: su suite específica pasó **113 tests**. Se compara el diff contra `e548672` de servicios, dominio fiscal, impresión, Functions y librería ARCA: **sin modificaciones**. Los puntos de entrada fiscales permanecen intactos y sus imports compilan con Gestión. No se emitieron comprobantes ni se hicieron pruebas fiscales productivas para esta tarea.
- Las herramientas de QA temporal y capturas quedan fuera del commit; no se agregan dependencias runtime ni se publica un despliegue desde esta tarea.

## Pendientes y riesgos conocidos

1. El futuro asistente de H.2 necesita diseño de alcance/permisos; no existe un acceso previo en la base y no se inventó uno operativo.
2. Alertas todavía tiene una superficie genérica: la generación automática por umbrales de stock, el contrato formal de severidad y las relaciones para orígenes distintos de ubicación/stock corresponden a la evolución del módulo central. No se crearon alertas derivadas desde inventarios en el Panel.
3. Las alertas creadas por el módulo actual tienen `active=true`. Registros antiguos que carezcan de ese campo requieren una revisión/migración central explícita; no se recorrió todo el histórico ni se reescribieron datos para inferirlo. Resueltas deben desactivarse para evitar lecturas innecesarias aunque el selector ya las excluya.
4. Para roles no administradores sólo se muestran alertas asignadas explícitamente. Las reglas actuales también permiten registros sin `responsibleId`, pero Firestore no autoriza una query amplia que pueda incluir otros responsables; la consulta segura no inventa permisos ni cambia reglas para ampliar ese alcance.
5. Las cachés pueden demorar hasta 60 segundos (ventas) y 30 segundos (ubicaciones/alertas) la incorporación de cambios de otro usuario. Los reintentos por error invalidan ventas y ubicaciones; no se agregaron listeners ni agregados nuevos.
6. Períodos largos o volúmenes altos todavía leen todas las ventas del rango necesario. No se introdujo un resumen persistido de integridad desconocida. Los promedios por horarios, feriados y comparaciones históricas pertenecen a Métricas, no al Panel.
7. El smoke usa datos sintéticos y valida el Panel y su navegación; no sustituye una prueba con la sesión administrativa real y el despliegue efectivo de índices/permisos en Firestore. No se ejecutó E2E pesado ni se escribieron ventas/stock/alertas reales.

## Ajuste visual solicitado — campanita de alertas

- Se agregó una campanita en la esquina superior derecha del encabezado, también visible en móvil. Su contador representa todas las alertas activas autorizadas, no un estado de «no leídas». El color del contador responde a la prioridad más alta disponible; cero pendientes no muestra una insignia y un error se indica con `!`, sin fingir ausencia de alertas.
- El desplegable muestra críticas/rojas, preventivas/amarillas y avisos/verdes. Los grupos vacíos se omiten. Abre con una transición breve y un movimiento de la campana; respeta `prefers-reduced-motion`. Reutiliza `AnchoredPopover`, con posicionamiento portal, cierre al tocar afuera o Escape y devolución del foco. La lista tiene scroll interno para volúmenes altos.
- El bloque de Alertas activas quedó debajo de la fila de Ritmo de ventas/Formas de pago y antes de Tus módulos. Comparte agrupación, contenido y errores con la campanita; el resumen conserva las seis de mayor prioridad y el desplegable permite consultar todos los pendientes cargados.
- `useAsyncData(listActiveAlerts)` se elevó a `DashboardPage`; abrir/cerrar la campanita y cambiar día/mes no ejecuta otra consulta. Se conserva la caché central de 30 segundos. No se introdujeron listeners, marcas de lectura, bajas automáticas ni un sistema paralelo de notificaciones. La actualización de alertas conserva el comportamiento de carga/reintento del Panel y no promete recepción en tiempo real.
- Los enlaces mantienen los permisos y relaciones de origen ya implementados. No se tocó el módulo ARCA, ventas, stock, servicios de pagos ni las reglas de Firestore.
- Verificación de esta revisión: 445 tests pasados, 22 focalizados, lint y typecheck focalizados sin errores; build de Gestión correcto con la advertencia heredada de chunks. Navegador integrado: contador, tres grupos, cero pendientes, error de consulta, cierre por Escape/exterior, navegación al stock y contador estable con día/mes; desplegable revisado a 320/390/1366 px y restauración del tamaño normal. En 320 px con barras de scroll de escritorio, el `body` global heredado conserva `min-width:320px`; el desplegable cabe dentro del ancho útil y en 390 px no desborda. El smoke visual usa datos sintéticos y destinos de prueba, sin escribir datos reales. Diff fiscal respecto a la base ARCA: vacío.
