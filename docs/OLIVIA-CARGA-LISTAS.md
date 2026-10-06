# Ingreso de listas con catálogo faltante

El 6 de octubre de 2026 se revisó en Chrome la solicitud de diez productos para Local Lavalle. Al recuperar el intento, el error guardado fue «La consulta necesita dividirse en pasos más pequeños». La carga anterior preparaba un producto por vez y podía superar el límite de herramientas/rondas. Además, `prepare_product_create` solo abría una revisión manual: no creaba el catálogo.

## Flujo agregado

`prepare_catalog_stock_load` recibe hasta 40 líneas en una sola preparación. Resuelve nombres en el catálogo completo, reutiliza productos y categorías existentes, propone categorías faltantes y abreviaciones únicas basadas en el nombre. Normaliza mayúsculas, acentos, espacios de unidades y singular/plural de categorías. No cambia precios, categorías ni ajustes de productos existentes. Los nombres parecidos o repetidos devuelven opciones verificadas antes de crear un duplicado.

Para un producto nuevo necesita categoría y precio de venta. La categoría puede proponerse por tipo de producto cuando el usuario autorizó crearla; el precio nunca se inventa. Si falta, se pregunta únicamente por esos productos y se conserva la lista entera en la tarea. Un precio cero debe ser indicado explícitamente. Al completar o corregir datos se vuelve a preparar toda la lista.

La tarjeta muestra destino, productos/categorías a crear, nombres, abreviaciones, precios, cantidades y stock antes/después. No hay escrituras comerciales al preparar. Solo **Sí en la tarjeta** reconstruye el plan contra una transacción de Firestore y confirma conjuntamente categorías, productos, stock, movimientos, operación y auditoría. Cancelar no escribe; doble confirmación no duplica el ingreso. Un cambio de datos o permisos invalida la propuesta completa.

Las líneas repetidas del mismo producto se suman si los datos son compatibles. Una inconsistencia de precios/categorías, producto o asignación inactivos, abreviación ocupada o cantidad inválida bloquea la lista sin una creación parcial. No publica productos en ecommerce. La creación individual anterior conserva su revisión manual; esta capacidad corresponde al nuevo flujo combinado solicitado.

## Acceso y lecturas

Requiere administrador activo, lectura del catálogo y permisos de stock de ubicaciones. Crear faltantes requiere `products.create`; categorías nuevas, `products.edit`; nuevas asignaciones locales, `locations.configureLocationProducts`. Revalida el perfil desde Firestore al confirmar y respeta denegaciones explícitas. Vendedores no reciben la herramienta. Cada cambio deja correlación de usuario, conversación, preparación y confirmación con origen «Asistente IA / Olivia».

Las lecturas del catálogo/categorías incluyen todas las páginas y se limitan a 5.000 documentos por colección. Si excede el límite se informa el problema: no se trata un catálogo truncado como si estuviera completo. La confirmación lee el catálogo en la misma transacción. Se cachean lecturas repetidas y se consultan documentos independientes hasta tres en paralelo.

## Verificación local

814 pruebas generales aprobadas, incluidas diez pruebas nuevas. La lista de diez líneas suma **768 unidades**: el fixture verifica preparación completa, nueve altas y tres categorías nuevas, reutilización de una categoría y del producto existente, stock 4 → 544 y conservación del precio especial y alertas. Comprueba confirmaciones simultáneas, cancelación, cambios concurrentes, pérdida de permisos, repreguntas/correcciones, nombres parecidos, líneas repetidas, auditoría y paginación transaccional.

Los nombres/cantidades del caso se usan en fixtures locales con precios ficticios. No se confirman ingresos en la base empresarial durante las pruebas. La entrega se actualiza en el PR 37 y su Deploy Preview; no se hace merge a main ni se despliegan reglas/índices o producción. La conversación por voz permanece pausada.
