# Resultados de optimización de Olivia · Ultra Fluida V5

Fecha: 7 de noviembre de 2026  
Rama: `codex/olivia-ultra-fluida-v5`  
PR en revisión: [#56](https://github.com/AgustinBazanUB/App-Integral-FM/pull/56)  
Preview: [Deploy Preview 56](https://deploy-preview-56--appintegralflormia.netlify.app/gestion/settings)

## RESULTADOS PARA ANALIZAR EN CHATGPT

### Fallos que motivaron el cambio

- La repregunta social «¿Te acordás de lo que te pregunté recién?» se clasificaba como una acción comercial, se delegaba al backend y tardaba unos 15,9 s sin audio. En la prueba nueva permaneció en Gemini Live y programó audio, pero la respuesta solo recordó que estábamos charlando; todavía no recupera con precisión el contenido de la pregunta anterior.
- La traza de una ruta de tareas podía fallar por una referencia a `greeting` que no estaba definida.
- La síntesis Chirp 3 HD seguía siendo una segunda ruta de voz, con endpoints, reproductor, clips de PCM y dependencia propia. Eso contradecía el objetivo de que Gemini Live produzca las respuestas breves.
- El reporte previo estimaba cerca de 19,4 s de mediana desde el fin del habla hasta el primer audio. La prueba nueva es escrita y no mide ese intervalo acústico, así que aún no permite afirmar que se alcanzaron 500 ms desde el fin de voz.

### Cambios en esta rama

- Gemini Live/Aoede queda como único proveedor de audio hablado. Se retiraron los endpoints de Chirp, el reproductor, los clips y sus 99 archivos PCM, los scripts asociados, la configuración/costos activos y `@google-cloud/text-to-speech`.
- La charla breve y sus continuaciones se clasifican localmente y siguen en la misma conexión de Gemini; las solicitudes comerciales siguen delegadas al motor de Olivia y conservan sus validaciones.
- Se agregó una respuesta inicial hablada y neutral, bajo una lista exacta permitida, durante ciertas consultas delegadas. La operación y su respuesta final siguen bloqueadas hasta recibir la transcripción final y validar el resultado del backend.
- Se corrigió la referencia `greeting` sin definir y se agregó una prueba de diez turnos consecutivos que comprueba ruta directa y una sola sesión Gemini persistente.
- Los rastros de Chirp que quedan corresponden a documentos, capturas y datos históricos, pruebas de migración de configuración anterior y limpieza de registros antiguos. No habilitan síntesis, selección ni fallback en ejecución.

### Prueba conversacional real en el preview

La prueba usó diez entradas escritas en el panel de diagnóstico, dentro de una única sesión real de Gemini Live. Gemini devolvió audio PCM y el navegador lo programó para reproducir en cada turno. Los diez fueron `local-direct`, sin delegación, sin respuesta sin audio y sin respuesta incompleta.

| # | Entrada | Clasificación local | Envío → PCM programado | Envío → resultado completo |
|---:|---|---:|---:|---:|
| 1 | Hola, Olivia | 0,3 ms | 832,1 ms | 3.631,4 ms |
| 2 | ¿Cómo estás? | 0,3 ms | 700,5 ms | 4.410,0 ms |
| 3 | Muy bien, ¿y vos? | 0,4 ms | 664,2 ms | 5.058,2 ms |
| 4 | Todo bien, gracias | 0,3 ms | 792,5 ms | 3.709,4 ms |
| 5 | ¿Qué andás haciendo? | 0,3 ms | 755,4 ms | 4.026,4 ms |
| 6 | ¿Te acordás de lo que te pregunté recién? | 0,4 ms | 616,6 ms | 5.605,8 ms |
| 7 | Contame algo lindo | 0,2 ms | 688,8 ms | 7.658,6 ms |
| 8 | Dale, me gustó | 0,4 ms | 657,3 ms | 4.205,0 ms |
| 9 | Muchas gracias | 0,3 ms | 760,1 ms | 3.149,8 ms |
| 10 | Bueno, hablamos luego | 0,3 ms | 859,4 ms | 3.853,4 ms |

La conexión inicial tomó 5.540,2 ms. Para los diez valores de envío a PCM, las métricas con la función nearest-rank del repositorio son P50 **700,5 ms**, P90 **832,1 ms** y P95 **859,4 ms**; rango **616,6–859,4 ms**. Son diez observaciones, por lo que describen esta prueba pequeña y no el rendimiento general. El cronómetro empieza al enviar texto, no al terminar de hablar. El evento mide el primer PCM programado en Web Audio; no verifica que el parlante físico lo haya reproducido.

La sesión quedó desconectada tras completar los diez turnos. El snapshot visible inmediatamente al cierre todavía mostraba USD 0,50 reservados. La prueba unitaria del cierre verifica que la respuesta de cierre reporte reserva cero y actualice el panel, pero no confirmé un refresco posterior de esa reserva en la sesión desplegada.

### Validaciones y límites

- `npm test`: **1095/1095 pruebas aprobadas**, incluida la prueba de diez turnos directos en una misma conexión y la validación del callback de cierre con reserva cero.
- `npm run build:surfaces`: compilaciones de Gestión y Ecommerce aprobadas. Vite conserva avisos existentes por bundles superiores a 500 KB.
- GitHub Actions `test-build`: aprobado para el commit `cea3d1b`.
- Las verificaciones de redirects y headers del Deploy Preview pasaron; Netlify publicó la preview del commit `cea3d1b`.
- `firebase emulators:exec --only firestore --project demo-rules "npm run test:rules"` no llegó a ejecutar las reglas: Firebase CLI 15.22.4 necesita JDK 21 y el entorno solo dispone de Java 17 y Java 8. No se modificaron reglas ni índices.
- No se probó el micrófono físico, la transcripción desde el micrófono, el ruido, la interrupción en voz ni la audibilidad del altavoz. Esta prueba confirma audio PCM programado por Gemini con entradas escritas.

### Entorno y consumo de prueba

El Deploy Preview visible indicó Firebase `app-integral-fm-pruebas`, Authentication y Firestore separados; Functions estaban en contexto `deploy-preview`, con Gemini Live habilitado. No se usó producción ni se crearon ventas, clientes, pedidos, inventario o movimientos. Se conservaron en staging los diez turnos sintéticos y sus registros de uso, de acuerdo con `AGENTS.md`.

El costo calculado de esta sesión fue **USD 0,036995** (unos USD 0,00370 por turno). Al décimo turno, el panel mostraba **USD 0,152330** acumulados para el período y **USD 0,50** de reserva. El cálculo combina `usageMetadata` del proveedor con una estimación de audio donde corresponde; no es una conciliación de factura. El panel también mostraba objetivo USD 5, aviso USD 6, techo preventivo USD 10 y límite de 660 turnos.

La solicitud está abierta como PR borrador #56 sobre `codex/olivia-ultra-fluida-v5`; no se integró a `main` ni se desplegó a producción. La revisión visual del preview y una autorización explícita para integrar siguen siendo pasos separados.
