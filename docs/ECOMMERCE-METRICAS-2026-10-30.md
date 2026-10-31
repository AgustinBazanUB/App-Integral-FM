# Métricas de ventas de la página web

Se incorporó un resumen propio de e-commerce dentro de **Métricas generales → Historial y análisis de ventas**, en la actualización del PR #53.

## Comportamiento

- Cinco indicadores: total vendido web, cantidad de ventas, unidades, ticket promedio y participación en el total de los canales filtrados.
- Tabla por envío a domicilio, retiro en local o modalidad histórica no informada. Separa productos después de descuentos, cargos de envío y total vendido. Si un histórico no conserva ese desglose, lo informa sin inventar importes.
- «Ver sólo ventas web» aplica el canal al informe completo: evolución, formas de pago, productos, categorías, vendedores y orígenes. «Ver todos los canales» permite comparar nuevamente.
- El filtro web está disponible aun cuando el período no tenga ventas. El panel presenta un estado vacío explícito.
- «Actualizar ventas» vuelve a consultar los datos sin reutilizar la caché anterior de ventas. Se conserva el control de alcance del servicio: las consultas globales autorizadas incluyen orígenes de depósito y las selecciones explícitas limitan ubicaciones.
- Se reconocen ventas web por `sourceChannel`, `channelId` o `sourceType`, manteniendo la compatibilidad con registros históricos.

Las métricas siguen tomando **sales**, sin sumar de nuevo pedidos o comprobantes. Excluyen simulaciones, ventas eliminadas/anuladas y snapshots web con pago pendiente o rechazado. Las anulaciones se deduplican y no incluyen pedidos aún no pagados. Una venta histórica activa sin el campo de estado de pago conserva su compatibilidad.

## Verificación

**1105 tests Node aprobados**, incluyendo cinco casos nuevos de conciliación, identificadores históricos, filtros, exclusión de simulaciones/pagos pendientes y ausencia de desglose. Build de Gestión aprobado. No se modificaron reglas de Firestore.

En Google Chrome real, conectado a los emuladores locales del proyecto de pruebas, se verificaron tres fixtures analíticos artificiales:

| Caso | Total | Unidades | Envío |
|---|---:|---:|---:|
| Venta web con entrega | $2.500 | 2 | $500 |
| Venta web con retiro | $500 | 1 | $0 |
| Venta por WhatsApp | $2.000 | 1 | $0 |

Resultado observado: $3.000 web de $5.000 totales, dos ventas web, tres unidades, ticket $1.500 y participación 60 %. Al filtrar e-commerce, el informe general muestra $3.000 y participación 100 %. Se comprobó además el filtro sin ventas y la actualización manual. Las simulaciones de la campaña local anterior permanecieron excluidas.

Estos fixtures se crearon directamente en el emulador, marcados `testData:true` y `qaCampaign:ecommerce-metrics-pr53`, para probar cálculos sobre snapshots comerciales; no representan cobros ni ventas comerciales reales y no alteraron inventario. No se crearon ventas ficticiamente aprobadas en Firebase remoto. No se llamó a ARCA ni se modificó producción.

Evidencia: [captura de métricas](ecommerce-evidence-2026-10-30/15-metricas-ventas-web.jpg) y [conciliación del DOM de Chrome](ecommerce-evidence-2026-10-30/metrics-ui-verification.json).

## Revisión

[Métricas web del Deploy Preview](https://deploy-preview-53--appintegralflormia.netlify.app/gestion/metrics/sales?channel=ecommerce), con autenticación administrativa y Firebase de pruebas.

Los dos pedidos remotos pendientes de pago de la verificación anterior **no generan ingresos web**. El preview mostrará cero mientras no existan ventas confirmadas. El ejemplo con importes positivos corresponde exclusivamente al laboratorio local.
