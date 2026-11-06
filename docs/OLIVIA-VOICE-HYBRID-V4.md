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

## Referencias oficiales

- [Modelo Gemini 3.8 Live](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [Tokens efímeros para Live API](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- [Buenas prácticas Live API: 20–40 ms, PCM y compresión](https://ai.google.dev/gemini-api/docs/live-api/best-practices)
- [Reanudación y ciclo de sesión](https://ai.google.dev/gemini-api/docs/live-api/session-management)
- [Precios Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [SDK JavaScript oficial](https://github.com/googleapis/js-genai)
