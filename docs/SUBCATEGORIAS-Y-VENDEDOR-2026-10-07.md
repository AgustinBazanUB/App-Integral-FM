# Subcategorías y catálogo del vendedor

La categoría principal conserva su botón de apertura exclusiva. Dentro aparecen filas con títulos de subcategoría que siempre permanecen abiertas. Los productos se desplazan horizontalmente con touch, trackpad, rueda o teclado; al llegar a un extremo la rueda permite continuar el desplazamiento vertical. Las barras siguen ocultas.

El catálogo vendedor muestra foto, abreviación y stock total del inventario seleccionado. El nombre completo se conserva en el título y nombre accesible, y el precio sigue en Lista de precios y en la venta. Botonera y controles de venta conservan sus funciones. En móvil, ubicación y botonera comparten una fila, los seis íconos miden 21,6 px (antes 18 px), y Olivia y el perfil se alinean en el encabezado. El círculo del perfil abre directamente sus opciones; no hay flecha adicional.

## Datos y administración

`productCategories/{id}.subcategories` guarda un array de `{id,name,sortOrder}`. El producto conserva `categoryId` y agrega `subcategoryId/subcategoryName`. Crear una subcategoría y asignar un producto exige permiso de edición de Productos; la categoría/subcategoría se valida contra el catálogo. No se crean colecciones ni se amplían reglas.

Productos → Subcategorías permite crear nuevos grupos y aplicar la organización sugerida a los existentes. Guarda solamente las asignaciones claras y conserva asignaciones manuales, precios y stock. Antes de guardar, el vendedor y ventas rápidas pueden mostrar la sugerencia compatible de registros antiguos. Un `subcategoryId` vacío explícito conserva Sin subcategoría. Productos sin correspondencia nunca desaparecen. Los grupos definidos vacíos permanecen visibles dentro de las categorías con productos.

| Categoría | Subcategorías iniciales |
| --- | --- |
| Aceite de Oliva | Botellas 500 ml, botellones 2 L, bidones 5 L |
| Almendras | Naturales, con sal |
| Pistachos | Pelados; con cáscara, tostados y salados |
| Pasas de Uva | Morochas, rubias (existentes sin otro tipo → morochas) |
| Aceitunas | Verdes; negras (griegas y portuguesas) |
| Nueces | Mariposas; pecanas (los productos que ya dicen Pecan se conservan como pecanas) |
| Vinos | Santa Brasa, Gritos, Blancos, Reserva, Gran Reserva |
| Mermeladas | Frascos 400 g, 220 g |
| Cremas Corporales | Oliva, Malbec; conserva los gramajes actuales sin renombrarlos |

Pasta de Aceitunas y Sales permanecen sin subdivisión inicial. Los nombres sin tamaño suficiente quedan pendientes de asignación manual; no se adivina su presentación.

## Unificación del duplicado de aceitunas

Productos → Unificar producto prepara un detalle por inventario, y sólo después confirma la unificación. La función autenticada `catalog-merge` valida administrador activo otra vez dentro de la transacción; no acepta usuario, rol, precios ni cantidades enviados por el cliente. Lee todos los locales/depósitos y sus stocks, comprueba referencias activas y conserva un fingerprint de la revisión. Una modificación concurrente rechaza la confirmación para volver a revisar. La operación es atómica e idempotente.

Traslada `currentStock` de origen a destino en el mismo local/depósito, conserva precios y configuración existentes del destino, registra ambos movimientos y un audit log, y archiva el origen con `active:false/mergedIntoProductId`. Conserva documentos, stock inicial e historial; no hace borrados físicos ni reescribe ventas históricas. Si hay ventas anulables, pedidos/reservas o traslados pendientes del origen, rechaza la operación sin mover nada para no dejar referencias activas en un producto archivado. También rechaza cantidades inválidas/negativas y destinos desactivados con stock por recibir.

Duplicado solicitado: Aceitunas descarozadas (ACEITUNA). Destino: Aceitunas Verdes Sin Carozo 400g (ACEIT400). La preview comparte Firebase: guardar la organización o confirmar el traslado modifica el catálogo/inventario compartido; desplegar código de preview por sí solo no modifica esos datos.

Pruebas: clasificación, grupos vacíos y no asignados, prioridad manual, maestro sobre stock antiguo, creación/asignación con permisos, conservación de unidades por origen, precios del destino, idempotencia concurrente, cambio de fingerprint, rechazo por permisos/referencias/stock inválido y conservación del historial. QA visual de computadora y teléfono se realiza sobre la preview, sin confirmar ventas.

## Consulta y ayuda del vendedor

Las tarjetas móviles son un 20% más estrechas; el marco de imagen pasa de 56 a 67,2 px y centra la foto verticalmente sin recortarla por CSS. Abreviación y «Stock N» comparten fila. Las barras verticales del vendedor vuelven a ser visibles con un indicador dorado claro y pista transparente; las filas horizontales del catálogo y descuentos conservan desplazamiento discreto.

Stock restante y Lista de precios reutilizan las mismas categorías y subcategorías del catálogo: todas las categorías empiezan abiertas al entrar a cada vista y pueden cerrarse; las subcategorías no tienen cierre. Stock restante conserva las reservas de ventas pendientes del dispositivo en el cálculo disponible.

Monto activo abre una consulta por medio de pago de las ventas propias del día y ubicación. Excluye anuladas y distribuye pagos combinados por sus importes. Conserva medios históricos y señala cualquier diferencia entre total y desglose para revisión, sin inventar cobros. No modifica ventas ni stock.

Se elimina Ayuda del menú y de la navegación autorizada de Olivia. La guía `operar-panel-vendedor` 1.1.0 y conocimiento 2026-10-07.1 explican catálogo, cantidades, descuentos confirmados, pagos, cliente, solicitud fiscal, pendientes, stock, precios y consulta de cobros. Las consultas sobre cómo usar una función deben responder con pasos, sin preparar ventas automáticamente. Se mantienen los permisos y la conversación por voz deshabilitada.
