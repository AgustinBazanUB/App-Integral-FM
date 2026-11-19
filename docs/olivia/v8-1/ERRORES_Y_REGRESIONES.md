# Errores y regresiones — V8.1

## Encontrados y corregidos

| Hallazgo | Corrección | Verificación |
|---|---|---|
| Un evento de interrupción del proveedor podía limpiar reproducción del turno equivocado. | Se correlacionan las fuentes de audio con su turno y se permite detener solamente la reproducción obsoleta. | Suite `olivia-native-async` y pruebas de turnos correlacionados. |
| El rechazo de un turno obsoleto podía retener una tarea si el test harness omitía la clasificación/foco que existe en producción. | El contrato del tool call ahora incluye sesión, turno fuente y revisión; los tests crean el foco a través de la clasificación real. | `tests/olivia-gemini-live.test.mjs` y `tests/olivia-native-async.test.mjs`. |
| Un tool call sin transcripción final podía recibir un rechazo de foco antes del mensaje seguro de “repetí la solicitud”. | El control de foco para despacho se aplica cuando existe transcripción final; sin ella no se llama al motor y se solicita repetir. | Test `Gemini tool calls wait for final user transcription…`. |
| El emulador de reglas apuntó inicialmente al puerto 8080, donde otro proceso local respondió HTTP 405. | Se repitió toda la suite con el puerto local 8280 y `FM_TEST_FIRESTORE_PORT=8280`. No se cambió configuración versionada ni se contactó Firebase remoto. | 140/140 reglas pasan en emulador local. |

## Regresiones conocidas / límites

- La prueba física, su medición de latencia y los diálogos manuales se registran en la planilla; no se atribuyen a pruebas automáticas.
- La entrada de audio virtual no está instalada. Las voces SAPI localizadas son `en-US`, por lo que un TTS local no representa el acento argentino.
- El build de Vite completa, pero mantiene el aviso de bundle mayor a 500 kB (el bundle principal medido por el build fue aproximadamente 870 kB sin comprimir).
- No se alteraron reglas ni índices Firebase en este cambio.
