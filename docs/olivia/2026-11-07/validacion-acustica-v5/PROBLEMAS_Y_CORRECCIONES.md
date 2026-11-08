# Incidencias y correcciones — validación Olivia V5

Estado: validación en curso. Base `ef5485643c516ade20c1bfdaeba7eb0449b6e377`. Las pruebas con entrada virtual no se consideran equivalentes a micrófono físico.

## Laboratorio

Micrófono físico Intel y parlantes Realtek, 48 kHz, dos canales; permiso de Chrome concedido. La medición de nivel, sin guardar ni transcribir contenido, dio RMS mediano 0,047 y 201/302 ventanas por encima del umbral de inicio local 0,025. El circuito físico se dejó bloqueado por ambiente no controlado. No se instalaron controladores ni se cambiaron permisos, facturación o protecciones de Windows.

Se preparó un MediaStream sintético temporal en Chrome, mediante el AudioContext y DevTools autorizados. Conserva el audio de entrada, el VAD y la sesión real de Gemini; evita conectar el micrófono físico. Las frases se generaron desde el guion original de 37 casos. El audio pregrabado es el estímulo, nunca una respuesta atribuida a Gemini. Las respuestas provienen de la API real.

## VAD ligado al refresco visual

Reproducción: con la página visible y `document.hasFocus()` verdadero, cuatro intervalos de `requestAnimationFrame` medidos en 4,21 s fueron aproximadamente de un segundo (mediana diagnóstica 1.007,7 ms, máximo 1.011,9 ms). Es una medición breve de cadencia, no un percentil de conversaciones.

`NaturalVoiceConversation.loop` evaluaba inicio y fin de voz solo en cada animation frame. Tres repeticiones virtuales de «Hola, Olivia» dieron variación del cierre local y dos transcribieron solo «Olivia». En dos repeticiones, fin del estímulo → primer audio programado fue 1.470,7 y 2.560,5 ms; no son TTFA físicos.

Corrección focalizada: el callback de captura existente de Gemini entrega RMS y timestamp al detector. `processInputFrame`/`evaluateVoice` hacen el VAD en esa cadencia de audio; animation frames conservan la visualización. No se cambian umbrales, silencios, modelo ni proveedor.

## Inicio de frase anterior al umbral

`attachCapture` descartaba audio hasta que el VAD activaba `listening`. Se agrega una ventana previa máxima de 200 ms en memoria, enviada en orden solo al abrir un turno válido y eliminada al cerrar la captura. No hay transmisión durante silencio ni almacenamiento permanente de PCM en el producto.

Regresiones locales: los frames anteriores al umbral se conservan una sola vez; la duración queda acotada y contabilizada; el VAD cierra sin animation frames y mantiene la ventana previa de dos segundos para listas. `npm test`: 1.118 aprobados. Build aprobado con la advertencia de chunks grandes existente.

La repetición con proveedor real sobre el nuevo preview y la batería de 37 casos deben registrarse antes de declarar estas correcciones aprobadas acústicamente.

## Captura de salida e inactividad

Una captura WASAPI encontró salida ajena en Windows. Se detuvo el proceso propio antes de guardar la muestra en memoria. El análisis inicial por sustracción de plantilla tampoco pasó el control de calidad (correlación 0,57 y un inicio candidato anterior a los frames de Gemini); su latencia queda N/D. Las capturas programadas de Web Audio se etiquetan como software, no como salida física.

Durante la preparación, Gemini cerró una sesión con código 1008 y razón «Session closed due to client inactivity». Se conservó el registro, se liberó la reserva y se reconectó desde el control de Olivia. No se presenta esa desconexión como una prueba social aprobada.
