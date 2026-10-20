# Prueba manual del módulo de envíos — Preview 40

Fecha: 16/10/2026. Preview: https://deploy-preview-40--appintegralflormia.netlify.app/gestion/shipping

Resultado: ambos recorridos ficticios quedaron **Entregado** en el Firebase original, autorizado expresamente por el usuario. Se usó la sesión de administrador iniciada por el usuario y la interfaz del navegador. La comparación posterior de stock fue una lectura del backend, sin escrituras de diagnóstico. No hubo despacho físico, factura ARCA ni mensajes a clientes.

## Recorridos y controles realizados

| Caso | Resultado observado |
| --- | --- |
| Venta Rápida con envío | Validación de domicilio/preparador, venta y envío vinculados, origen Local Lavalle y una única salida de inventario. |
| Panel Vendedor | Solicitud registrada sin descontar stock; revisión con motivo; aprobación posterior desde Zapala conservando la atribución comercial de Local Lavalle. La sesión seguía siendo administrativa: este caso no acredita permisos de una cuenta real con rol vendedor. |
| Origen sin stock configurado | Aprobación desde Instal bloqueada; no produjo salida de inventario. |
| Preparación por QR | El QR exige elegir rol y autenticación/asignación interna. Se inició preparación y se marcó listo para retirar. |
| Etiquetas | Descarga A4 real, revisión visual y QR decodificado desde el PDF a 300 dpi. Reimpresión sin nuevo descuento. Vista previa y cierre del modal comprobados tras la corrección. No se envió una impresión física. |
| Incidencia de preparación | “No hay bolsas/cajas” con nota ficticia, alerta crítica, bloqueo de preparación, apertura desde notificación y resolución con motivo. |
| Reparto Manual | Retiro, reparto final, no entregado, reintento documentado, permiso nuevo y entrega con excepción supervisada. |
| Reintento | La credencial anterior quedó rechazada y se conservó la misma venta y el mismo movimiento de stock. La ubicación física se confirmó como parte de una simulación expresamente identificada, sin paquete real. |
| Repositorio | Retiro del origen → camino al repositorio → en repositorio → reparto final → entregado. Opera sin exigir dirección del repositorio. Primer tramo sin teléfono del cliente ni controles GPS. |
| Seguimiento del cliente | Enlace de sólo lectura emitido antes de salir del repositorio; mostró “En repositorio” sin ubicación, luego estado final y “Entregado”. |
| Credenciales | Reemplazo invalida permiso anterior. Abrir un enlace nuevo en la misma pestaña ahora cambia de credencial inmediatamente, sin recarga manual. |
| Geocerca sin configurar | Confirmar entrega fue bloqueado; la excepción supervisada quedó auditada con usuario y motivo. Ambos cierres usaron esta excepción. |
| GPS real | Usuario autorizó compartir ubicación con el Firebase original. Dos intentos devolvieron que el navegador no pudo obtener GPS. No se inventaron coordenadas: publicación, visualización y precisión reales quedan pendientes. |
| Stock final | Una salida de una unidad por cada pedido; etiquetas, incidentes, reparto, no entregado y reintento no agregaron salidas. No se encontraron documentos duplicados del producto en los dos orígenes examinados. |

## Registros reales para conciliación

Producto: **Aceite de Oliva Arbequina 500cc**, ID `L8s9aEkamI1o9ELJA1Jk`. Dos ventas de prueba de ARS 22.000 cada una, registradas como efectivo, total ARS 44.000 de prueba. No representan cobros físicos.

| Venta | Envío | Cliente ficticio | Origen real / stock |
| --- | --- | --- | --- |
| FM-FMLV-20261016-0011 | FM-E-EQ3XX7FN | PRUEBA QA ENVÍOS 40 - RÁPIDA | Local Lavalle: 567 → 566 |
| FM-FMLV-20261016-0012 | FM-E-CKWAH7GR | PRUEBA QA ENVÍOS 40 - VENDEDOR | Zapala: 50 → 49 |

Identificadores de envío:

- `shipment_ship_33b9318e69943b997f18835778a8a664a9ddd39d67fcd166`
- `shipment_ship_ace3c45a3c8029cbdcf359cb9e8848b6ce4382a110a172b9`

Movimientos de stock:

- `shipping_sale_ship_33b9318e69943b997f18835778a8a664a9ddd39d67fcd166_L8s9aEkamI1o9ELJA1Jk`
- `shipping_approval_shipment_ship_ace3c45a3c8029cbdcf359cb9e8848b6ce4382a110a172b9_L8s9aEkamI1o9ELJA1Jk`

Estos registros permanecen para revisión. **La anulación habitual de ventas vinculadas está bloqueada** para evitar restituir inventario al origen incorrecto. Cancelar un envío no revierte stock ni dinero. La limpieza requiere conciliación administrativa y movimientos compensatorios explícitos; no se ejecutó automáticamente.

## Hallazgos corregidos y verificados en el preview

- `ae38aac`: repositorio sin dirección obligatoria, seguimiento de estados previo al reparto final, actualización entre pestañas, distinción de preparadores con el mismo nombre y CSP para PDF.
- `c72c051`: el modal PDF se monta fuera del panel de detalle para que no quede inactivo; se comprobó apertura y cierre.
- `50e59ca`: stock leído del servidor y refrescado al operar; se oculta/cierra la revisión pendiente al aprobar; nombres legibles del historial.
- `be42f20`: los portales públicos reinician su acceso al cambiar la credencial del enlace en la misma pestaña; permiso antiguo rechazado y nuevo aceptado sin recargar.

## Validación y límites

978 pruebas de regresión y 25 específicas de envíos aprobadas. Compilación de gestión aprobada tras el último cambio funcional. Los checks de GitHub del commit `be42f20` (test-build y arca-test-build) y el Deploy Preview pasaron. Verificación anterior: 138 pruebas de reglas en emulador y UI sintética a 1440/390 px. Estas pruebas aisladas no sustituyen GPS real ni una sesión remota con rol limitado.

Pendientes antes de considerar completa la validación operativa:

- Probar GPS real en un teléfono, su visualización en seguimiento y el cese de publicación al finalizar. Este equipo no obtuvo posición.
- Configurar proveedor de mapa/geocodificación y los tres parámetros de geocerca si se pretende entrega por validación de ubicación. Actualmente funcionan enlaces externos a Google Maps y excepciones supervisadas.
- Repetir acceso y restricciones con una cuenta real de vendedor/preparador con permisos limitados; el navegador disponible estaba autenticado como administrador.
- Imprimir la etiqueta A4 al 100 % y escanearla físicamente.
- Conciliar los dos registros reales de prueba y su inventario antes de uso cotidiano.

No se fusionó el PR ni se publicaron reglas/índices globales de Firebase. El despliegue de producción continuó en `6aca5e4b5b5dbd00087adb1f`, commit `f8d9642ffb748606287ae975aaab3fcf9e51ae70` al verificar al finalizar las pruebas. Los previews pueden consumir tráfico y funciones aunque no tengan cargo de publicación.

## Evidencia local

Carpeta ignorada por Git: `tmp/shipping-manual-preview-40/`. Contiene capturas numeradas 01–13 (incluidos hallazgos previos a corregir), PDF y render de etiqueta, `pdf-verification.json`, `stock-proof.json` y salidas de tests/build. No se guardan credenciales temporales en el informe ni se versionan enlaces privados.

Capturas finales: `12-tablero-entregados.jpg`, `11-entrega-manual-con-reintento.jpg` y `13-seguimiento-entregado.jpg`.

## Actualización 20/10/2026 — validación en Firebase de pruebas

Se repitieron los recorridos en el Deploy Preview 40 conectado a `app-integral-fm-pruebas`. Esta sesión usó registros y productos ficticios de staging; no se hicieron escrituras en Firebase de producción. Los registros de prueba se dejan en la base de staging para que el usuario pueda revisarlos.

| Caso | Resultado observado |
| --- | --- |
| Venta Rápida con envío | `FM-QAENV-20261020-0001`: se creó la venta y el envío desde Venta Rápida. El stock de la ubicación de prueba se descontó una vez al registrar la venta. |
| Reparto con repositorio | Se confirmaron retiro del origen y recepción en el repositorio; el portal no exigió una dirección para el repositorio. El acceso del segundo tramo mostró el destino ficticio y habilitó GPS para el recorrido al cliente. |
| GPS real | Tras habilitar Ubicación del equipo y permitir el sitio en Chrome, “Reintentar compartir ubicación” obtuvo una posición real. El portal confirmó el envío al seguimiento (precisión reportada entre ±117 m y ±180 m); el enlace público mostró ubicación disponible durante el reparto. No se guardan coordenadas en este documento. |
| Geocerca y excepción | La entrega quedó bloqueada porque el domicilio de prueba no tiene geocerca. Con autorización expresa del usuario, se concedió desde administración una excepción temporal, con motivo de prueba ficticia; el evento quedó auditado con el usuario administrador de pruebas. |
| Cierre y privacidad del GPS | El repartidor confirmó la entrega. Su portal indicó que el GPS se detuvo. Tras actualizar el enlace público, el pedido apareció como entregado, sin señal activa y sin exponer la última posición; administración reflejó el mismo estado. |
| Panel Vendedor | `FM-QAENV-20261020-0002`: la solicitud no descontó stock; luego de la aprobación administrativa el detalle indicó “Stock: Imputado una vez”. La operación se probó con el usuario administrador temporal en la vista del Panel Vendedor, no con una cuenta real de vendedor. |
| QR interno de preparación | El acceso mostró “Cargando” durante unos segundos y luego abrió el pedido asignado. “Pedido preparado y listo para retirar” lo pasó a “Listo para retirar”. El stock siguió en 18 unidades, así que preparar no volvió a descontar. |
| Etiqueta de staging | La selección y vista previa A4 mostraron el pedido ficticio y su QR. En esta sesión no se comprobó la descarga del PDF ni una impresión física. |

La prueba GPS confirmó que la posición del dispositivo se publica en el recorrido final y que el cliente deja de verla al entregar. La validación no demuestra geocercado del domicilio: el ambiente de prueba no tiene coordenadas configuradas para ese destino y la entrega se terminó mediante la excepción supervisada autorizada. El panel de administración mostró dos ventas ficticias por ARS 1.000 cada una y 18 unidades de stock después de ambos descuentos; la preparación del segundo pedido no agregó otro movimiento. El acceso del repartidor y el seguimiento público permanecen abiertos en Chrome para inspección.
