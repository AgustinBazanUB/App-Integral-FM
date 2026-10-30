# Olivia · prioridades, tareas y respuesta durante la espera

La actualización incluye la experiencia Equalizer Orb/Chirp del PR 45 y mejora la conversación con los modelos configurados actualmente. El cambio visual fino del orb queda disponible para el próximo prompt del usuario.

## Instrucciones nuevas y memoria de tareas

Los cambios explícitos de intención se procesan antes del atajo de carga de stock. «No me cargues stock, quería decir un cliente» cambia a cliente e invalida la propuesta anterior. «Antes explicame cómo…» pausa la carga y responde la consulta. «Retomemos el stock» recupera producto, cantidad y demás datos validados. Se guardan hasta cinco tareas pausadas por conversación, sujetas a la retención y permisos existentes. No se conservan tokens de confirmación dentro de esa memoria.

La herramienta `manage_task` permite al modelo manejar formulaciones que no cubra el reconocimiento acotado. `update_task` conserva sus validaciones y ahora escribe un checkpoint antes de continuar el razonamiento. Las instrucciones no convierten cualquier frase arbitraria en un control determinista: el modelo sigue interpretando el lenguaje fuera de los casos acotados.

El usuario puede enviar una instrucción escrita durante una respuesta. Voz transcribe el turno siguiente mientras el trabajo anterior sigue activo. Solo después de tener un nuevo mensaje transcripto se reemplaza el trabajo, conservando slots y revocando confirmaciones. Los callbacks/guardados tardíos no pueden sustituir la respuesta nueva. Hablar sin terminar un turno interrumpe audio; no ejecuta ni confirma operaciones. La respuesta antigua no vuelve a hablar después de detectar una intervención nueva.

## Menor espera y feedback

- Inicio simple de stock/cliente, pausa, cancelación y retoma no llaman al modelo para producir una pregunta predefinida.
- Si la única llamada fue un `update_task` válido que informa datos faltantes, la pregunta se construye sin otra ronda de Luna.
- Las respuestas cortas de una tarea omiten la búsqueda semántica externa; mantienen contexto y documentación curada. La búsqueda sigue disponible mediante herramienta cuando haga falta.
- Las instrucciones largas de listas de ventas, catálogo y métricas se agregan cuando corresponde al proceso.
- La señal `voice.ready` sale después del commit que guarda el mensaje y antes de reconstruir estado/consumo. El worker publica la aceptación/fase inmediatamente en vez de esperar el siguiente intervalo.
- Chirp prepara una vez por sesión «Dale, dame un momento para revisarlo». El PCM se guarda solo en memoria del navegador. Si la respuesta tarda más de 1,1 s desde el despacho, el audio puede reproducirse mientras continúa el razonamiento. Esa preparación cuenta caracteres TTS; reproducir la copia no hace otra llamada ni consume tokens de Luna.
- El acuse se descarta al llegar la respuesta, al hablar, detener, cambiar de conversación o cerrar. Un fallo de acuse no falla el chat y no genera un banner de error. No promete que se haya ejecutado una operación.

La pill «Estoy trabajando en ello» muestra un spinner y barra indeterminada; no inventa porcentaje ni tiempo restante. La preferencia de movimiento reducido detiene ambas animaciones. El historial se carga al subir, mantiene posición y permite leer mensajes anteriores durante el trabajo o la voz.

Se conservan Luna HIGH/XHIGH y Google Chirp 3 HD. No se habilitan servicios/tarifas de prioridad ni se reduce razonamiento silenciosamente. El fin de turno mantiene 1,9–4 s de tolerancia para pausas; Enviar turno sigue siendo inmediato. Estas mejoras eliminan trabajo y rondas evitables, pero la reducción real en milisegundos depende de red, transcripción, proveedor y herramientas y requiere medición de dispositivo.

## Conocimiento, funciones y análisis

`get_app_capabilities` devuelve el mapa autorizado de funciones y límites de la aplicación. El conocimiento de Envíos se actualiza al módulo logístico vigente; se dejan de anunciar las preparaciones genéricas de envío que su backend ya no admite. Olivia explica el flujo manual y ofrece sugerir a Agustín una capacidad faltante, sin enviar el mensaje hasta recibir un pedido explícito.

Las instrucciones de análisis comercial incorporan rotación, ticket, mezcla, recompra, canal, disponibilidad, pruebas de campañas y límites de atribución. `forecast_product_demand` usa unidades de una presentación real, días calendario del período explícito y horizonte solicitado. Devuelve base diaria y escenarios de sensibilidad ±20% identificados como tales. No inventa crecimiento ni demanda no observada y no produce estimación cuantitativa si no hay ventas base.

La auditoría cubre el inventario anterior de interfaz con contraste del registro actual de herramientas y revisión de los cambios montados. No equivale a ejecutar cada mutación real. [Informe de capacidades y brechas](olivia/2026-10-28/auditoria-capacidades.md), [inventario estructurado](olivia/2026-10-28/auditoria-capacidades.json). Olivia todavía no ejecuta todas las funciones de la aplicación; los límites concretos quedan accesibles en su mapa.

## Verificación

Las suites nuevas prueban cambios de intención, pausa/retoma, propuesta renovada, rechazo de permisos, checkpoints, caché/cancelación del acuse, alcance del directorio y proyección con ventas sintéticas. La fixture local muestra componentes reales, servicio y audio sintéticos, e historial largo para probar scroll. `responsive.html` permite revisar 390 × 420 sin credenciales ni Firebase.

La preview debe conservar cliente, Functions, Authentication y Firestore en `app-integral-fm-pruebas`. Voz usa su proyecto TTS separado de preview. La aceptación con micrófono/altavoz físicos, eco y navegadores móviles continúa siendo una prueba de dispositivo; la fixture no la sustituye.

Evidencia local: suite general aprobada; build unificado y build Gestión correctos, con el aviso previo de tamaño de chunks. Chromium mostró reemplazo de consulta lenta, historial largo sin botón, frase de espera en voz sintética y layout de 390 × 420 con mensaje/pill/composer visibles. En esa revisión apareció y se corrigió el uso de temporizadores nativos sin su receptor global; se agregó una regresión específica. El número final de pruebas y el commit de entrega se registran en el PR. Las capturas en `olivia/2026-10-28/evidence/` usan exclusivamente la fixture sintética.
