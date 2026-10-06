# Preview conjunta: vendedor y Olivia

Entrega de revisión solicitada el 6 de octubre de 2026. No se hace merge a `main`, no se publica la web de producción ni se despliegan reglas o índices de Firebase.

## Contenido

La rama `codex/seller-sale-feedback` reúne la corrección del vendedor (`b0da43a`) y la última evolución de Olivia (`9deb751`, que incluye la integración inicial). La resolución del conflicto del teclado conserva ambas restricciones: los atajos se suspenden durante el guardado de una venta y mientras Olivia está abierta.

Se mantienen el chat, historial, adjuntos, dictado, consultas de inventario y métricas, router Luna/Sol, tareas persistentes, biblioteca, cuotas y confirmaciones de operaciones. La configuración comercial y los permisos se conservan. Para el detalle previo, consultar [entrega de Olivia](OLIVIA-DELIVERY.md) y [auditoría del vendedor](AUDITORIA-VENTAS-VENDEDOR-2026-10-06.md).

## Conversación por voz pausada

El botón sigue siendo accesible y al tocarlo anuncia:

> La conversación por voz todavía no está habilitada. Olivia está lista para una integración de voz a futuro. Podés seguir escribiendo o dictar un mensaje.

No solicita el micrófono, crea conexiones de voz ni inicia consumo del proveedor. El endpoint autenticado rechaza `operation: realtime` con HTTP 409 y código `voice-not-enabled`, tanto para GPT-Live como para Realtime/Mini, antes de crear el store/engine o reservar consumo. El dictado usa su endpoint independiente y sigue disponible. Se conserva la finalización y contabilización de sesiones anteriores.

La pausa es una constante compartida del código (`src/shared/oliviaVoiceAvailability.mjs`), no una preferencia que el navegador o la configuración administrativa puedan levantar. Las implementaciones y ajustes de voz se conservan para una entrega futura; el selector de prueba Mini queda oculto durante la pausa. La pantalla de configuración explica esta situación.

## Verificación

- 804 pruebas generales aprobadas localmente, incluidas cinco pruebas nuevas del bloqueo real, autenticación, rutas conservadas, botón clicable y dictado/envío.
- La suite habitual de CI incluye ahora las reglas de las colecciones privadas de Olivia además de la regresión de roles del vendedor.
- La prueba visual utiliza componentes reales con servicios ficticios; no registra ventas ni modifica stock empresarial.

La preview utiliza el proyecto Firebase configurado; no es una copia aislada de los datos. Netlify publica el frontend y las Functions. Las reglas e índices versionados quedan pendientes de una futura promoción explícita. Las credenciales de backend requeridas por Olivia permanecen del lado del servidor.
