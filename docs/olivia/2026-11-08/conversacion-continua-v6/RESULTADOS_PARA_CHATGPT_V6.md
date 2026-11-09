# Olivia V6 — revisión autosuficiente

**Aceptación parcial; no aprobar producción.** Se implementaron y verificaron mejoras reales. Hay defectos y pruebas pendientes que impiden certificar fluidez general.

## 1. Versión y Git

Rama `codex/olivia-conversacion-continua-v6`; código final probado `3c43f1e2cb43a7f752f4a5775cc891f6a686292b`. Base V5 `516ef2468ef527507a3d9a97d1ab6d21ece144dd`. `origin/main` al inicio y cierre: `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`. Worktree V6 dedicado; V5 y trabajo ajeno de Payway conservados. El commit posterior de informes no modifica código ejecutable; el SHA para reproducir estas pruebas es el indicado.

Commits de código V6: `ac4aeb6` (recuperación/tareas/UI), `41cb4d7` (propiedad de interrupciones), `e36b1a0` (varias cláusulas), `03d36e5` (consumo de avisos), `fd3f5a0` (generación incompleta), `6e28f19` (respaldo asíncrono), `c59f711` (ventana de apertura y primeros registros), `c5e9d00` (contexto suministrado), `c59c624` (diagnóstico seguro), `b64e257` (evento offline), `3c43f1e` (token de un uso).

## 2. Pull Request

[PR #57](https://github.com/AgustinBazanUB/App-Integral-FM/pull/57), abierto y draft hacia main. Hereda cambios V5 aún sin integrar del PR #56. GitHub informó MERGEABLE/CLEAN para el código final; eso no autoriza integrar. No se fusionó main ni se publicó producción.

## 3. Deploy y entorno

[Preview #57](https://deploy-preview-57--appintegralflormia.netlify.app/gestion/settings), Netlify exitoso para el código final. Frontend, audiencia Auth, Functions y guard de credencial verificados en `app-integral-fm-pruebas`; readiness autenticado confirmó preview aislado. Sin cambios de credenciales, reglas o índices. No se usó el Firebase original ni se copiaron datos reales.

## 4. Problemas reproducidos

Propiedad de audio interrumpido; cláusulas retiradas por cierres tardíos; avisos sin consumo atribuible; generación sin cierre; omisión de herramientas por Live; trabajo Luna innecesario al proporcionar un nombre; recuperación rechazada por expiración/uso del token; el panel cerraba por offline antes de recuperar. Persisten lista hablada intermitente, datos genéricos marcados terminales y falsa interrupción por ruido de 500 ms.

Los 18–20 s históricos mezclaban aproximaciones acústicas y rutas delegadas. No se atribuyen a un proveedor sin trazas comparables.

## 5. Soluciones y arquitectura

Gemini Live sigue conversando y la cola/engine existente Luna conserva ejecución, scopes, permisos e idempotencia. Se agregaron recuperación acotada, contexto histórico sin replay, progreso por eventos reales, notificaciones coalescidas con recibos, pausa/reanudar seguros, estado sin Luna y separación normal/Developer.

Si Live omite una herramienta exigida por la política, el mismo cliente autenticado inicia el trabajo asíncrono y suprime audio comercial no verificado. `provided-context` evita trabajos para afirmaciones sin acción fuera de recolección activa. No se agrega clasificador remoto ni integración de modelos. Offline espera online hasta 30 s; los tokens reales `uses:1` se reemplazan antes de conectar. Sin cuotas o vigencias ampliadas. Diagnósticos filtran credenciales. **1150 tests y build aprobados**, con aviso conocido de chunks grandes.

## 6. Conversación

Dos cohortes de diez turnos virtuales completos sin herramientas ni Luna; la segunda en `6e28f19`, con ASR del PCM. En `c59c624` se repitió el nombre ficticio fuera de recolección: cero herramientas y trabajos nuevos, frente a una llamada Luna innecesaria anterior de 2621 ms de proveedor / 7971 ms de trabajo. Esto no certifica clasificación semántica general de todas las consultas.

## 7. Escucha, ambiente e interrupciones

MediaStream virtual aisló el ambiente de la PC. No comprueba eco físico o naturalidad de backchannels. Pulso sintético de 150 ms: ningún stop/interrupt. Pulso de 500 ms: nueve nodos detenidos, sin transcripción ni continuación automática; pidió repetir. Al decir «Ese ruido no era para vos, seguí…», retomó la germinación sin herramientas. Conserva tema con petición explícita; la recuperación semántica automática sigue fallando.

## 8. Tareas simultáneas y controles

«Muchas gracias» recibió respuesta directa mientras trabajaba, sin herramienta nueva. Hubo varias tareas persistidas independientes. Una carga QA se pausó por voz, retomó y volvió a esperar clic; otra creación incompleta se canceló por voz. Controles anteriores sobre tareas terminales recibieron 409 seguro. Falta una batería íntegra de operaciones complejas simultáneas y conflictos del mismo recurso.

## 9. Reconexión

Corte de WebSocket en `c59c624`: recuperación fresca 6421,6 ms. Corte de red antes de corregir offline: requirió acción manual. Con `b64e257` recuperó automáticamente, pero primero recibió 1011 por reutilizar token. Repetición final en `3c43f1e`: sin red 12360,1 ms, sesión disponible a los 18122,5 ms desde el corte / **5762,4 ms después de volver la conexión**, sin rechazo ni token reutilizado.

Las tareas/conversación persistieron y no se duplicó stock. El habla emitida durante recuperación puede perderse. Límites: tres intentos, cinco incidentes y espera de red de 30 s. No hay promesa de conexión eterna; el agotamiento de 30 s tiene test local, sin otro corte real prolongado hasta agotarlo.

## 10. Progreso y notificaciones

Una tarea de análisis usó cuatro llamadas y ocho herramientas, proveedor 15158 ms / total 27054 ms, progreso real revisión 16 y recibo. Su entrada sufrió pérdida parcial durante recuperación: no aprueba el guion completo. La carga QA notificó éxito después del clic y verificación backend. El recibo acredita finalización de salida del cliente, no audición humana. Falta comprobar sistemáticamente que los avisos respeten toda intervención activa.

## 11. Operaciones, errores y alternativas

Cliente sintético iniciado por voz y creado tras tarjeta: `customers/customer_019f4696d589ed87d3ef9af5c6d543f55197f190`. Carga sintética: producto `TyLvf3SaCgPElBUNvspc`, local `7011f524-ce34-4e55-a5e4-9330ad4ee492`, una unidad, stock 11 → 12; movimiento `olivia_stock_9c9cb955-8516-480d-9644-9b142ded941a_TyLvf3SaCgPElBUNvspc`. Ambas se iniciaron mediante Olivia y ejecutaron solo tras clic visual. Se conservan en staging. Sin mensajes externos, ARCA ni comercio real.

La búsqueda inicial reconoció «Q envíos» y no encontró producto; pidió ubicación pero quedó `completed`, defecto de recolección genérica. La solicitud completa posterior sí preparó stock. Al pausar, la voz invitó a confirmar aunque la tarjeta solo permitía retomar/cancelar. Para una métrica inexistente ofreció opciones reales, con explicación y pregunta incompletas. Falta un fallo transitorio real de herramienta por voz; fixtures y 409 no lo sustituyen.

## 12. Prueba física

`V6-PHYS-01` recorrió parlantes → micrófono Intel → Chrome; tuvo segmentación y actividad posterior. Correlación inferior a 0,9: latencia acústica N/D. Preflight de 3 s: RMS mediana 0,000017 / P95 0,000632, solo de ese intervalo. Al pedir el usuario usar la PC, se continuó con pestaña en segundo plano y entrada virtual. No hay 37 interacciones físicas aprobadas.

## 13. Latencia y lista de veinte

Cohorte social F01–F10, n=10: primer buffer P50 1466,8 / P90 1762,0 / P95-máximo 2081,7 / promedio 1531,0 ms. Primera energía PCM P50 1484,3 / P90 1797,0 / P95-máximo 2111,7 ms. Histórico V5 `6991b366`, n=10: P50 1348,5 / P95 2019,9 / promedio 1546,8 ms. Muestras descriptivas pequeñas, con diferencias de estímulo/contexto: no prueban mejora porcentual ni no inferioridad. No se alcanza generalmente subsegundo o 500 ms. Programación no equivale a sonido físico.

Lista ficticia: A completa en PCM (29,76 s); B incompleta alrededor de 10–12 pese a texto completo (22,92 s); C completa en Vosk/Whisper (26,62 s). C conserva 75 bloques recibidos/programados, 638880 muestras y diferencia máxima int16=1 por cuantización. No localiza retrospectivamente B, cuyo audio crudo no se guardó. Son elementos dictados de prueba; repetición estable 20/20 aún pendiente.

## 14. Consumo

Gemini: USD 0,593538 → 1,054397, delta registrado **0,460859**, bajo el adicional autorizado de USD 1. Reserva final cero y ninguna sesión activa. Luna/Sol: USD 0,0691908 → 0,1088200, delta estimado 0,0396292 / 43 llamadas. Cierre con tres turnos Gemini y tres llamadas Luna/Sol sin confirmar: no es factura reconciliada ni garantía de importe completo.

Diez turnos sociales atribuibles: promedio USD 0,0062654, proyección para 660 equivalentes USD 4,135164. Promedio mensual agregado de rutas Gemini: proyección distinta USD 2,304311. No se mezclan ni garantizan. Siguen objetivo 5, aviso 6, techo 10 USD y 660 turnos. Infraestructura/estímulos sin factura medida.

## 15. Riesgos

Audio de lista intermitente; ruido largo corta sin reanudar; recolección genérica sin estado; frase confusa de pausa; habla perdida al reconectar; atribución compleja de avisos; consumo desconocido. La aprobación visual continúa protegiendo escrituras.

## 16. Límites de evidencia

81 intentos/estímulos, 76 con alguna transcripción, 67 con buffers: incluyen repeticiones, fallos, ruido y un intento físico. Registros asociados a los 37 casos base, sin equivaler a 37 aprobaciones. No se calcula tasa global mezclando rutas, ni se midió CPU/memoria representativa. Inspección directa del backend y tests locales no cuentan como funciones iniciadas mediante Olivia.

## 17. Pendientes

Reanudación automática de ruido accidental y validación física; veinte productos con pausas/correcciones repetibles; datos faltantes genéricos estructurados; redacción de controles; capacidad ausente y fallo transitorio completos; operaciones simultáneas/avisos bajo habla activa; batería física; reconciliación de consumo. V6 no se declara terminado como producto.

## 18. Recomendaciones

Conservar arquitectura y mejoras comprobadas. Priorizar captura de audio recibido/programado en cada lista, contrato explícito de recolección y política de falsa interrupción que preserve contexto sin repetir operaciones. Repetir acústica cuando la PC no se esté usando y luego concurrencia solo con datos sintéticos.

Pipecat, LiveKit Agents, Async Deep Agents y LiteLLM se evaluaron como referencias; no se instalaron ni se atribuye ahorro no medido a migración. El usuario decide la integración específica a main tras revisar el preview.

Respaldo: IMPLEMENTACION_V6.md, RESULTADOS_PRUEBAS_V6.md, LATENCIAS_V5_V6.csv, INTERACCIONES_V6.csv, RECUPERACION_GEMINI_V6.md, TAREAS_Y_NOTIFICACIONES_V6.md, COSTOS_V6.md, TRAZAS_V6.json, TRAZAS_APP_V6.json y EVIDENCIA_ADICIONAL_V6.json.
