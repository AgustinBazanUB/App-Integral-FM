# Actividad: filtros y desglose

El módulo Actividad incorpora filtros del mismo tamaño, con selección dorada y contraste oscuro. El directorio de usuarios se consulta por separado para administradores: incluye usuarios sin actividad, inactivos y dados de baja, y distingue cuentas con nombres repetidos. Un usuario sin coincidencias muestra un estado vacío; una búsqueda todavía incompleta permite continuar sin declarar que no existen registros.

La actividad se ordena desde la más reciente y combina auditoría, ventas y movimientos sin repetir la creación de una venta ni ocultar sus ediciones o anulaciones. Cada consulta conserva su límite temporal al continuar páginas. Cambiar filtros descarta resultados pendientes de la selección anterior. La búsqueda por filtros dispersos tiene un límite de lectura por página y conserva el cursor para continuar.

Cada fila abre un detalle accesible por clic, toque o el botón con teclado. Las ventas presentan productos, cantidades, precios, total, descuentos y pagos. Stock presenta movimientos y cantidades anteriores/resultantes; configuración muestra los cambios registrados. Los demás eventos presentan los campos de negocio disponibles y sus referencias. Cerrar o cambiar de detalle invalida las respuestas pendientes; los fallos permiten reintentar.

Las nuevas ventas del plan compartido (manual y Olivia), sus ediciones y anulaciones guardan un desglose histórico de productos y montos. Las configuraciones y cambios existentes aprovechan sus valores guardados. Si un evento antiguo necesita leer el documento relacionado actual, la pantalla lo advierte explícitamente; no reconstruye ni inventa valores históricos ausentes. Si el registro ya no existe o no se puede leer, se conserva la información disponible de la auditoría.

Las lecturas conservan permisos de Firestore. Los detalles admiten sólo colecciones/rutas conocidas y campos de negocio seleccionados; no muestran objetos técnicos arbitrarios ni credenciales. El directorio completo sólo se consulta en administración. No se modifican reglas, índices, ventas ni stock para revisar la interfaz.

Validación local: 889 pruebas generales aprobadas, incluido orden/paginación, deduplicación, filtros dispersos, usuarios sin registros, snapshots históricos, configuración, rutas de stock y privacidad. Compilación Vite aprobada; CI valida además reglas y ARCA. Publicación únicamente en la preview del PR 37, sin merge a main.
