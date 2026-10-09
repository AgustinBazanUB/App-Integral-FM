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

Los valores actuales de ARCA en Netlify están limitados a `production`; un
Deploy Preview necesita su propia configuración server-side. No alcanza con
publicar el frontend para habilitar CAE.

## Verificación

- Suite de pruebas del proyecto y build Vite.
- Plan fiscal: sal a $5.000 menos $4.900 = $100; neto $82,64 + IVA $17,36,
  conservando el total para A y B.
- Resolución de RI, monotributo, exento, CUIT inválido, permisos y condición
  desconocida mediante servicios de prueba sin emitir CAE.
- QA visual con datos ficticios en escritorio, 390 px y 320 px: buscador,
  carrito, descuento, total y formulario por CUIT.

La QA visual usa archivos temporales ignorados por Git y bloquea las escrituras
comerciales. No demuestra emisión real. La prueba productiva solicitada consiste
en dos ventas de $100 (consumidor final y CUIT entregado por el usuario), con CAE,
`FECompConsultar` coincidente y PDF oficial; no debe informarse como completada
hasta obtener esos resultados.

## Preview y costos

La documentación actual de Netlify indica 0 créditos por publicaciones preview
y 15 por publicación de producción en planes con créditos. Tráfico, solicitudes
y cómputo siguen sujetos al plan. Se debe publicar un preview, sin `--prod` ni
merge a `main`, para revisar estos cambios.

Fuente: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
