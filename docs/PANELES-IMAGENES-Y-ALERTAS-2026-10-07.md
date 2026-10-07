# Paneles, imágenes y alertas de Olivia

Cambios de PR #37, únicamente en deploy preview; no se hace merge a main.

Venta Rápida dedica más ancho al catálogo y limita Venta actual a 330 px en escritorio. La búsqueda y las tarjetas son mayores. Las categorías comienzan cerradas y abrir una cierra la anterior. El catálogo usa una grilla con desplazamiento vertical mediante rueda, trackpad o touch; sus barras quedan ocultas sin impedir el movimiento.

Un solo botón abre canal, tipo de origen y ubicación/depósito. Los tres campos forman un borrador: cancelar conserva la venta; confirmar valida todos antes de aplicar. Un cambio de origen borra las cantidades, precios y descuentos guardados del origen anterior y cierra las categorías. Confirmar el mismo origen conserva el carrito.

El vendedor y Venta Rápida toman las imágenes actuales del catálogo maestro, en lugar de las copias antiguas del stock. El componente compartido intenta miniatura, imagen completa y finalmente el logo Flor Mía. Si falta la foto o fallan sus URLs, el logo muestra el tooltip “Falta cargar imagen de este producto”. Si también falla el logo, queda Flor Mía en texto. Subir una imagen nueva reinicia los intentos. Se preserva la imagen local de productos antiguos cuyo maestro no tiene ninguno de los campos de imágenes.

La carga inicial del módulo, la sesión y las ubicaciones del vendedor usa una pantalla blanca que cubre la ventana con el logo Flor Mía y “Cargando panel vendedor…”. El componente no hereda el contenedor estrecho del loading anterior. Las transiciones con recursos en caché mantienen el panel disponible.

Los reportes de Olivia se dirigen a la cuenta administradora activa `agsreserva@gmail.com`, verificada en el servidor y nuevamente antes de escribir. No dependen de nombres duplicados ni de parámetros de destinatario enviados por el cliente. El reporte conserva identidad del usuario, código, JSON y texto para Codex. Los envíos repetidos generan una sola alerta y los fallos de envío mantienen visible la causa original.

Las pruebas de regresión ejercitan destino exacto, usuario administrador que se reporta a sí mismo, cuentas inactivas/borradas, cambio concurrente de correo, privacidad, envío duplicado, prioridad del catálogo, imágenes fallidas/reemplazadas y validación/cancelación/confirmación del origen. No registran ventas ni modifican stock real.
