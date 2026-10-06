# Adjuntos

El botón + permite fotos/documentos y cámara cuando el dispositivo la admite. Cada adjunto muestra nombre, tipo, carga/error y acción de quitar; las imágenes tienen miniatura local. Los nombres y referencias se guardan con su mensaje.

Formatos: PDF, DOCX, XLSX, CSV, TXT, JPG/JPEG, PNG y WebP. Máximo cuatro archivos por mensaje y 4 MiB por archivo. El backend verifica extensión, MIME y firma/contenido; DOCX/XLSX permiten hasta 20 MiB expandidos y 512 entradas, rechazando macros, rutas inseguras y binarios.

`olivia-attachment` limita el multipart realmente leído, incluso sin Content-Length. El archivo pertenece a usuario, conversación y sesión; su vencimiento es el menor entre 24 horas y el de la conversación. El proveedor recibe `purpose=user_data` y política de expiración. Cada usuario dispone de 40 intentos diarios; reintentos válidos no repiten la carga y el hash del contenido impide reutilizar una identidad con otro archivo.

Responses recibe `input_file` o `input_image`; referencias anteriores se vuelven a autorizar y se limitan a cuatro en el contexto reciente. Un archivo vencido debe adjuntarse nuevamente. No se entrega un enlace público ni una clave del proveedor.

Quitar antes de enviar revoca la miniatura local. Los archivos temporales restantes vencen y se eliminan con `olivia-resource-retention`; una falla de limpieza conserva el identificador para reintentar. Las funciones programadas de Netlify se ejecutan en el despliegue publicado, no en un borrador.

El conocimiento permanente se publica por separado desde Configuración. Las planillas e imágenes permanecen como contexto del chat. El estimado escrito no pretende medir cargos adicionales de archivos ni almacenamiento semántico.
