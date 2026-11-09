# Apertura de Olivia V6.2 — auditoría

Base auditada: PR #57, HEAD `400b4a0b4e90a5f9116fa8a2a65d7e5c7ac6716b`, código V6 `3c43f1e`. GitHub no tenía cambios posteriores al comenzar. Se creó `codex/olivia-ux-natural-v6-2` desde `origin/main` actualizado `62bd617`, y se incorporó V6 por fast-forward. No se modifica main ni el worktree ajeno.

## Medición anterior a cambios

Chrome real, evento de clic del botón, primer frame con drawer/orbe/compositor dentro del viewport y primer frame con textarea habilitado. No mide envío al servidor ni tiempo de Gemini. No se activó voz ni hubo llamadas Gemini. Los recursos HTTP se registraron por PerformanceResourceTiming; su ausencia en una fila no significa que no hubiese una solicitud todavía en vuelo.

| Condición | n | P50 utilizable | P90 | P95 | Máximo |
|---|---:|---:|---:|---:|---:|
| Reapertura, mismo documento y sesión | 20 | 58,2 ms | 190,7 ms | 572,0 ms | 618,4 ms |
| Documento recargado, conversación conocida, caché HTTP conservada | 5 | 972,8 ms | 989,1 ms | 989,1 ms | 989,1 ms |
| Documento nuevo, sin conversación precargada, caché HTTP conservada | 10 | 1273,9 ms | 2141,9 ms | 2461,1 ms | 2461,1 ms |
| Primera observación con Developer activo | 1 | 2687,0 ms | N/D | N/D | 2687,0 ms |

35 aperturas normales más una observación separada de Developer. Percentiles por rango más próximo, descriptivos por condición; no se mezclan. No se borró caché global de Chrome. Se quitaron únicamente las referencias de conversación de la pestaña de auditoría para simular un primer chat; los registros sintéticos se conservan en Firebase de pruebas.

La observación con Developer mostró drawer en 196,6 ms, pero textarea habilitado a los 2687 ms. La petición iniciada al abrir tardó 2448,2 ms hasta su finalización registrada. En los diez primeros usos normales se vio estado de procesamiento aunque el usuario no había enviado una petición. No se reprodujeron exactamente los cinco segundos informados: se demuestra el mecanismo de espera y se conservan los tiempos realmente observados.

## Causa en el código

El efecto de apertura llamaba `perform(state/resume)`. Esa función compartía `requestRef`, `busy` y el indicador de trabajo con `chat`. El compositor se deshabilitaba si aún no existía `conversationRef`. Por eso cargar sesión/historial parecía una inferencia y bloqueaba el primer borrador. En una sesión ya conocida podía escribirse antes, aunque el orbe y la barra siguieran indicando procesamiento.

El panel Developer y el diagnóstico se importaban con el chat y su modo persistido podía ocupar el flujo normal. Además se calculaba una estimación incluso con un borrador vacío y después de cambios de mensajes, aunque esa estimación no ayudara a decidir nada.

## Corrección candidata

Se separa hidratación con controlador/promesa propios, escritura inmediata y barrera de sesión autenticada al enviar. La voz conserva su gesto explícito, conexión y presupuesto independientes. Developer carga bajo demanda en una vista propia. La estimación escrita solo se solicita para un borrador no vacío. Falta contrastar la candidata en el nuevo Deploy Preview antes de aprobar los objetivos P50 ≤200 ms / P95 ≤500 ms.

Evidencia original privada: `olivia-v62/opening-before.json` y `opening-before.png` en los artefactos de esta auditoría. El CSV comparativo final incorporará cada muestra y condición.

## Contraste ejecutado en Preview 58

Código medido: `47337d91bd09748a06ada55967d8054a61d439fe`. Las correcciones posteriores de tareas y del ancho móvil no cambian el recorrido de hidratación medido. No se atribuyen estas 30 mediciones al SHA posterior como si se hubieran repetido allí.

| Condición | n | P50 | P90 | P95 | Promedio | Máximo |
|---|---:|---:|---:|---:|---:|---:|
| Reapertura, mismo documento | 20 | 58,5 | 980,7 | 988,9 | 287,1 | 998,0 |
| Documento nuevo, sin conversación, caché HTTP conservada | 10 | 973,3 | 1025,6 | 1058,2 | 868,4 | 1058,2 |

Valores en ms. Cero estados falsos de procesamiento en las 30 muestras posteriores. La mediana de reapertura prácticamente no cambia y su cola empeora; no hay mejora general demostrada en ese grupo. En conversaciones nuevas baja la espera del compositor, pero **P50 ≤200 ms / P95 ≤500 ms no se cumplen**. No se descartan los valores cercanos a un segundo ni se atribuyen sin evidencia a React o a la red.

Chrome y el equipo estaban compartidos con el usuario. Se usó rAF, que mide una oportunidad de render del navegador, no un fotograma físico de la pantalla. Durante la tanda se agotó el control del navegador: se conservaron las filas ya escritas y se continuó en una pestaña nueva. AW20 tuvo un clic adicional con resultado ambiguo y se sustituyó por `AW20-retry`; ese incidente se informa y el clic adicional no se vende como una muestra independiente controlada. AC8 se tomó tras recuperar la pestaña. No son pruebas de arranque de Chrome ni de red sin caché.

Fuente individual: `LATENCIAS_V6_V6_2.csv`. El chat admite borrador mientras muestra «Cargando historial… Podés escribir mientras tanto». Enviar sigue esperando la sesión autenticada: compositor habilitado no equivale a operación comercial preparada.
