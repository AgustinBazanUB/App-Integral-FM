# Respuestas legibles de Olivia

La consulta de ingreso de diez productos se completó en Chrome, pero el resumen, las repreguntas y la confirmación se mostraban como texto corrido. El formato nuevo presenta párrafos, subtítulos, listas numeradas y anidadas, negritas, cursivas, citas, código y tablas con desplazamiento horizontal.

El mismo componente se usa en los mensajes finales, la respuesta mientras se escribe, la tarjeta Sí/No y el historial administrativo. Las instrucciones de Olivia solicitan Markdown con una respuesta directa al principio y listas cuando hay varios productos, requisitos o ideas. Las respuestas simples conservan su brevedad. El aspecto se adapta al ancho del panel y utiliza las tipografías y colores de Flor Mía.

Las propuestas antiguas de ingreso de mercadería y sus datos faltantes se presentan con subtítulos y un elemento por producto o requisito. La transformación es visual: no modifica el historial guardado, los datos de la operación, los permisos ni el mecanismo de confirmación. Los nombres del catálogo se tratan como texto literal. Las demás respuestas se interpretan como Markdown estándar.

Se usa react-markdown con remark-gfm, sin HTML activo. Solo los enlaces HTTP(S) sin credenciales se pueden abrir; las imágenes en Markdown muestran su texto alternativo y no descargan contenido externo. Los adjuntos conservan su flujo propio.

Verificación: 817 pruebas generales y build aprobados localmente. La prueba de renderizado comprueba estructura real, tablas y listas, datos y nombres preservados, HTML/enlaces peligrosos, imágenes remotas y respuestas incompletas durante streaming. La entrega continúa en el PR draft 37 y su preview conjunta; no se hace merge ni se publica producción.
