# Conocimiento permanente

Configuración incluye la biblioteca administrativa. Publicar exige seleccionar PDF, DOCX o TXT, módulo y audiencia, revisar un resumen y confirmar. El formulario tiene backend y validación de contenido; vendedores no pueden publicar ni retirar.

Los documentos se cargan en OpenAI Files y un vector store controlado por el servidor. Sus atributos incluyen ID local, módulo y audiencia. La publicación se audita y muestra indexando, disponible o error. La lista pagina de a 100 documentos y consulta como máximo cinco indexaciones por actualización.

La búsqueda semántica filtra por módulos autorizados. El vendedor solo puede recibir documentos de audiencia seller y módulo seller. Cada resultado se cruza con el registro local activo, indexado y su file ID; atributos suministrados por el proveedor no sustituyen esa verificación.

Texto recupera conocimiento automáticamente. La herramienta `search_knowledge` permite el mismo retrieval autorizado en Realtime. Los fragmentos se identifican como datos no confiables y nunca conceden permisos ni sustituyen confirmaciones. El fallback conserva los 55 fragmentos curados previos cuando no existe biblioteca o el proveedor falla.

Retirar revoca primero la autoridad local y deja auditoría antes de borrar en el proveedor. Si la limpieza externa falla, el documento permanece retirado, muestra la limpieza pendiente y admite reintento manual/programado. Los fallos de publicación también conservan metadatos necesarios para limpiar recursos.

Las cargas tienen identidad y hash para evitar publicaciones duplicadas. Los costos de almacenamiento se muestran como no medidos; no se inventa costo cero. La biblioteca no incorpora documentos automáticamente desde los adjuntos.
