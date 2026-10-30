# Voz natural de Olivia

## Ruta vigente (revisión 30/10/2026)

Una conversación usa micrófono/VAD local → GPT Live Transcribe (`gpt-live-transcribe`) por WebRTC → motor y herramientas de Olivia → texto canónico y resumen hablado → Google Cloud TTS Chirp 3 HD/Aoede, PCM mono a 24 kHz. GPT Transcribe (`gpt-transcribe`) conserva la ruta de archivo cuando corresponde; no se incorporó otro proveedor. Los antiguos modos Live conversacional/Realtime multimodal siguen retirados; la transcripción Live actual es una sesión dedicada a STT.

El endpointing adaptativo, los límites, el flag de reversión y las trazas se describen en [la auditoría de latencia](olivia/2026-10-29/latencia-v3/AUDITORIA.md). La política actual mantiene Luna NONE/MEDIUM y Sol creativo HIGH/XHIGH en los módulos autorizados. Las respuestas de conversación simples reutilizan audios estáticos; no se regeneraron para esta revisión.

La voz conserva interrupciones, cancelación de respuestas obsoletas, transcripción parcial con pistas de vocabulario y ventanas limitadas de sesión. Hablar no otorga permisos: las operaciones comerciales requieren la tarjeta visual. La respuesta escrita contiene el detalle; la hablada resume los mismos hechos. Para código, explica el resultado y remite al fragmento en pantalla, sin leerlo completo.

Las guías se ofrecen en el chat y el usuario inicia los resaltados. El contexto incluye el paso visible y códigos de validación, sin valores de formulario. Pedir siguiente, anterior, explicar, pausar o cancelar una guía usa los pasos registrados; no hace clic ni registra operaciones.

El audio entrante se procesa en memoria y no se guarda como grabación del negocio. La transcripción y las respuestas se conservan con la retención de conversación. Los límites de sesión, caracteres TTS y cupo de uso permanecen en los contratos del servidor. Las métricas indican programación de audio, no salida física por el altavoz.

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

La integración visual, estados, pausas y validación del Equalizer Orb se documentan en [OLIVIA-EQUALIZER-ORB.md](OLIVIA-EQUALIZER-ORB.md).
