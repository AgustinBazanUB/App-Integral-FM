# Olivia: voz híbrida Gemini Live

## Alcance y estado

Esta actualización se desarrolla en `codex/olivia-voz-hibrida-v4`, desde `origin/main` en `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`. La rama anterior de Olivia ya estaba integrada en `main`; esta rama no contiene cambios exclusivos de esa rama anterior. La integración permanece apagada fuera del Deploy Preview aislado y no despliega ni modifica datos de producción.

PR: [#55](https://github.com/AgustinBazanUB/App-Integral-FM/pull/55). Preview: [deploy-preview-55--appintegralflormia.netlify.app](https://deploy-preview-55--appintegralflormia.netlify.app/).

## Arquitectura auditada

La ruta anterior reutiliza `NaturalVoiceConversation`, VAD/endpointing local, `LiveTranscription` por WebRTC para `gpt-live-transcribe`, el motor autorizado de `netlify/functions/_lib/olivia/engine.mjs`, el router Luna/Sol y Google Chirp 3 HD. El backend prepara lecturas rápidas tipadas cuando `quickReadPlan` las reconoce; las demás consultas conservan sus rutas, herramientas, permisos y tarjeta de confirmación.

La auditoría precedente identifica como costos de latencia bajo control de la app el silencio de endpointing, la espera por la transcripción en vivo y por el motor, y ciertas cotizaciones remotas en configuración. Su evidencia y límites están en [la auditoría de latencia v3](olivia/2026-10-29/latencia-v3/AUDITORIA.md). No había percentiles físicos de la conversación completa. Antes de esta rama, la suite local pasó 1082/1082 pruebas; la compilación de Gestión pasó tras instalar las dependencias fijadas.

En la ruta nueva, Olivia permite que la grabación y la indicación de escucha comiencen apenas queda listo el micrófono; la conexión del proveedor ocurre en paralelo. La espera de Gemini y el micrófono tienen marcas separadas. La primera respuesta posterior a cambios aún requiere medición en la preview real.

## Ruta híbrida

1. Una Function autenticada comprueba Deploy Preview, el feature flag, Firebase `app-integral-fm-pruebas`, la credencial Gemini de backend y la marca de tier pago.
2. La Function crea un token efímero de un uso; nunca envía la API key permanente al navegador.
3. Chrome abre el WebSocket Live usando el token efímero. El SDK oficial `@google/genai` se usa en backend para emitir tokens; el navegador usa WebSocket nativo porque las restricciones de versión del SDK para tokens efímeros no coinciden con el endpoint Live v1beta utilizado por Chrome.
4. La captura envía PCM mono en fragmentos de 1024 muestras (21,3 ms a 48 kHz), remuestreados a PCM de 16 kHz. La salida PCM de 24 kHz se programa incrementalmente con Web Audio.
5. Solo saludos, agradecimientos, bienestar y despedidas que coinciden exactamente con la política del servidor pueden salir directamente de Gemini. El texto y el audio generados quedan retenidos hasta esa clasificación. Preguntas comerciales, instrucciones, solicitudes ambiguas y charla fuera de esas frases se derivan al motor vigente de Olivia; su `quickReadPlan`, Luna/Sol, las herramientas y sus permisos determinan el subflujo. Las respuestas Gemini que no superan la clasificación se descartan y no se escuchan.
6. Las funciones comerciales siguen usando herramientas autorizadas. Las escrituras continúan sujetas a permisos y a la confirmación visual existentes. Si Olivia devuelve un resultado verificado al tool call, Gemini puede decirlo en su sesión; si Gemini falla o no genera audio, se usa el fallback existente con Chirp.
7. El navegador envía transcripción y uso por turno al backend. Se conserva transcripción dentro de la conversación, no el audio. Las métricas de programación de audio no demuestran que el sonido haya salido físicamente por el altavoz.

La configuración de Live fija Aoede, español argentino, audio nativo, función `delegate_to_olivia`, compresión de contexto y reanudación cuando Google entrega un handle. No configura `thinking_level`. Interrumpir detiene fuentes pendientes; las respuestas generadas no se exponen antes de la clasificación backend.

## Presupuesto preventivo

Valores iniciales editables desde Configuración de Olivia: objetivo USD 5, aviso USD 6 y techo preventivo USD 10. Hay un máximo de 660 turnos por mes y una reserva preventiva de USD 0,50 por sesión activa, con sesiones de hasta 10 minutos. La nueva sesión se rechaza si el gasto registrado, las reservas activas y la nueva reserva superarían el techo. Una sesión se cierra al alcanzar su reserva, al llegar al tope mensual o al faltar una medición. El aviso se calcula sobre gasto registrado más reserva.

El panel separa el costo calculado con los tokens de `usageMetadata`, la estimación por duración de audio cuando faltan esos tokens y los turnos sin costo calculable. Los importes aplican las tarifas configuradas/oficiales a los contadores de uso; no son importes de factura conciliados. La estimación por duración excluye el contexto acumulado. Google cobra contexto reutilizado en turnos posteriores, por lo que el costo calculado desde `usageMetadata` puede incluirlo. Las reservas, el contador y la revisión después de cada turno reducen el riesgo, pero el token directo y el retraso de los reportes impiden prometer un corte monetario absoluto.

El panel también muestra Luna/Sol usando sus contadores de tokens y tarifas configuradas, y Chirp con una estimación por caracteres. Los totales y contadores mensuales de proveedores se guardan en un único documento agregado, sin transcripciones ni identificadores de solicitudes. Las escrituras reutilizan las transacciones de contabilización existentes y el estado de Olivia lee ese mismo documento mensual; el consolidado no añade una lectura separada de Firestore.

La proyección de USD para 660 turnos es `costo promedio registrado × 660`, no una predicción de precisión facturable. Para alcanzar USD 5–6, el promedio registrado debe quedar aproximadamente entre USD 0,00758 y USD 0,00909 por turno. La tarifa de audio de entrada/salida no alcanza para estimar ese costo completo porque el contexto también se cobra.

## Entornos y variables

El backend de voz solo funciona cuando todas estas condiciones aplican a Deploy Preview:

| Variable | Alcance | Uso |
| --- | --- | --- |
| `OLIVIA_HYBRID_LIVE_ENABLED=true` | Deploy Preview, Function | Feature flag de backend |
| `GEMINI_API_KEY` | Deploy Preview, Function, secreto | API key permanente de Google; no `VITE_*` |
| `GEMINI_API_BILLING_TIER=paid` | Deploy Preview, Function | Declaración de tier pagado para impedir el uso accidental del tier gratuito |
| `FIREBASE_PROJECT_ID=app-integral-fm-pruebas` | Deploy Preview, Function | Firebase que debe usar el backend |
| `VITE_PREVIEW_FIREBASE_PROJECT_ID=app-integral-fm-pruebas` | Deploy Preview, build | Firebase que debe usar la interfaz |

También deben continuar configuradas las variables web de Firebase de pruebas, `FIREBASE_WEB_API_KEY` y `FIREBASE_SERVICE_ACCOUNT_JSON` según [Firebase de pruebas](FIREBASE-PRUEBAS.md). La cuenta de servicio backend debe pertenecer exclusivamente a staging. La Function rechaza producción y los valores de Firebase mixtos. Las pruebas de escritura solo podrían hacerse después de verificar que Functions, Auth, Firestore y la interfaz señalen a staging.

## Medición, automatización y límites

- La auditoría v3 conserva las referencias de endpointing, TTS y QA simulada. No son mediciones reales de Gemini ni percentiles end-to-end.
- Las pruebas focalizadas cubren configuración, límites de preview, costos por modalidad, acumulados estimados de Luna/Sol y Chirp sin doble contabilización al reintentar, tool prompt, clasificación, remuestreo, audio retenido y delegación.
- Con el consolidado final: `npm test` pasó 1093/1093; `npm run build:surfaces` compiló Gestión y ecommerce; `npm audit --audit-level=moderate` encontró cero vulnerabilidades; `node --check` y `git diff --check` pasaron. Las compilaciones conservan la advertencia previa de bundles mayores a 500 kB.
- `npm run test:rules` no pudo iniciar el emulador local porque esta PC no tiene Java (`Could not spawn java -version`). No se desplegaron reglas ni se contactó Firebase remoto; no hubo pruebas con escrituras.
- GitHub Actions pasó `npm ci`, `npm test`, las reglas Firestore con el emulador `demo-flor-mia-integral` y `npm run build` en el commit anterior de la rama; el último commit se verificará en el PR antes de entregar.
- El repositorio no declara scripts independientes de lint o typecheck.
- La comparación real de Aoede Gemini/Chirp, los percentiles P50/P90/P95 de 30–50 interacciones, ruido, interrupciones físicas y reproducción en altavoz requieren una Deploy Preview habilitada, credencial Gemini de tier pago y Chrome con micrófono. Ningún test simulado sustituye esas comprobaciones.
- Netlify muestra un aviso de pago del equipo vencido; aun así, el Deploy Preview se construyó y su pantalla de login carga en Chrome. El valor público `VITE_PREVIEW_FIREBASE_PROJECT_ID` se verificó como `app-integral-fm-pruebas`. Los valores server-side permanecen ocultos y no se expusieron; su correspondencia efectiva con staging no se pudo verificar desde la sesión de navegador disponible.
- En Deploy Preview no existen `GEMINI_API_KEY`, `OLIVIA_HYBRID_LIVE_ENABLED` ni `GEMINI_API_BILLING_TIER`. Por eso Gemini no está habilitado. No se modificó billing, se creó una clave, se consumió Gemini ni se alteraron secretos; no se inició sesión ni se pidió acceso al micrófono. Para proteger los datos de negocio no se hicieron pruebas que generen o persistan conversaciones hasta verificar el proyecto y las credenciales backend de staging.
- No se hicieron pruebas reales de conversación, voz o A/B. Para realizarlas faltan las variables indicadas, verificar sin revelar secretos que Functions/Auth/Firestore usan `app-integral-fm-pruebas` y disponer de un usuario administrador de prueba autorizado en ese proyecto.
- No hay script de typecheck/lint declarado. La auditoría npm inicial señaló la dependencia transitiva `re2js`; se actualizó dentro del rango permitido (`2.8.6` → `2.9.1`) y la auditoría final encontró cero vulnerabilidades.

## Continuación del diagnóstico · 6 de noviembre de 2026

Las limitaciones de configuración descritas en la auditoría inicial de arriba son históricas. El usuario configuró las variables Gemini y compró créditos de AI Studio. La interfaz del preview ya informa disponibilidad híbrida, Firebase `app-integral-fm-pruebas` y autenticación configurada; la Function mantiene las validaciones de proyecto, credenciales y propietario antes de reservar una sesión. No se promueve esta actualización a producción.

Chrome tiene permiso de micrófono para el preview, pero Windows muestra cero micrófonos físicos; únicamente presenta Stereo Mix deshabilitado. El usuario confirmó que no tiene micrófono y autorizó continuar las pruebas sin él. No se habilita Stereo Mix ni se cuenta audio del sistema como voz humana.

Se añadió una prueba administrativa dentro del panel Developer, visible únicamente cuando el backend habilita Gemini en el preview aislado. Utiliza la misma emisión de tokens, WebSocket, clasificación, herramientas, reproducción y presupuesto que la conversación de voz; envía `clientContent` escrito y no solicita `getUserMedia`. Conserva las confirmaciones operativas del motor y limita el diagnóstico a 50 turnos. Registra conexión, texto enviado → primer audio programado, texto enviado → resultado y uso. Esas mediciones no son fin del habla → audio ni demuestran reconocimiento de voz. El costo con entrada de texto tampoco es una proyección válida del costo mensual de entrada de audio.

Se identificó un defecto en la lectura del WebSocket: `JSON.parse` recibía los frames binarios como Blob y los descartaba, incluido `setupComplete`. El socket ahora solicita ArrayBuffer y decodifica sus bytes UTF-8. Una regresión automatizada reproduce handshake y respuesta binarios y verifica un turno de texto sin abrir captura. La confirmación con Google real y los resultados del diagnóstico se registrarán después del despliegue.

Las pruebas físicas de micrófono, reconocimiento, ruido y barge-in, así como la comparación de voz humana anterior/híbrida, continúan pendientes de un dispositivo de entrada. No se declaran cumplidos sus objetivos por probar texto.

El handshake real pasó en Chrome tras corregir los frames binarios (5413 ms y 3342 ms en dos sesiones). La segunda sesión completó seis turnos de entrada escrita, con clasificación y registros de consumo; el séptimo quedó sin cierre de audio. La evidencia está en [chrome-text-session-2.json](olivia/2026-11-06/hybrid-v4/chrome-text-session-2.json). Se observaron fragmentos PCM de dos bytes, transcripción completa y `generationComplete` sin `turnComplete`; son observaciones del transporte, no una certificación de un fallo general de Google ni de calidad audible.

La recuperación ahora espera a que termine el audio programado y concede cinco segundos después de `generationComplete`; si falta `turnComplete`, finaliza el texto sujeto a la política backend, marca el audio como incompleto para usar Chirp y retira la sesión rota. Un plazo independiente de 45 segundos evita dejar un turno del proveedor esperando indefinidamente; una herramienta aún trabajando no se cancela por ese plazo. Al cerrar una sesión, los turnos incompletos se reportan antes de liberar la reserva y se conservan como uso sin confirmar cuando no hay contadores utilizables. No se presenta ese consumo como cero.

La prueba detectó que «Perfecto, gracias» se derivaba innecesariamente al motor (13152 ms hasta resultado). Se amplió exclusivamente la coincidencia exacta de ese agradecimiento y variantes breves; una frase que agrega una orden comercial sigue delegándose. Los tests cubren además el cierre tardío, el turno silencioso, la recuperación sin doble respuesta y los frames binarios. La suite actual pasa 1103/1103 y el build pasa con la advertencia previa de bundles mayores a 500 kB. La confirmación remota de estas últimas correcciones se hará en el nuevo preview.

La tercera sesión verificó el agradecimiento corregido: ruta directa, resultado a los 3262 ms y USD 0,001781 calculados desde uso. El siguiente turno activó la recuperación de cierre incompleto y quedó registrado como consumo sin confirmar, con costo `null`, no cero ([evidencia](olivia/2026-11-06/hybrid-v4/chrome-text-session-3.json)). La espera de recuperación se ajustó para respetar todo el audio ya programado más cinco segundos de gracia; también se ignoran cierres tardíos de un turno anterior para no afectar el siguiente.

En Chrome se preparó una carga ficticia de 30 unidades: la tarjeta mostró `19 → 49` y exigió Sí/No. Se eligió No. Se conservaron la propuesta y el inventario de referencia en [la carpeta de evidencias](olivia/2026-11-06/hybrid-v4/). No se confirmó ninguna carga. La formulación larga inicial requirió aclarar producto y cantidad por separado; esa limitación de comprensión permanece visible en la transcripción. La lectura «cuánto stock de…» mostró otro error reproducible: incluía «stock» en el nombre buscado. Se corrigió el parser, con una prueba que verifica lectura autorizada sin cambios de inventario. Suite final local: 1104/1104; compilación correcta, con el mismo aviso de bundles. La lectura corregida debe contrastarse nuevamente en el preview contra las 19 unidades.

### Fuentes del diagnóstico

El [informe de 30 interacciones sin micrófono](olivia/2026-11-06/hybrid-v4/VALIDACION-SIN-MICROFONO.md) consolida las verificaciones posteriores, incluida la repetición correcta de las 19 unidades, los percentiles de entrada escrita, los fallos y los límites de costo. Mantiene separada la aceptación física de voz.

- [Entrada de texto en Live API](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [SDK oficial: tratamiento de frames WebSocket](https://github.com/googleapis/js-genai/blob/main/src/live.ts)

## Referencias oficiales

- [Modelo Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [Tokens efímeros para Live API](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [Buenas prácticas Live API: 20–40 ms, PCM y compresión](https://ai.google.dev/gemini-api/docs/live-api/best-practices)
- [Reanudación y ciclo de sesión](https://ai.google.dev/gemini-api/docs/live-api/session-management)
- [Precios Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [SDK JavaScript oficial](https://github.com/googleapis/js-genai)
