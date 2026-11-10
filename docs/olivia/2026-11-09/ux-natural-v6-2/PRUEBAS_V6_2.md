# Pruebas V6.2

Resultado general: **validación parcial; no aprobada para producción**. La compilación no se usa como sustituto de las pruebas conversacionales.

Se ejecutaron personalmente en Chrome 36 aperturas de referencia y 30 posteriores. Hubo 50 entradas de la batería de audio: 48 estímulos hablados y dos controles de ruido. De los hablados, 45 conservan una relación temporal válida con el stream enviado; tres tuvieron entrada parcial/perdida/retrasada durante recuperación. No son 50 conversaciones acústicas completas ni una certificación física.

44 de los 45 estímulos hablados con reloj estable tienen turnComplete del proveedor. Solo 29 IDs reúnen además al menos un buffer programado atribuible por el harness; eso tampoco demuestra 29 respuestas completas, porque incluye interrupciones intencionales y avisos de atribución ambigua. No se cumple todavía la batería exigida de 37 interacciones acústicas completas verificadas.

La modalidad fue TTS sintético → MediaStream virtual → captura real del frontend → Gemini Live real → reproducción Web Audio. Se desconectó la entrada física: no se grabó el ambiente de la PC. Los dos ruidos son archivos sintéticos reproducibles, no muestras de conversaciones ajenas. Las pruebas locales con mocks se registran por separado en REDISENO. No hubo inyección de texto en reemplazo de los estímulos de voz.

## Tiempos que sí pueden compararse

Ocho sociales S01–S08, mismo primer código candidato: fin RMS del estímulo virtual → primer PCM programado, P50 1482,6 ms, P90/P95 1949,6, promedio 1548,3, máximo 1949,6; cero delegaciones observadas. Son cuantiles descriptivos de ocho casos, no percentiles poblacionales. No equivalen al primer sonido físico audible. El primer turno fue 1949,6 ms; los demás son seguimientos.

Las aperturas tienen su tabla en AUDITORIA_APERTURA y todas sus filas en LATENCIAS. No se mezclan con tiempos de voz, backend o token. No se publica un porcentaje de mejora de voz respecto de aproximaciones acústicas históricas ni de otra muestra de rutas diferentes.

## Listas y ruido

| Caso | Evidencia | Resultado |
|---|---|---|
| N05 | 28 bloques recibidos/programados, ASR independiente local | Cinco elementos completos en PCM programado |
| N10 | 41 bloques y diez elementos en PCM | La entrada tuvo suspensión/reconexión; primer frame 173 s después del t0 previsto. No válido como latencia ni como reconocimiento completo de diez nuevos elementos |
| N20-A | Primer frame 6,8 s tarde; empezó tras reconectar | Entrada parcial, lista comienza en tres. Inválido para 20/20 |
| N20-B | 80 bloques recibidos y programados, igual longitud, diferencia máxima int16=1 | Una repetición completa de los veinte elementos ficticios, confirmada con ASR local sobre ambas fuentes. No son veinte registros del catálogo. Estabilidad aún no aprobada |
| NOISE150 | Ruido band-limit 300–4000 Hz, RMS 0,08, 150 ms, ganancia 0,65 | No cortó la respuesta; no es certificación acústica ambiental |
| NOISE500 | Mismos parámetros, 500 ms | Reproducción detenida unos 500 ms después de su primer buffer; no reanudó antes del próximo estímulo. Fallo pendiente |
| INT | «Pará. Quiero cambiar de tema» durante reproducción | Cortó la salida anterior y respondió al cambio de tema |

La verificación independiente usa faster-whisper base local sobre PCM recibido y programado, no la transcripción del propio proveedor. Sus diferencias fonéticas («charli», «que bec», «Tengo») no se presentan como prueba de pronunciación perfecta. Igualdad de bloques programados no prueba salida física ni descarta buffers detenidos; por eso se conservan stop events y no se certifican como completas las respuestas cortadas.

## Entorno, errores y conservación

Antes de operaciones se verificó frontend staging, Auth aud `app-integral-fm-pruebas`, readiness de Functions con los siete controles verdaderos y lectura autenticada de Firestore. La configuración del servidor valida proyecto y cuenta de servicio coincidentes; no se imprimieron secretos. No se usó producción como fallback.

No se confirmó ninguna modificación comercial. Se conservaron conversaciones, tareas y borradores sintéticos. Se observó un 409 `firebase-admin-read-error` durante concurrencia; la tarea persistida terminó pidiendo datos, pero la voz se cerró con una medición sin confirmar. No se atribuye el fallo a Luna o Gemini sin evidencia adicional. Un redeploy invalidó chunks lazy del tab viejo; hubo que recargar. El control de Chrome también agotó una espera durante aperturas; la evidencia anterior se guardó antes de continuar.

Se mantuvieron las marcas de navegador y backend en relojes separados. Los JSON sanitizados bajo `evidence/` conservan correlación de aplicación; el CSV individual no debe usarse para atribuir resultados asíncronos por proximidad. PCM, scripts, ASR, capturas y dumps completos permanecen privados bajo el directorio `olivia-v62` de artefactos de esta auditoría; el manifiesto SHA-256 permite identificarlos sin publicarlos.

Pendientes: 37 respuestas completas verificadas; repetición estable de listas; variantes de recopilación con audio; recuperación del audio enviado al reconectar; reanudación por ruido no intencional; permiso denegado físico/seller real; ciclo real completo de pausa/reanudar; progreso de varias tareas mientras el usuario habla; tres modificaciones verificadas con confirmación; conciliación de costos desconocidos; recuperación de chunks retirados. No se realizan escrituras productivas para cubrir esas faltas.

## Registro individual

La tabla siguiente resume cada entrada. «N/D» excluye latencia inválida o atribución asíncrona ambigua; no significa cero. La respuesta del proveedor y detalles están en `evidencia_interacciones.csv`. Un tool call puede ser rechazado localmente: su conteo no equivale al número de llamadas Luna.

| Sesión | Caso | Estado de entrada | Cierre proveedor | Buffers programados | Primer PCM, ms |
|---|---|---|---|---:|---:|
| 1 | S01 | reloj estable | sí | 15 | 1949.6 |
| 1 | S02 | reloj estable | sí | 17 | 1205.3 |
| 1 | S03 | reloj estable | sí | 15 | 1355.0 |
| 1 | S04 | reloj estable | sí | 14 | 1183.4 |
| 1 | S05 | reloj estable | sí | 15 | 1790.5 |
| 1 | S06 | reloj estable | sí | 14 | 1513.5 |
| 1 | S07 | reloj estable | sí | 14 | 1482.6 |
| 1 | S08 | reloj estable | sí | 9 | 1906.9 |
| 1 | C01 | reloj estable | sí | 10 | N/D |
| 1 | C02 | reloj estable | sí | 0 | N/D |
| 1 | C03 | reloj estable | sí | 48 | N/D |
| 1 | B03 | reloj estable | sí | 13 | N/D |
| 1 | C04 | reloj estable | sí | 0 | N/D |
| 1 | C05 | reloj estable | sí | 0 | N/D |
| 1 | C06 | reloj estable | sí | 43 | N/D |
| 2 | R-C01 | reloj estable | sí | 0 | N/D |
| 2 | R-C02 | reloj estable | sí | 14 | N/D |
| 2 | R-C03 | reloj estable | sí | 33 | N/D |
| 2 | B01 | reloj estable | sí | 16 | N/D |
| 2 | B02 | reloj estable | sí | 50 | N/D |
| 2 | R-S03 | reloj estable | sí | 14 | N/D |
| 2 | B04 | reloj estable | sí | 0 | N/D |
| 3 | F-C04 | reloj estable | sí | 0 | N/D |
| 3 | F-C05 | reloj estable | sí | 12 | N/D |
| 3 | F-C06 | reloj estable | sí | 0 | N/D |
| 3 | F-B04 | reloj estable | sí | 0 | N/D |
| 3 | F-B05 | reloj estable | sí | 3 | N/D |
| 4 | N05 | reloj estable | sí | 28 | 1990.0 |
| 4 | N10 | parcial/perdida/retrasada | sí | 41 | N/D |
| 4 | N20-A | parcial/perdida/retrasada | sí | 71 | N/D |
| 4 | N20-B | reloj estable | sí | 80 | 2818.2 |
| 4 | C07 | reloj estable | sí | 0 | N/D |
| 4 | C08 | reloj estable | sí | 13 | N/D |
| 4 | C09 | reloj estable | sí | 0 | N/D |
| 4 | C10 | parcial/perdida/retrasada | no | 0 | N/D |
| 4 | C10-R | reloj estable | sí | 0 | N/D |
| 4 | C11 | reloj estable | sí | 22 | N/D |
| 5 | Z-C09 | reloj estable | sí | 0 | N/D |
| 5 | Z-C10 | reloj estable | sí | 0 | N/D |
| 5 | Z-C11 | reloj estable | sí | 38 | N/D |
| 6 | Q-C09 | reloj estable | sí | 0 | N/D |
| 6 | Q-C10 | reloj estable | sí | 0 | N/D |
| 6 | Q-C11 | reloj estable | sí | 46 | N/D |
| 6 | NOISE150-SPEECH | reloj estable | sí | 19 | N/D |
| 6 | NOISE150 | control sintético | no | 0 | N/D |
| 6 | NOISE500-SPEECH | reloj estable | sí | 22 | N/D |
| 6 | NOISE500 | control sintético | no | 0 | N/D |
| 6 | INT-SPEECH | reloj estable | no | 22 | N/D |
| 6 | INT | reloj estable | sí | 14 | N/D |
| 6 | B06 | reloj estable | sí | 14 | N/D |

## Conexiones de voz reales

Cinco conexiones manuales conservadas en las exportaciones; se toma la última conexión manual de cada archivo, no las reconexiones automáticas. No se calculan percentiles generales sobre cinco observaciones. Captura virtual; valores en ms.

| Exportación | Gesto → captura lista | Solicitud token | Apertura WebSocket | Setup tras apertura |
|---|---:|---:|---:|---:|
| client-traces-session2 | 2882.7 | 1996.3 | 246.9 | 368.7 |
| client-traces-session3 | 4334.4 | 3261.2 | 274.9 | 364.0 |
| client-traces-session4 | 3661.2 | 2709.4 | 264.3 | 347.9 |
| client-traces-session5 | 5149.9 | 3307.1 | 950.6 | 452.4 |
| client-traces-session6 | 3940.3 | 2126.5 | 1012.4 | 431.5 |

Token incluye transporte y backend; no es solo tiempo del proveedor. Los spans server y sus componentes están en los JSON sanitizados. Estos tiempos no se suman a la apertura visual ni se confunden con el fin de voz a primera respuesta. La tasa de error observada en los ocho sociales fue 0/8 y delegaciones 0/8; no se estima una tasa global comparable para los cincuenta casos mezclados, controles, interrupciones e intentos inválidos.
