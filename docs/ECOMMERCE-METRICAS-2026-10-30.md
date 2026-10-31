# Dashboard único de métricas de ventas

El módulo abre por defecto en **Ventas generales**, con las métricas y gráficos comerciales comunes. El panel adicional de e-commerce y los indicadores de participación web se retiraron por la aclaración del usuario. Las capturas 15 y el primer registro de métricas quedan como evidencia de una versión anterior; las capturas 16 y 17 muestran la estructura vigente.

## Filtros vigentes

Arriba del período aparece **Tipo de venta**, con cuatro opciones:

- **Ventas generales:** todas las ventas válidas, una sola vez.
- **Ubicaciones:** ventas presenciales. A la derecha permite elegir tipo de ubicación —Local, Feria, Evento y tipos históricos existentes— y una o varias ubicaciones. Los eventos inactivos siguen disponibles para analizar su historial.
- **Página web:** acceso directo a las ventas web, sin elegir otro subconjunto.
- **Canales:** ventas por canales de contacto. A la derecha permite seleccionar uno o varios, como WhatsApp, Instagram y Llamada.

Debajo del período quedan únicamente **Vendedores, Productos, Descuentos y Forma de pago**. La categoría de producto permanece dentro del selector Productos. No se duplica Ubicaciones en esa fila.

Cambiar de origen limpia las selecciones de ubicación/tipo/canales y conserva período y filtros comunes. Todas las vistas presentan las mismas métricas: total vendido, cantidad de ventas, unidades, ticket, descuentos y los gráficos/desgloses del informe. No hay participación web ni métricas de visitas en este dashboard.

## Criterio comercial y compatibilidad

Se conserva la fuente única `sales`, la deduplicación y la exclusión de simulaciones, eliminadas, anuladas y snapshots web pendientes o rechazados. Pedidos y comprobantes no se suman como nuevas ventas.

Cada venta se clasifica en un origen comercial: e-commerce por sus referencias `sourceChannel`, `channelId` o `sourceType`; presencial por `in_person` y registros históricos `manual`/sin canal; los otros canales identifican ventas por contacto. El origen del inventario es un dato independiente: una compra web abastecida desde un local sigue siendo una venta web. No se reescribieron documentos históricos.

Las vistas generales incluyen los registros históricos sin ubicación recuperable; al elegir tipo o ubicaciones concretas se restringen a documentos identificados. El servicio conserva el alcance permitido de cada usuario. El acceso anterior `?channel=ecommerce` abre directamente Página web.

## Verificación

**1107 tests Node aprobados**, con siete pruebas específicas de categorías comerciales, conciliación, tipos y selecciones múltiples, limpieza de filtros ocultos, referencias históricas y exclusión de simulaciones/pagos pendientes. Build de Gestión aprobado. No se modificaron reglas ni credenciales.

Chrome real contra emuladores locales confirmó:

| Vista | Total | Ventas | Unidades |
|---|---:|---:|---:|
| Ventas generales | $7.000 | 5 | 6 |
| Ubicaciones, todas | $2.000 | 2 | 2 |
| Feria | $1.200 | 1 | 1 |
| Evento | $800 | 1 | 1 |
| WhatsApp e Instagram | $2.000 | 1 | 1 |
| Página web | $3.000 | 2 | 3 |

Se verificó selección múltiple de ubicaciones, cambio de tipo, selección múltiple de canales, ausencia de subconjuntos web, cuatro filtros comunes y regreso al total general sin filtros ocultos. Los tres orígenes suman $7.000 sin duplicaciones.

Los ejemplos son fixtures analíticos artificiales, marcados `testData:true`, creados sólo en los emuladores. No representan cobros reales, no alteraron stock y no se copiaron a Firebase remoto. ARCA y producción permanecieron sin modificaciones.

Evidencia: [vista general](ecommerce-evidence-2026-10-30/16-metricas-generales.jpg), [ubicaciones](ecommerce-evidence-2026-10-30/17-metricas-ubicaciones.jpg) y [conciliación de Chrome](ecommerce-evidence-2026-10-30/metrics-sections-ui-verification.json).

[Revisar el dashboard en el Deploy Preview](https://deploy-preview-53--appintegralflormia.netlify.app/gestion/metrics/sales), con autenticación y Firebase de pruebas. Sus pedidos pendientes no generan ingresos; los importes positivos de la tabla corresponden sólo al laboratorio local.

## Actualización del 31/10/2026

El acceso de métricas salió de la tarjeta duplicada del módulo de e-commerce y quedó dentro de **Configuración e-commerce**. Ese enlace abre este mismo dashboard con **Página web** seleccionada; la ruta base sigue abriendo **Ventas generales**.

Los pedidos con envío ya registrado abren su detalle en Gestión de envíos. Los pedidos sin envío mantienen la gestión del pago dentro de e-commerce. En Gestión de envíos, **Retiro en local** agrupa los pedidos de retiro y usa la secuencia preparar → listo para retirar → confirmar código del cliente. Un pedido web aún no entregado puede cambiar entre retiro y domicilio manual antes de la entrega; la operación conserva el total pagado y no inicia cobros, devoluciones ni salidas nuevas de stock.

Chrome local, 31/10: el registro sintético `QA-PR53-FULFILLMENT` se convirtió de domicilio a retiro y nuevamente a domicilio; luego recorrió preparación, aviso de listo y retiro confirmado. El pedido conservó total 1.500 y envío 500. El emulador empleado es `app-integral-fm-pruebas`; no se realizaron escrituras en producción ni llamadas a ARCA. La suite logística aprobó 46 pruebas y el build de Gestión terminó correctamente.

Evidencias: [retiro completado en QA](ecommerce-evidence-2026-10-30/19-pr53-retiro-completado-qa.png) y [dashboard general en QA](ecommerce-evidence-2026-10-30/20-pr53-metricas-generales-qa.png).
