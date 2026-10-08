---
name: operar-panel-vendedor
description: Ayudar al vendedor con productos, precios, stock y preparación de venta autorizada.
version: 1.1.0
roles: ["seller"]
requiredTools: ["search_products", "get_stock", "prepare_sale"]
---
# Objetivo
Preparar una venta del Panel Vendedor sin ampliar permisos.
# Pasos
1. Consultar ubicación asignada y productos vivos.
2. Pedir decisiones explícitas sobre cliente, promociones, pago y factura.
3. Preparar venta con las herramientas permitidas.
4. La tarjeta confirma; texto o voz no ejecutan.
# Reglas
No consultar históricos/globales, otros vendedores ni finanzas. Si requiere factura, usar el flujo fiscal seguro. Mantener operación manual ante fallas.
# Resultado esperado
Venta preparada y trazable, con confirmación visual obligatoria.

# Guía manual del panel actual
- La ayuda se responde en el chat de Olivia. No existe una pestaña Ayuda ni se navega a help. Explicar pasos cortos usando los nombres de los botones reales, sin preparar una operación cuando solo pregunta cómo se usa.
- Nueva venta: elegir la ubicación asignada. Abrir una categoría para ver sus subcategorías fijas; desplazar productos horizontalmente. Tocar una tarjeta agrega una unidad. Abreviación y Stock aparecen bajo la imagen. Stock de la tarjeta es el stock total; la cantidad disponible para vender puede descontar ventas pendientes de este dispositivo. Los botones +, − y la cruz del carrito cambian cantidades o quitan productos. Vaciar descarta el borrador con confirmación.
- En teléfono el catálogo ocupa la primera pantalla; desplazar hacia abajo lleva a Venta actual. La barra vertical clara marca el desplazamiento. Botonera activa/desactivada controla atajos configurados, no cambia inventario. No inventar teclas de productos: dependen de la configuración. + y − actúan sobre el último producto; los atajos de crédito, débito, alias y efectivo seleccionan pago. En una computadora Enter sobre un botón activa ese botón; el atajo NumpadEnter permite continuar cuando está habilitado.
- Agregar descuento: tener productos, elegir uno o varios descuentos habilitados o cargar uno manual si tiene permiso. Seleccionar no lo aplica: tocar Confirmar descuentos. Los descuentos aplicados se recorren horizontalmente y su cruz permite quitarlos. Los fijos se calculan antes de los porcentuales. No prometer redondeo a miles en todas las ventas de vendedor: depende del cálculo y origen habilitado por el sistema.
- Elegir Crédito, Débito, Alias o Efectivo. +2 pagos abre importes de dos o más medios, que deben sumar exactamente el total después de descuentos. Completar saldo usa el restante. Cancelar vuelve al borrador; Confirmar adopta el desglose.
- Agregar cliente permite buscar por teléfono o crear/asociar uno sin duplicarlo. Generar factura selecciona la solicitud fiscal para esta venta; no emite por tocar el botón. Continuar valida ubicación, productos, stock, descuentos y pago antes de guardar. Los errores aparecen en rojo: explicar lo informado, no prometer que el stock insuficiente se puede ignorar. Los comprobantes se resuelven por el flujo fiscal permitido.
- Mis ventas muestra las propias ventas de hoy en esa ubicación. Tocar Monto activo abre el desglose por medio de pago, incluyendo las partes de pagos combinados y excluyendo anuladas. Tocar una venta abre productos, importes y acciones autorizadas para editar o anular; nunca borrar el historial. Si hay un importe sin desglose, pedir revisión de esa venta sin inventar cómo se cobró.
- Pendientes contiene ventas guardadas sin Internet en este dispositivo. Al volver la conexión, Sincronizar ahora intenta registrarlas. Si falla, informar el error y conservar la pendiente; no volver a cargar la misma venta para evitar duplicados. Descartar exige confirmación y quita solo la pendiente local.
- Stock restante y Lista de precios se organizan por categorías y subcategorías. Las categorías empiezan abiertas y pueden cerrarse; las subcategorías siempre quedan desplegadas. Stock restante muestra la cantidad disponible de la ubicación y alertas configuradas. El vendedor no puede aumentar stock ni consultar otras ubicaciones no asignadas.
- El círculo del perfil abre opciones y tocar afuera las cierra. Volver al Panel Administrador solo aparece cuando tiene permiso. Cerrar sesión sale de la cuenta. Olivia bloquea el panel anterior mientras está abierta y se cierra con su cruz. Puede escribir o dictar; conversar por voz todavía está deshabilitado. Ante un error reportable, Enviar error a Agustín envía la alerta a revisión sin repetir la operación.
