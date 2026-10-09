# Descargar, imprimir y enviar facturas

Las facturas autorizadas, verificadas y con PDF disponible muestran tres acciones
en Venta Rápida, el comprobante del vendedor y su detalle fiscal:

- **Descargar PDF:** guarda el comprobante con su nombre fiscal.
- **Imprimir factura:** abre el PDF en una pestaña; usar la impresora del visor o Ctrl+P.
- **Enviar por mail:** pide un único correo del cliente y envía el PDF adjunto desde Flor Mía.

Estas acciones reutilizan la factura existente y nunca solicitan otro CAE.
El servidor verifica la sesión activa y los permisos sobre la venta. El PDF se
genera en el servidor; no hay enlaces públicos ni adjuntos arbitrarios del cliente.
La respuesta de éxito significa aceptación por el servidor SMTP, no lectura ni
entrega garantizada en la bandeja de entrada. No se reintenta automáticamente.
Los intentos se registran en colecciones privadas `invoiceEmailRequests` y
`invoiceEmailLimits` (denegadas por la regla general de Firestore). Un intento
repetido no se envía de nuevo y existe una pausa de un minuto por factura.

## Conectar Gmail

Configurar estas variables en Netlify, sitio `appintegralflormia`, contexto
**Production**, que utiliza el preview fiscal sin publicar. El plan actual no
permite elegir exclusivamente Functions; usar todos los scopes disponibles
(para secretos: Builds, Functions y Runtime), manteniendo las claves fuera de
variables `VITE_*`, código y otros contextos.

| Variable | Valor |
| --- | --- |
| `INVOICE_SMTP_HOST` | `smtp.gmail.com` |
| `INVOICE_SMTP_PORT` | `465` |
| `INVOICE_SMTP_USER` | Cuenta Gmail indicada por el titular (ya configurada) |
| `INVOICE_SMTP_FROM` | La misma dirección Gmail (ya configurada) |
| `INVOICE_SMTP_PASSWORD` | Contraseña de aplicación de Google; marcar como secreta |

El titular crea la contraseña de aplicación con verificación en dos pasos.
No usar la contraseña normal de Gmail ni guardarla en código, chat, archivos
locales o variables `VITE_*`. Luego actualizar exclusivamente el preview fiscal
manteniendo bloqueada la publicación principal. No ejecutar `--prod` ni hacer
merge a `main` sin una nueva autorización.

El remitente, host y puerto ya están configurados. `INVOICE_SMTP_PASSWORD` existe
como secreto sin valor; el titular debe pegar su contraseña de aplicación en el
campo Production y guardar. El modo `email-connection` del endpoint del documento
permite a administración verificar SMTP sin enviar correos; no expone respuestas
de autenticación ni credenciales. Se normalizan los espacios de las contraseñas
de aplicación agrupadas de Gmail.

Mientras falta la contraseña de aplicación, el modal informa que falta conectar la cuenta
y deshabilita el envío. Descargar e imprimir funcionan independientemente.

## Validación y preview

- 925 pruebas aprobadas y compilación Vite correcta.
- QA local con datos ficticios: modal desde el comprobante del vendedor,
  destinatario y aceptación SMTP simulada; pantalla de 390 px mediante iframe.
- PDF de las dos facturas reales existentes: descarga autenticada con
  `Content-Disposition: attachment`, verificación fiscal vigente y bytes idénticos
  a los PDFs originales. No se emitieron nuevas facturas ni se enviaron correos reales.
- Preview fiscal actualizado (URL inmutable):
  https://6ac90f972f49de57798392b9--appintegralflormia.netlify.app/vendedor
  El alias `main--` seguía apuntando a una versión anterior durante la revisión;
  usar el enlace inmutable para esta entrega.
- Producción mantiene su publicación anterior bloqueada. El deploy tiene contexto
  production para los secretos fiscales existentes, pero `published_at` es null.

Fuentes técnicas: [Google](https://support.google.com/accounts/answer/185833?hl=es),
[SMTP Nodemailer](https://nodemailer.com/smtp) y
[adjuntos](https://nodemailer.com/message/attachments).
