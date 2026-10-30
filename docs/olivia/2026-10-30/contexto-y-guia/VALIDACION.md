# Validación de contexto y guía

- Rama `codex/olivia-context-guidance`, creada desde `origin/main` actualizado (`985032a`) e incorpora la preview anterior #49 (`8e42097`). La revisión hacia main es acumulativa; no se integró ni desplegó producción.
- `npm test`: **1055/1055** correctas. Incluye la secuencia de la conversación revisada, datos parciales, pausa/retoma, reformulación, aceptación de la última versión, rechazo, idempotencia, revocación de permisos y ausencia de escrituras comerciales al explicar o documentar.
- `npm run build:gestion`: correcto. Solo permanece el aviso anterior de tamaño de chunks. `git diff --check`: correcto.
- `node scripts/audit-olivia-guidance.mjs`: **69 herramientas, 18 módulos, cero campos mínimos sin guía**. La auditoría estática distingue lectura, confirmación visual, revisión manual y herramientas deshabilitadas; no equivale a ejecutar manualmente cada función con datos reales.
- QA de Chrome local con la interfaz y motor reales, adaptador en memoria y proveedor de redacción simulado: inicio de ubicación con nombre/código explicados, pedir detalle, documentar la mejora, reformular y retomar. Historial y datos ficticios; cero llamadas a Firebase, OpenAI o Google TTS. Evidencias en `evidence/`.
- La conversación original se leyó en la única pestaña de Chrome de la preview #49 indicada por el usuario; no se modificó ni se copió su historial al repositorio.
- Se retiró el DNI de creación/edición de ubicaciones y de sus nuevas escrituras. Se comprobó que ninguna lectura de ventas usa `dniMode`. No se migraron ni borraron campos de documentos históricos. La identificación fiscal conserva su flujo propio.
- No se generaron nuevos audios, no se cambiaron modelos ni se añadieron dependencias. No se enviaron sugerencias remotas, no se crearon ubicaciones ni se alteró stock remoto durante esta revisión. La aceptación de sugerencias se probó únicamente con notificaciones ficticias en memoria.
- El destino remoto de pruebas es `app-integral-fm-pruebas`; la configuración por contexto y las credenciales del servidor no fueron cambiadas. Los resultados de CI, Netlify y verificación del frontend publicado se agregan al PR tras el despliegue. No se probaron escrituras autenticadas remotas.

## Recorrido sugerido en la preview

1. «¿Podés crearme una nueva ubicación?» → explica nombre y código con ejemplos, sin pedir DNI.
2. «¿Me repetís más detalladamente qué necesitás de mí?» o «¿Qué es el prefijo?» → explica, conserva lo ya reunido.
3. «Documentá que quiero que me expliques los campos con ejemplos cada vez que cree algo» → guarda un borrador en ese chat y muestra qué propondría a Agustín.
4. «¿Me lo podés decir de otra manera, más simple?» → reformula el borrador, sin enviarlo.
5. «No lo envíes» → descarta el envío; o «Sí, enviáselo a Agustín» → envía únicamente la última propuesta mostrada, si la cuenta destinataria sigue disponible.
6. «Retomemos la ubicación» → recupera la tarea. Para validar las escrituras en la preview, verificar primero el entorno según `docs/FIREBASE-PRUEBAS.md` y usar exclusivamente nombres y datos ficticios.

Las mejoras se documentan dentro del chat y vencen con su retención. Olivia no cambia su propio software ni promete recordar el borrador entre conversaciones. Esta versión aplica la guía natural como comportamiento general. La comprensión libre del modelo y el audio en dispositivos físicos requieren además revisión humana; no se promete comprensión perfecta de cualquier frase.
