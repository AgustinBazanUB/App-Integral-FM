# Interfaz V6.2

El chat normal presenta orbe, mensajes, compositor y footer compacto. El menú de tres puntos reúne conversaciones, nueva conversación, preferencias, configuración de voz y Developer. Developer solo se ofrece al administrador; abre una superficie propia con retorno al chat y conserva métricas, cola, diagnóstico y exportación de trazas.

La conexión de voz tiene un anillo CSS de 2,6 s; no usa un temporizador React para animar. `prefers-reduced-motion` deja el indicador estático. Abrir el chat no pide token Gemini ni micrófono. Durante la hidratación se puede escribir; enviar espera el identificador autenticado. Durante conexión de voz se admite texto; el dictado independiente cancela primero la conexión para no mantener dos capturas.

Las tareas activas se revisan en Developer. Las que necesitan datos, confirmación, reanudación o atención aparecen en el chat. El estado conversacional y la tarea de fondo son independientes. No se muestra «Estoy trabajando en ello» solo por restaurar historial.

El footer identifica próxima solicitud escrita o voz de duración desconocida, última interacción correlacionada Gemini + Luna/Sol y total mensual registrado. Una reserva no es gasto. Sin medición no se muestra USD 0. El detalle de proveedores sigue en Developer.

## Revisiones visuales

| Escenario | Evidencia y alcance |
|---|---|
| Desktop real | Capturas privadas before/after y captura final del Preview 58 |
| Móvil fixture 390×844 | Compositor, menú, footer y conexión; sin overflow local |
| Movimiento reducido | Anillo con animationName none; fixture local |
| Error de token 503 | Mensaje claro, escritura disponible y reintento manual solo al terminar la recuperación; fixture |
| Cancelar mientras conecta | Sin error tardío ni anillo permanente; fixture |
| Seller | No ofrece Developer en fixture; no equivale a una sesión seller real |
| Móvil preview real | La primera medición mostró layoutViewport 482 frente a visualViewport 390; panel 481,6 px. Después: izquierda 0, ancho/derecha 390,4 px, visualViewport 390,4, overflow interno 0; captura CDP 390×844. Voz apagada |

Los fixtures usan micrófono y WebSocket sintéticos; no son pruebas de permisos físicos ni de proveedores. La prueba real usó entrada virtual. No se activaron permisos de cámara o micrófono físico nuevos.

Se observó además que un tab abierto durante un redeploy puede intentar descargar chunks lazy ya retirados y cerrar el componente por error. Una recarga recuperó el preview. No se implementó una recuperación de chunks obsoletos; queda pendiente y no se oculta como error de Gemini.

Al restaurar el último chat de QA, la respuesta a la lista y la respuesta a la interrupción aparecieron antes de sus mensajes de usuario. Se conserva la captura; falta localizar el origen del orden de mensajes y corregirlo. La barra externa de Netlify puede cubrir parte del footer en el preview; se minimizó para la revisión sin modificar la aplicación.
