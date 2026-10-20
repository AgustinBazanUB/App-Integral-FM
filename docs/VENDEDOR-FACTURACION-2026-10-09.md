# Panel vendedor y facturación · 9 de octubre de 2026

Base: `origin/main`, commit `9b412b3` (8 de octubre). Rama de trabajo:
`codex/vendedor-facturacion-cae`.

## Cambios

- Buscador «Buscar producto o catálogo», por nombre, abreviatura, categoría y
  subcategoría. Ignora acentos, abre los resultados y conserva la botonera.
- Texto del cuadrante de venta ampliado aproximadamente 20%, con contraste
  reforzado. Carrito más ancho en escritorio y controles táctiles conservados.
- Total, «Cargar factura» y «Continuar» en una barra a todo el ancho, siguiendo
  Venta Rápida. Se mantienen ubicación, permisos, pagos múltiples, clientes,
  descuentos y ventas pendientes; no se agregan canal ni retiro al vendedor.
- Formulario fiscal compartido con Venta Rápida: consumidor final o consulta
  por CUIT en ARCA. Un CUIT inválido no se consulta. Una condición no resuelta
  no se convierte automáticamente en consumidor final.
- Endpoint `arca-receiver`: sesión activa y permiso `quick-sales/requestTicket`;
  devuelve sólo nombre, condición IVA y datos del receptor para el comprobante.
  Los controles administrativos de `arca-taxpayer` siguen reservados a admins.
- En producción, la factura vuelve a resolver en servidor cualquier receptor
  identificado por CUIT. Conserva la autorización, idempotencia, correlatividad y
  verificación existentes. El servicio devuelve el resultado de auto-CAE a la UI.
- El permiso de solicitar facturas se verifica también en `arca-invoice`, además
  de la titularidad/origen de la venta.

Para el emisor responsable inscripto que ya soporta esta aplicación, las
condiciones 1/6/13/16 corresponden a A y 4/5/7/15 a B; monotributo no implica B.
No se fuerza una factura A por el solo hecho de ingresar un CUIT.

## Configuración necesaria

El diagnóstico del sitio publicado `appintegralflormia` mostró certificado y
clave productivos vigentes hasta septiembre de 2028, y datos del emisor listos
para PDF. Preparación, padrón de clientes, CAE y automatización estaban
deshabilitados. Esto explica por qué había facturas oficiales históricas pero
no podían emitirse nuevas.

La habilitación autorizada por el usuario requiere, en el entorno de ejecución
que se vaya a validar:

```
ARCA_ENVIRONMENT=production
ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE=true
ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP=true
ARCA_ALLOW_PRODUCTION_CAE=true
ARCA_AUTO_AUTHORIZE_PRODUCTION=true
ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=admin_quick_sale,seller_sale
```

El modo manual conserva su código de venta exacto. No deben modificarse ni
regenerarse certificado, clave privada o clave de cifrado del TA. Los secretos
permanecen en el servidor y no en variables `VITE_*` ni en el repositorio.

Los secretos de ARCA en Netlify están limitados a `production`. Para probar
sin copiar ni exponer las claves, se fijó la publicación existente y se creó
un deploy de contexto productivo que quedó **sin publicar**. Su URL de revisión
es `https://main--appintegralflormia.netlify.app/vendedor`.
Este deploy sí factura contra ARCA de producción. El dominio principal conserva
la versión anterior hasta una publicación autorizada.

La autorización del usuario habilitó los gates de preparación, padrón, CAE y
emisión automática, con fuentes `admin_quick_sale,seller_sale`. Se conservaron
el certificado, su clave privada y la clave de cifrado del TA ya configurados.

## Correcciones encontradas durante la prueba productiva

- WSFE negociaba un grupo DHE demasiado pequeño para Node/OpenSSL. El transporte
  exclusivo de ese endpoint excluye DHE, mantiene los cifrados admitidos por
  Node, exige TLS 1.2 o superior y verifica certificado y nombre del servidor.
  No desactiva TLS ni baja el nivel de seguridad de OpenSSL. No reintenta
  automáticamente una solicitud SOAP de autorización.
- El estado previo de ARCA tenía indicadores de CAE fijados a `false`; ahora
  muestra la configuración real del servidor.
- La respuesta del servicio frontend conserva `invoice.autoAuthorization`,
  donde el endpoint devuelve la autorización y su verificación.
- Un CUIL activo que el padrón devuelve sin inscripciones tributarias y sin
  errores permite consumidor final identificado, documento 86 y factura B.
  Una respuesta incompleta o un CUIT sin condición suficiente sigue bloqueada.
- El PDF identificado conserva el nombre recuperado del padrón y rotula CUIL.

## Verificación

- Suite de pruebas del proyecto y build Vite.
- Plan fiscal: sal a $5.000 menos $4.900 = $100; neto $82,64 + IVA $17,36,
  conservando el total para A y B.
- Resolución de RI, monotributo, exento, CUIT inválido, permisos y condición
  desconocida mediante servicios de prueba sin emitir CAE.
- QA visual con datos ficticios en escritorio, 390 px y 320 px: buscador,
  carrito, descuento, total y formulario por CUIT.

La QA visual usa archivos temporales ignorados por Git y bloquea las escrituras
comerciales. Se completó por separado la prueba productiva autorizada: dos ventas
de sal a $5.000, descuento de $4.900 y total $100, con CAE autorizado,
`FECompConsultar` coincidente y PDF descargable, revisado visualmente.
El padrón devolvió al receptor indicado como CUIL activo sin inscripción en IVA
ni monotributo; el comprobante correspondiente fue B, sin forzar factura A.
Los comprobantes reales y la evidencia con datos personales permanecen fuera
del repositorio. Las pruebas automatizadas usan identificadores ficticios.

## Preview y costos

La documentación actual de Netlify indica 0 créditos por publicaciones preview
y 15 por publicación de producción en planes con créditos. Un deploy productivo
sin publicar, mientras se mantiene fijada la publicación anterior, no consume
los 15 créditos de publicación. Tráfico, solicitudes y cómputo siguen sujetos
al plan. El deploy de revisión no publicó el dominio principal ni hizo merge
a `main`. Se dejó fijada su publicación para conservar esta condición.

Fuente: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
