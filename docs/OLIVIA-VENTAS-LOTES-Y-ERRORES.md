# Olivia: panel compacto, consultas largas y ventas por lista

Implementación en la preview de PR #37. No promueve cambios a main ni registra ventas de prueba en los datos reales.

## Interfaz compartida

La cabecera mantiene Olivia, Asistente de Flor Mía y las opciones. El panel del usuario queda debajo del nombre; un punto y un estado breve indican Listo, Pensando, Por confirmar o Error. El modo desarrollador sigue disponible en un botón de la cabecera para administradores.

El chat aprovecha el espacio liberado por las filas de estado y consumo. Se conservan próxima consulta escrita estimada y última llamada, en dos columnas pequeñas. Se retiran la aclaración de confirmación bajo el campo de texto, el consumo ilimitado del administrador y el párrafo de costos. Las cuotas limitadas siguen visibles. La conversación por voz permanece pausada; el aviso rojo de buen contraste se retira tres segundos después del último toque. El dictado continúa disponible. Se aplica al mismo frontend en navegador y escritorio.

## Consultas largas y recuperación

Antes se recortaba cada mensaje a 2.000 caracteres al enviarlo al modelo. Ahora conserva hasta 12.000 caracteres, con el mismo límite en campo de texto y servidor. La memoria/historia mantiene sus límites generales.

El chat escrito crea un trabajo autenticado e idempotente en `oliviaChatJobs` y lo despacha a `olivia-chat-background`. La función en segundo plano guarda avances y resultado; el cliente consulta el estado con solicitudes cortas y recupera cortes transitorios sin reenviar el mensaje. Al volver a abrir un chat recupera su trabajo vigente. Ningún token, credencial ni perfil completo se guarda en el trabajo. La propiedad, sesión de acceso y alcance de permisos se revalidan al consultar y cancelar.

El presupuesto de procesamiento es de cinco minutos, con hasta 90 segundos por llamada al proveedor; el trabajo vence a los seis minutos para recuperar también una invocación perdida. Se reservan cuotas y costos para la salida acotada de hasta al menos 6.000 tokens; el estimado escrito utiliza ese mismo límite. Se conservan límites de rondas/herramientas, control de cuotas y medición. Los estados de espera describen procesamiento y herramientas, sin exponer razonamiento interno. Si finalmente falla, muestra una explicación coloquial y conserva el reporte. Detener invalida la consulta para que una respuesta tardía no publique una propuesta. Un mensaje de corrección invalida la tarjeta anterior desde el encolado; una aceptación escrita conserva la tarjeta y nunca ejecuta la venta.

Las funciones background de Netlify permiten trabajo separado del request del navegador: [documentación oficial](https://docs.netlify.com/build/functions/background-functions/). La preview publica esta función junto con el backend existente.

## Ventas múltiples

`prepare_batch_sales` prepara hasta 20 ventas y 100 renglones de productos en una sola tarjeta. Cada venta conserva referencia, canal, origen físico, productos, cantidades, pago, descuentos y decisión sobre cliente/ticket. Los datos faltantes se piden por número de venta; no se inventan pagos, descuentos, precios ni decisiones comerciales.

El vendedor usa ubicaciones asignadas y canal presencial, igual que su panel. El administrador usa los canales WhatsApp, Instagram, teléfono y presencial de Venta Rápida; puede elegir ubicación o depósito cuando sus permisos lo permiten. Se usan precios vivos y el mismo `buildOperationalSalePlan` del flujo manual. Depósitos rechazan cantidades acumuladas insuficientes; ubicaciones conservan la política de stock negativo advertido y auditado. La emisión fiscal se deriva al flujo manual ARCA.

La preparación no escribe ventas ni stock. La confirmación revalida perfil, permisos, ubicación/depósito, productos, descuentos, clientes, stock y contadores en una transacción. Los renglones comparten stock acumulativo y numeración, y consolidan cada documento de stock/contador antes del commit. Las lecturas se paralelizan de a tres; la planificación permanece secuencial. Cancelar o fallar cualquier validación deja toda la lista sin registrar. Confirmaciones repetidas devuelven el mismo resultado.

## Reportes para Agustín

El backend crea un diagnóstico privado en `oliviaErrorReports` al detectar un fallo, incluyendo los fallos de herramientas y consultas. El usuario ve una explicación breve y un botón **Enviar error a Agustín**; solamente ese toque publica la alerta. El cliente no puede aportar JSON técnico ni elegir destinatario.

El servidor identifica la cuenta activa `agsreserva@gmail.com` con rol administrador/general administrador, y vuelve a comprobar correo, estado y rol en la transacción. No selecciona por nombre: dos usuarios pueden llamarse Agustín. La alerta se asigna al ID de esa cuenta, incluso cuando ella misma reporta el fallo. Incluye nombre/código, usuario que intentó la acción (nombre, ID y rol), JSON de diagnóstico y descripción para pegar en Codex. Incluye operación, fecha, identificadores y ubicaciones de código, sin mensajes, credenciales, teléfonos ni datos de clientes. Si el destinatario no está disponible o hay cuentas duplicadas con ese correo, conserva el diagnóstico y explica el problema sin reemplazar el error original de Olivia.

Enviar dos veces crea una sola alerta. Reportes ajenos, vencidos o de otro acceso se rechazan. El historial conserva el botón del error al recuperar la conversación. Panel general y Alertas reciben actualizaciones autorizadas en vivo; el administrador abre **Ver error** y **Copiar para Codex**. El usuario común no recibe el JSON técnico.

Ambas colecciones nuevas están cerradas al cliente por reglas explícitas y por la denegación general existente. La retención programada elimina los trabajos/diagnósticos privados vencidos a los 30 días. Las alertas enviadas mantienen el ciclo de revisión del módulo Alertas. Netlify publica Functions; la infraestructura Firebase versionada sigue su despliegue independiente.

## Verificación

Pruebas automatizadas cubren consultas largas sin recorte, autenticación y recuperación de trabajos, idempotencia, cancelación, fallos antes/durante procesamiento, expiración, compatibilidad de chats previos, estado temporal de voz, acumulación de stock/contadores, lotes y confirmación doble, permisos, cancelación/contexto cambiado, privacidad/propiedad de reportes, destinatario verificado, alerta única, actualizaciones autorizadas y retención. Las ventas y alertas de pruebas usan adaptadores en memoria; no se envían alertas reales a Agustín.
