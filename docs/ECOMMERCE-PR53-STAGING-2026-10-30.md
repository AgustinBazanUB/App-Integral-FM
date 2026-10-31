# PR #53: canal remoto de pruebas configurado

Fecha local: 30/10/2026. Proyecto único de estas operaciones: `app-integral-fm-pruebas`.

El usuario pidió configurar el canal remoto y posteriormente indicó dejar las pruebas ARCA para una futura instancia en producción. En esta continuación no se ejecutó WSAA, WSFE, solicitud de CAE ni emisión fiscal; tampoco se modificaron variables ARCA ni producción.

## Aislamiento comprobado antes de escribir

- El build de la tienda separada utiliza la configuración web completa de `app-integral-fm-pruebas`.
- El catálogo servido por las Functions del PR identifica ese mismo proyecto y realiza lecturas administrativas exitosas. Su adaptador comprueba la pertenencia de la cuenta de servicio al proyecto antes de acceder a Firestore.
- La API administrativa de Firebase Authentication confirmó `projects/545036860675/config`, correspondiente al proyecto de pruebas.
- La API de Firestore confirmó `projects/app-integral-fm-pruebas/databases/(default)`.
- Los cambios de datos se ejecutaron con la sesión existente de Firebase CLI, mediante URLs restringidas explícitamente al proyecto de pruebas. La configuración y los fixtures se crearon en un único commit con precondiciones `exists:false`; no se sobrescribió un canal anterior.
- Se publicó solamente `firestore:rules`, con `--project app-integral-fm-pruebas --config firebase.staging.json`. El CLI confirmó la compilación y la publicación. No se desplegaron reglas productivas ni se modificaron índices.

## Configuración aplicada

| Recurso | Configuración de QA |
|---|---|
| Canal | `channels/ecommerce`, activo, esquema 1 |
| Origen físico | `locations/qa-pr53-location`, «QA PR53 - Local ficticio - No despachar» |
| Dirección de retiro | «Calle de Prueba 123, CABA - Direccion ficticia»; no corresponde a un establecimiento real |
| Producto | `products/qa-pr53-oil`, «Aceite QA PR53 - No despachar» |
| Precio e IVA | ARS 1.000 por unidad; IVA 21 % |
| Stock | 20 unidades artificiales en `locationStock/qa-pr53-location/items/qa-pr53-oil` |
| Retiro | Habilitado en el origen ficticio |
| Entrega | CABA, código postal 1000, ARS 500, IVA 21 % |
| Transporte predeterminado | Manual; no se convocó ni asignó a ningún transportista |
| Administradores autorizados | Los dos administradores activos preexistentes de staging |

El aprovisionamiento reutilizó el plan compartido `buildLocationStockLinePlan` para registrar el saldo inicial y su movimiento. La auditoría identifica al operador autenticado por Google/Firebase CLI como `project_operator`; no lo presenta como una sesión de un usuario administrativo de la aplicación. No se crearon cuentas, contraseñas ni credenciales, ni se modificaron los perfiles existentes. Se corrigieron etiquetas de estos fixtures que inicialmente tenían caracteres dañados por la codificación de la terminal.

Los documentos de esta campaña llevan `testData:true` y `qaCampaign:ecommerce-pr53-remote`. No se copiaron existencias, productos, ubicaciones ni clientes de producción. Tampoco se migró el snapshot de los emuladores.

## Pruebas reales en Google Chrome

Se usó el sitio público separado y sus proxies contra el backend del Deploy Preview del PR, con Functions y Firebase remotos reales. No se reemplazaron HTTP, Authentication ni Firestore con mocks.

| Caso | Resultado |
|---|---|
| Catálogo | `ready:true`; producto QA comprable, precio ARS 1.000 y disponibilidad inicial 20 |
| Checkout de entrega | Pedido `ecommerce_order_e0e77754-31af-44a6-ac12-2f12b0b45dd9`, total ARS 1.500, envío ARS 500, `pending_payment` / `pending`, factura `not_requested` |
| Checkout de retiro | Pedido `ecommerce_order_39e937e5-9b38-489d-a765-0bc69c3258a1`, total ARS 1.000, envío ARS 0, `pending_payment` / `pending`, factura `not_requested` |
| Consulta privada de entrega | Recuperó el mismo pedido y mostró «Envío a domicilio: Pendiente de confirmación» |
| Consulta privada de retiro | Recuperó el mismo pedido y mostró «Retiro en local: Pendiente de confirmación» |
| Clave incorrecta | Rechazada; eliminó visualmente el resultado de la consulta anterior |
| Lectura pública directa del stock | HTTP 403, sin exponer el documento operativo |

No se aprobaron pagos simulados remotos: el mecanismo de simulación está restringido al laboratorio local y Payway sigue pendiente. Estos dos checkouts remotos no se contabilizan como ventas ni como entregas completadas. La campaña anterior de 10 entregas + 2 retiros completados continúa siendo evidencia del laboratorio local, tal como se documentó originalmente.

## Conciliación y conservación

La verificación a las `2026-10-31T01:14:57Z` encontró:

- Dos pedidos pendientes, cada uno con una reserva de una unidad.
- Stock físico 20, reservado 2, disponible comercial 18.
- Un único movimiento inicial `qa-pr53-initial_qa-pr53-oil`, con ingreso artificial de 20 unidades.
- Cero ventas, fulfillments o facturas asociados a estos dos pedidos.
- Cero cobros, comunicaciones externas, solicitudes ARCA y escrituras productivas.

Los registros se conservaron en staging. Las reservas vencen a las `01:24:58Z` y `01:26:34Z` del 31/10; el catálogo y el backend descuentan únicamente reservas vigentes. El agregado conservador `reservedQuantity` se compacta al operar nuevamente sobre la reserva o mediante la gestión de vencimiento. No hay borrado TTL automático ni se ejecutó una limpieza de documentos.

Evidencia sanitizada: [staging-channel-verification.json](ecommerce-evidence-2026-10-30/staging-channel-verification.json). Las capturas 11, 12 y 13 muestran catálogo activo y ambos checkouts; la 14 muestra el seguimiento remoto con clave oculta. No se guardaron claves de consulta, tokens OAuth ni credenciales en la evidencia del PR.

## Ajuste y validación del código

La clave privada de consulta se renderiza ahora como un campo `password`, con autocompletado desactivado, para evitar mostrarla en pantalla. Se repitieron las **1100 pruebas Node**, todas aprobadas, y los builds de **Gestión y E-commerce** con la configuración de pruebas. Las **156 pruebas de reglas** aprobadas en la implementación anterior cubren el mismo archivo que se publicó en staging.

## Enlaces y estado final

- [PR #53](https://github.com/AgustinBazanUB/App-Integral-FM/pull/53), sin fusionar a main.
- [Gestión del preview](https://deploy-preview-53--appintegralflormia.netlify.app/gestion/ecommerce), con autenticación administrativa requerida.
- Tienda separada actualizada: https://6ae540a9a9c79311f69761d2--flor-mia-ecommerce-preview.netlify.app/productos

El nombre del sitio histórico `flor-mia-arca-homologacion` no acredita su entorno: su configuración actual declara `ARCA_ENVIRONMENT=production`. Sólo se inspeccionó metadato; no se usaron sus credenciales ni se cambiaron sus variables. Por decisión posterior del usuario, ARCA se dejó fuera de esta continuación. Esta decisión no ejecuta ni programa emisiones productivas.

Quedan para otra etapa el proveedor de pagos real, la configuración comercial real y la revisión fiscal que indique el usuario. No se publicó la rama a producción ni se mezclaron datos QA con el Firebase productivo.
