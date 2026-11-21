# Comparación de latencia — Olivia V4 / V5

## Qué puede compararse

Los antecedentes de aproximadamente 2.130/1.650 ms para saludos y 18.120/19.380/19.980 ms para frases delegadas fueron aproximaciones acústicas de otra versión. No se mezclan con los tiempos virtuales de esta auditoría; no permiten porcentajes de mejora ni P50/P95 anteriores representativos.

La base de esta intervención fue `ef54856`; el código final evaluado es `b1e1c6f72048339955e2aa9c6e8bda840f6d1431`. Se conservó el proveedor y la voz. Todos los siguientes números nuevos son software con audio real de Gemini y entrada virtual.

## Repeticiones equivalentes del saludo

| Repetición | ef54856: T1 → T7 ms / transcripción | 6991b36: T1 → T7 ms / transcripción |
|---|---|---|
| 1 | 1.775,2 / Hola, Olivia | 2.276,6 / Hola, Olivia |
| 2 | 1.470,7 / Olivia, perdió Hola | 1.468,8 / Hola, Olivia |
| 3 | 2.560,5 / Olivia, perdió Hola | 1.564,3 / Hola, Olivia |

La corrección del reloj del VAD y el pre-roll conservó el saludo completo en las tres repeticiones nuevas. El tamaño de muestra es tres por versión y hay variación de conexión/generación; no acredita una reducción general de latencia. Antes se midieron animation frames de unos 1.008 ms pese a página visible; después el VAD utilizó el callback de captura.

## Nota y controles

| Caso | Antes, 6991b36 | Después, 1802d0c |
|---|---|---|
| Nota en esta conversación | Delegada; primer audio hacia 20.865 ms | Gemini directo; 1.603 ms |
| Corrección de frascos | Dos tool calls sin respuesta audible | Respuesta directa en 1.777 ms |
| Esperá, todavía no terminé | Texto sin audio programado | Audio en 2.078 ms |
| Mientras revisás esa tarea, me escuchás | Sin audio | Respuesta en 1.456 ms, sin tarea corriendo en la repetición; simultaneidad pendiente |
| Avisame cuando termines | Texto sin audio | Respuesta conversacional en 1.369 ms |
| Esperá, quiero corregir | Texto sin audio | Audio en 1.902 ms |

Son casos individuales, no mejoras porcentuales poblacionales. En la nota original, el backend registró 8.142 ms totales y 2.379 ms del proveedor Luna; no se atribuyen los 20,9 segundos completos a Luna.

## Muestra directa

| Ruta / muestra | n | P50 ms | P90 ms | P95 ms | Promedio ms | Máximo ms |
|---|---:|---:|---:|---:|---:|---:|
| Social, 8 casos | 8 | 1427.1 | 2019.9 | 2019.9 | 1602.8 | 2019.9 |
| Contextual, 6 casos | 6 | 1350.6 | 1587.8 | 1587.8 | 1395.1 | 1587.8 |
| Gemini directo, ambos grupos | 14 | 1369.3 | 2016.3 | 2019.9 | 1513.8 | 2019.9 |
| Acuse delegado identificado | 3 | 1965.7 | N/D | N/D | 1921.9 | 2053.1 |

P90/P95 directos describen únicamente la muestra; no certifican colas de producción. Los acuses y los resultados definitivos permanecen separados. La latencia acústica física nueva es N/D en todas las filas.

## Listas y ruido

Con el límite de 512 tokens, el resumen de listas largas omitía las cantidades o se cortaba. Con 1.024 se observó un corte después del artículo 14. Con 2.048 se consiguió un caso de veinte productos confirmado en PCM, pero apareció audio incompleto en otra repetición: En el último código hubo dos repeticiones diagnósticas: CHECKED-LIST-20 cerró normalmente, mostró 20 nombres en texto, pero la verificación independiente de su PCM reconoció solo los primeros cinco; PCM-PROBE-LIST-20 sí reconoció por audio los 20, hasta «veinte Tango», y cerró normalmente. No se aprueba la estabilidad general de listas largas.

El ensayo PCM-PROBE-LIST-20 del último código dio primer buffer a 3.313 ms, PCM con energía a aproximadamente 3.348 ms y 35,90 s de salida. CHECKED-LIST-20 dio 3.526 ms y 51,70 s programados, pero solo cinco productos reconocibles en PCM. No se calcula una distribución de fluidez mezclando el caso fallido y el completo.

El pulso de ruido de 150 ms detuvo once buffers antes; después no abrió un turno y dejó terminar la explicación. La orden hablada siguió deteniendo la voz. La corrección no demuestra reconocimiento semántico de ruido prolongado o de asentimientos.

## Distancia a la meta

La meta de 500 ms acústicos no está demostrada. En software, el camino directo tuvo P50 de 1.369 ms; el endpoint sin parcial espera aproximadamente 1,1 s y con pausas puede acercarse a 1,7–2 s. Los tiempos posteriores al fin local son otra métrica y no sustituyen la espera completa que percibe el usuario. La apertura agregó entre 3,8 y 6,0 s en cuatro registros completos.
