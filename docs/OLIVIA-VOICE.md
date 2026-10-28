# Voz natural de Olivia

## Modalidades

La conversación escrita sigue disponible. **Conversar por voz** usa una sola ruta: micrófono/VAD en el navegador → GPT Transcribe (`gpt-transcribe`) al cerrar cada turno → motor Luna y herramientas autorizadas de Olivia → respuesta escrita canónica y resumen hablado → Google Cloud Text-to-Speech Chirp 3 HD transmitido como PCM. El dictado revisable sigue usando su control independiente y deja la transcripción editable antes de enviarla.

GPT-Live, Realtime y la prueba de voz económica se retiraron como modalidades de conversación. El endpoint `olivia` responde HTTP 410 a las operaciones antiguas. No existe fallback automático a otro proveedor. La conversación nueva queda limitada a `agsreserva@gmail.com` mientras esté en prueba administrativa; se requieren Olivia, OpenAI y Google TTS habilitados en el servidor.

## Flujo y datos

- `NaturalVoiceConversation` solicita el micrófono solo después del clic del usuario, con cancelación de eco, supresión de ruido y control automático de ganancia. Detecta la voz localmente, corta el turno tras 350 ms de silencio y limita cada grabación a 60 s/4 MB.
- Cada turno completo se envía como archivo a `gpt-transcribe`, junto a `language=es`, contexto de Flor Mía y sugerencias de términos. Las sugerencias son pistas, no obligan al modelo a incluir palabras no escuchadas. GPT Transcribe trabaja con audio completo; transmitir los bytes de Chirp sí es streaming, no una transcripción continua.
- El audio de entrada vive en memoria del navegador y se descarta tras procesar el turno. La transcripción del usuario y las respuestas de Olivia se conservan en el historial normal. No se guarda audio sintetizado ni texto de TTS en el registro de medición.
- El motor de Olivia usa la misma política Luna HIGH/XHIGH, permisos, herramientas de solo lectura y tarjetas de confirmación que el chat escrito. Ninguna confirmación oral ejecuta una acción. La respuesta escrita es canónica; el modelo puede preparar una versión breve para voz.
- Chirp 3 HD se invoca solo después de persistir la respuesta. El endpoint autenticado valida identidad, propiedad de conversación, límites y cuota mensual, y transmite PCM mono de 24 kHz. Cortar el audio cancela el lector local y el stream proveedor. Hablar durante la reproducción interrumpe el audio y cancela la solicitud anterior antes del siguiente turno.
- La interfaz mide fin de habla a transcripción, transcripción a primer bloque de audio programado, y TTFA de síntesis. Mediana y P95 usan hasta 100 muestras de la sesión abierta. TTFA indica cuándo el navegador programó la reproducción, no cuándo el sonido llegó físicamente al altavoz.

## Configuración backend

### Deploy Previews

El Firebase de pruebas `app-integral-fm-pruebas` conserva el plan Spark. Cloud Text-to-Speech exige que el proyecto de Google Cloud donde se factura tenga billing activo. Para no asociar billing al proyecto Firebase ni alterar su plan, usá un proyecto Google Cloud separado dedicado a la voz, por ejemplo con nombre visible `App Integral FM Olivia Preview`. No habilites Firebase, Authentication ni Firestore en ese proyecto de TTS. Las variables `VITE_PREVIEW_FIREBASE_*`, `FIREBASE_PROJECT_ID` y `FIREBASE_SERVICE_ACCOUNT_JSON` siguen apuntando a Firebase staging; `GOOGLE_CLOUD_PROJECT` apunta al nuevo proyecto TTS y no las reemplaza.

1. En [Google Cloud Console](https://console.cloud.google.com/), creá o seleccioná ese proyecto independiente y copiá el **Project ID** exacto que asignó Google. No confundas el nombre visible con el Project ID.
2. Asociá una cuenta de facturación a ese proyecto de TTS y habilitá [Cloud Text-to-Speech API](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com). Esto habilita consumo facturable en el proyecto de voz; no vincules la cuenta de facturación al Firebase de pruebas para este procedimiento. Google documenta que TTS requiere billing activo: [Get started](https://docs.cloud.google.com/text-to-speech/docs/get-started).
3. En **IAM & Admin → Service Accounts**, creá una cuenta exclusiva, por ejemplo `olivia-tts-preview`. Si el acceso al proyecto de cuota lo requiere, otorgale `Service Usage Consumer` (`roles/serviceusage.serviceUsageConsumer`), no Owner ni Editor. [Autenticación de Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/authentication).
4. En esa cuenta, abrí **Keys → Add key → Create new key → JSON** y descargá el archivo. La clave privada solo se entrega al crearla; guardala fuera del repositorio y no la pegues en chats, tickets, capturas ni archivos versionados. Si la organización bloquea la creación de claves, no desactives esa política: pedí una identidad aprobada antes de continuar. [Crear claves de cuenta de servicio](https://docs.cloud.google.com/iam/docs/keys-create-delete).
5. En Netlify abrí el sitio `appintegralflormia`, luego **Project configuration → Environment variables → Add a variable**. Para `GOOGLE_APPLICATION_CREDENTIALS_JSON`, abrí el JSON descargado con Bloc de notas, copiá el archivo completo con `Ctrl+A` y `Ctrl+C`, y pegalo en el campo **Value**. Pegá el JSON como texto normal, sin envolver todo el documento en comillas ni convertirlo a base64. Marcá **Contains secret values** y seleccioná **Deploy Previews** como único contexto. Para la segunda variable, cargá el Project ID del mismo proyecto TTS:

   | Variable | Valor de Deploy Preview | Secreto |
   | --- | --- | --- |
   | `GOOGLE_APPLICATION_CREDENTIALS_JSON` | Contenido completo del JSON descargado, sin convertirlo a base64 | Sí |
   | `GOOGLE_CLOUD_PROJECT` | Project ID del proyecto TTS; debe coincidir con el `project_id` del JSON | No |

   En la segunda variable, desactivá **Contains secret values**: el Project ID no es una clave privada. Elegí el scope **Functions** si está disponible en el plan actual. Si Netlify lo reserva para otro plan, conservá el scope que permite el plan actual, mantené el JSON como secreto y no uses nombres `VITE_*`. El runtime de la función lee el JSON desde `GOOGLE_APPLICATION_CREDENTIALS_JSON`; no necesita una ruta a un archivo en Netlify.
6. Confirmá que ambas variables tengan valor solo en **Deploy Previews**, y estén vacías en **Production**, **Branch deploys** y el valor general. Los contextos permiten valores distintos por entorno: [variables por contexto en Netlify](https://docs.netlify.com/build/environment-variables/overview/).
7. Guardá los cambios y volvé a desplegar el Deploy Preview del PR. Los valores nuevos solo entran en vigor en un build posterior. Verificá la insignia **Google Cloud TTS configurado** en la configuración de Olivia y probá una conversación de bajo volumen con la cuenta administrativa permitida. Esa insignia confirma presencia de credenciales, no una síntesis exitosa; confirmá que se escuche una respuesta.

`OPENAI_API_KEY` es independiente: la preview también necesita su valor de OpenAI configurado para transcribir y generar las respuestas con Luna. No copies una clave de producción si ya hay una clave de prueba. El JSON Firebase Admin existente no debe reutilizarse como cuenta de TTS; mantené Firebase staging y TTS como identidades distintas.

### Promoción futura a producción

No configures ni despliegues estos valores en producción hasta que el usuario haya revisado la preview y autorice explícitamente integrar esta actualización específica a `main`.

1. Creá un proyecto Google Cloud de TTS separado para producción, con billing y Cloud Text-to-Speech API habilitados. Como el Firebase de producción `app-integral-fm` también conserva Spark, no le asocies billing para activar TTS; el proyecto de voz puede ser independiente del proyecto Firebase.
2. Creá una cuenta de servicio distinta, por ejemplo `olivia-tts-production`, con el permiso mínimo necesario. Generá una clave JSON nueva para producción; no reutilices ni copies la clave de Deploy Preview.
3. En Netlify agregá `GOOGLE_APPLICATION_CREDENTIALS_JSON` y `GOOGLE_CLOUD_PROJECT` con valores del proyecto y cuenta de servicio productivos, asignados únicamente al contexto **Production**. Conservá las credenciales de preview únicamente en **Deploy Previews**; no pongas una credencial en el valor general compartido por contextos.
4. Antes de desplegar, confirmá que `OPENAI_API_KEY` tenga un valor de producción adecuado y revisá billing, cuotas, monitoreo y topes mensuales de Olivia. La cuenta de prueba actualmente permitida por código es `agsreserva@gmail.com`; ampliar el acceso requiere un cambio de código revisado, no basta con agregar usuarios a Firebase.
5. Integrá a `main` solo después de la autorización explícita. Luego esperá el deploy de producción, confirmá que la función usa las variables de **Production**, que TTS sintetiza una respuesta breve y que el uso aparece en el proyecto Google Cloud de voz productivo. No hagas pruebas con escrituras comerciales en producción.

No copies datos de Firebase de pruebas a producción. La promoción solo traslada código revisado y configuración productiva separada.

Cloud TTS admite ADC en sus librerías; las cuentas de servicio requieren permisos IAM de síntesis según la configuración vigente del proyecto. Si el proyecto de cuota lo requiere, Google documenta `roles/serviceusage.serviceUsageConsumer`. [Autenticación de Cloud TTS](https://docs.cloud.google.com/text-to-speech/docs/authentication).

## Costos y límites

El registro mide duración de entrada cuando el navegador la proporciona y caracteres solicitados a Chirp; no persiste contenido. Google lista un primer millón mensual gratuito para Chirp 3 HD y luego USD 30 por millón de caracteres; espacios y saltos de línea cuentan. El límite predeterminado de Olivia es 50.000 caracteres TTS por mes, equivalente a un máximo de USD 1,50 de Chirp si la cuota gratuita ya se consumió. GPT Transcribe cuesta USD 0,0045/minuto. Las respuestas de Luna se cobran aparte por tokens y varían según historial, herramientas y longitud. Las tarifas y condiciones pueden cambiar; el costo final puede variar por cuota gratuita, impuestos y conversión. [Tarifa de GPT Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe) · [Tarifa de Cloud TTS](https://cloud.google.com/text-to-speech/pricing).

Netlify documenta un tope de 60 segundos y 20 MB para funciones con respuesta streaming. La configuración limita el texto por turno y la cuota mensual para contener consumo. Los errores de transcripción ofrecen reintento; los errores de síntesis conservan la respuesta escrita y permiten reintentar el audio.

## Validación pendiente para uso real

Sin secretos de proveedores, el backend cloud no puede confirmar una respuesta real de Chirp ni su precio final. La aceptación de audio, el comportamiento de barge-in, voces, ruido y reproducción deben verificarse con micrófono/altavoz en Chrome y Safari/iPhone antes de habilitar usuarios adicionales. La respuesta de la API confirma que el backend recibió el stream; no prueba la salida física del dispositivo.
