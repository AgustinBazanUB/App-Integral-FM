# Olivia en el Sistema Integral Flor Mía

Olivia comparte un núcleo operativo entre Administrador y Vendedor, integrado al montaje autenticado de Gestión. Conserva los flujos manuales y carga su interfaz de forma diferida, con una barrera de errores independiente.

## Alcance implementado

| Capacidad | Administrador | Vendedor |
|---|---|---|
| Texto, dictado revisable y conversación de voz | Sí | Sí |
| Usuario actual y ubicaciones permitidas | Sí | Sí, según asignaciones vigentes |
| Productos, precios y stock actuales | Según permiso del módulo | Solo ubicación habilitada |
| Promociones | Según permiso | Las aplicables a su ubicación; la venta valida el carrito |
| Ventas de hoy | Según permiso | Exclusivamente propias, en hora argentina |
| Navegación y ayuda documental | Módulos permitidos | Vistas permitidas del Panel Vendedor |
| Preparar y confirmar ingreso positivo de stock | Sí, con permiso de carga | No |
| Preparar y confirmar venta básica | Con acceso al módulo | Sí |
| Configurar IA y supervisar consumo/historial | Administrador | No |
| Solicitar ampliación de cupo | Disponible | Disponible incluso con cupo agotado |

La venta solicita decisiones explícitas sobre medio de pago, promociones, factura y cliente. Reutiliza los planes comerciales del flujo manual: precios y stock actuales, descuentos, pagos múltiples, cliente, movimientos, código de venta y auditoría. Si requiere comprobante fiscal, deriva al Panel Vendedor/ARCA sin crear una venta parcial. El stock negativo de una ubicación conserva la política de la aplicación y se informa en la propuesta. No se habilita stock negativo de depósitos.

Las mutaciones fiscales, cambios de roles/permisos, credenciales, eliminación de ubicaciones y operaciones ajenas al catálogo siguen sus flujos manuales. La configuración de IA se edita mediante formulario administrativo, revisión explícita y reautenticación reciente; nunca mediante instrucciones del modelo.

## Núcleo y autorización

`src/shared/oliviaContracts.mjs` contiene contratos JSDoc, estados, esquemas cerrados, configuración y períodos. `netlify/functions/_lib/olivia` implementa autorización, consultas, propuestas, ejecución, transporte OpenAI, consumo y voz. El backend verifica el ID token con Firebase y obtiene el perfil activo desde Firestore; ningún UID, rol, permiso, precio o cantidad de stock proporcionado por el cliente reemplaza estos datos.

El contexto de pantalla solo contiene ruta, módulo, vista, filtros acotados e IDs. Es una sugerencia que se vuelve a autorizar. No se envía el DOM completo. Las herramientas vuelven a leer el perfil y validan los parámetros antes de consultar datos. No existe una herramienta de consultas arbitrarias a Firestore ni de ejecución libre.

Las conversaciones y confirmaciones se vinculan a usuario, conversación y `auth_time` del inicio de sesión. Un cambio de sesión requiere una conversación nueva. Las propuestas vencen a los cinco minutos, incluyen resumen canónico y huella de los datos leídos; corregir datos reemplaza la propuesta previa. Confirmar requiere la tarjeta visual con Sí/No. Un sí escrito o hablado no ejecuta.

La ejecución vuelve a validar permisos, precios, promociones, cliente y stock dentro de una transacción de Firestore. Cambios concurrentes rechazan la propuesta. Venta/carga, movimientos, auditoría y confirmación completada se escriben atómicamente. IDs deterministas y estado de confirmación impiden duplicar operaciones con doble clic o reintentos. La auditoría comercial conserva origen `Asistente IA / Olivia` y correlación de conversación, solicitud y confirmación.

Todas las colecciones `olivia*`, incluidos mensajes en subcolecciones, rechazan lectura y escritura directa desde clientes, incluso administrativos. Las claves OpenAI y Firebase Admin permanecen en variables privadas del servidor. Los resultados enviados al navegador no contienen credenciales del proveedor.

## Herramientas del modelo

El registro publica únicamente capacidades autorizadas: `get_current_user_context`, `list_locations`, `search_products`, `get_stock`, `get_promotions`, `get_today_sales`, `navigate_to_module`, `prepare_stock_load` y `prepare_sale`. La confirmación ejecutora no es una herramienta del modelo. Se permiten como máximo tres rondas de herramientas y cinco llamadas totales por consulta; llamadas idénticas se reutilizan dentro del turno. Una cuarta respuesta sin herramientas presenta el último resultado cuando la consulta requiere encadenar ubicación, producto y stock. Los datos incompletos, rechazos y errores de herramientas cierran el turno con su mensaje canónico.

La búsqueda de productos usa prefijos y un límite explícito, no una promesa de búsqueda exhaustiva. Consultas de ubicaciones, promociones y ventas también son acotadas y los resultados parciales se señalan. Ventas de hoy filtra por UID propietario, ubicación autorizada, día argentino y estado activo.

La ayuda documental proviene de 55 fragmentos revisados de la Solución Propuesta. Recupera como máximo cuatro por consulta y filtra primero por rol. Solo las herramientas obtienen datos comerciales vivos. [La auditoría funcional](OLIVIA-FUNCTIONAL-AUDIT.md) distingue decisiones definidas, pendientes y futuras; las preguntas abiertas de la documentación no se convierten automáticamente en reglas del producto.

## Audio y voz

El dictado permite grabar hasta 60 segundos y 4 MB, valida MIME/tamaño en backend, transcribe y deja el texto editable antes de enviarlo al núcleo. El audio no se guarda en Firestore. Texto vacío o ininteligible no prepara operaciones.

La conversación usa WebRTC. El backend intercambia SDP con OpenAI y conserva el ID de llamada; no entrega claves reutilizables al navegador. La transcripción real de cada intervención pasa por el mismo núcleo de texto y sus permisos. El modelo de voz lee el resultado del backend y no recibe herramientas comerciales ejecutoras ni tokens de confirmación.

`olivia-voice-meter-background` conecta un canal lateral autenticado del servidor, deduplica eventos de uso, impone límite de salida, cierra por cuota/error y aplica un máximo de 180 segundos. El navegador recibe SDP únicamente después de que el monitor se haya conectado. Cerrar la interfaz, perder conexión o finalizar voz detiene pistas y llama al endpoint de cierre. Una tarea programada reintenta cierres remotos pendientes.

La transcripción en vivo puede medirse por duración, y los modelos de voz tienen tarifas distintas para audio, caché y texto. Cuando no existe una medición completa verificable se imputa la reserva conservadora de cuota y se deja el costo monetario en `null`; no se presenta una factura falsa de cero. Los contadores observados y segundos se conservan como metadatos, sin audio ni texto en el monitor.

## Configuración, cupos e historial

Los modelos se centralizan en `oliviaConfiguration/global`; los valores iniciales son `gpt-6-luna` xhigh para administrador base, `gpt-6-sol` high para tareas complejas, `gpt-6-luna` medium para vendedor, `gpt-transcribe` para audio, `gpt-realtime-whisper` para transcripción en vivo y `gpt-realtime-2.1`/marin para voz. La disponibilidad real depende de la cuenta OpenAI y debe verificarse en el despliegue.

El cupo técnico inicial es 100.000 tokens mensuales por usuario hasta que el Administrador configure la política del negocio. Permite renovación diaria, semanal o mensual en hora argentina y ampliación temporal vinculada a un único período. Reservas transaccionales evitan consumir simultáneamente el mismo saldo. Las solicitudes se limitan por usuario, rechazan intentos duplicados y reconcilian reservas de procesos interrumpidos. Los vendedores reciben únicamente porcentaje disponible, período y próxima renovación; las advertencias aparecen al 25%, 10% y 0%.

Aun con cupo cero, el vendedor puede crear una solicitud administrativa de ampliación sin llamar al modelo. Es idempotente por usuario/período y no modifica el cupo. El Administrador la ve en Configuración y prepara una ampliación que sigue la revisión y reautenticación normales.

La configuración acepta tarifas explícitas por modelo y cotización oficial de venta. USD se calcula desde tokens medidos y tarifas configuradas; ARS usa cotización × 1,05. Sin tarifa/cotización no se inventan importes. Estos cálculos no sustituyen la conciliación de facturación del proveedor; la voz no usa una tarifa textual para simular el costo total.

La retención se configura entre uno y doce meses. El vencimiento de cada conversación se fija al crearla, con ajuste de fin de mes. Los 40 mensajes recientes son un cache acotado para interfaz/contexto; la subcolección conserva el historial íntegro durante el plazo. Supervisión carga páginas de 60 mensajes. `olivia-retention` borra mensajes en páginas, verifica que no queden hijos antes de eliminar el padre, elimina propuestas/metadatos vencidos y conserva solo agregados diarios anónimos. La auditoría comercial permanece independiente.

## Despliegue y comprobación

El sitio existente conserva `netlify.toml` y el build unificado. La interfaz también compila en la superficie Gestión separada; E-commerce no monta Olivia. La política de micrófono habilita únicamente el propio origen y cada grabación exige consentimiento del navegador.

Se requieren `OPENAI_API_KEY` y credenciales Firebase Admin privadas, mediante `FIREBASE_ADMIN_CLIENT_EMAIL`/`FIREBASE_ADMIN_PRIVATE_KEY` o JSON de cuenta de servicio del proyecto `app-integral-fm`. El usuario informó que ya están configuradas en Netlify; debe comprobarse su disponibilidad también en el contexto de preview. No deben ser variables `VITE_*`.

Publicar código y funciones juntos. La función de medición mantiene el sufijo `-background`; las tareas programadas solo se ejecutan en despliegues publicados. Los índices nuevos están en `firestore.indexes.json`: solicitudes/voz por estado-vencimiento, conversaciones por usuario-actualización y consumo por usuario-fecha. Deben aplicarse junto con las reglas antes de habilitar supervisión y mantenimiento en producción. El backend de servicio utiliza IAM y no hereda autorización de reglas cliente.

Comandos locales: `npm test`, `npm run build:surfaces` y `npm run test:olivia:rules` dentro del emulador Firestore. Las pruebas cubren permisos cruzados, inyección de parámetros, sesión, cupos concurrentes, confirmación doble, correcciones, expiración, datos cambiados, errores, historial paginado, retención, audio y control de voz. Las pruebas de reglas incluyen regresión del flujo manual de ventas y stock negativo.

La prueba real debe comprobar texto con usuario administrador y vendedor, consulta de stock, propuesta/cancelación, confirmación con datos de prueba autorizados, dictado, voz y supervisión. No usar ventas reales como datos de prueba sin una decisión explícita del usuario. La autorización, despliegue y llamadas al proveedor se documentan por separado de las pruebas locales; compilar no acredita funcionamiento en producción.

## Fuentes

- [Drive · Solución Propuesta](https://drive.google.com/drive/folders/1MIa13_HU_J9Ia0CwLsmQvlBEmGXDKQBA).
- [IA Administrador](https://docs.google.com/document/d/1Vr_hSAvQ13VQerFBwpkHeG3QYi8eJghU47FT-k5P1Mk/edit), [IA Vendedor](https://docs.google.com/document/d/1OqRmESCs5Z0lEM2DyeQvjaSez6dYsKk6bHAOGasRN2Q/edit), [Configuración IA](https://docs.google.com/document/d/1lKt4_vMaFIiKnqw25QAXty45dd_EvunTSBSzniKgYh4/edit).
- OpenAI: [herramientas](https://developers.openai.com/api/docs/guides/function-calling), [voz](https://developers.openai.com/api/docs/guides/realtime), [transcripción](https://developers.openai.com/api/docs/guides/speech-to-text), [control lateral](https://developers.openai.com/api/docs/guides/realtime-server-controls), [latencia y consumo](https://developers.openai.com/api/docs/guides/voice-latency-cost), [transcripción en vivo](https://developers.openai.com/api/docs/models/gpt-realtime-whisper), [modelo base](https://developers.openai.com/api/docs/models/gpt-6-luna), [modelo complejo](https://developers.openai.com/api/docs/models/gpt-6-sol).
- Netlify: [Background Functions](https://docs.netlify.com/build/functions/background-functions/), [límites de funciones](https://docs.netlify.com/build/functions/configuration/), [funciones programadas](https://docs.netlify.com/build/functions/scheduled-functions/).
