# Flor Mía — Diseño de Envíos v0.7 (propuesta, sin implementación)

**Base visual:** repositorio App-Integral-FM, tokens de `src/styles/tokens.css`, `src/styles/theme.css` y estructura `ManagementShell.jsx`.

## Navegación y organización aprobadas para probar

- Gestión de Envíos muestra únicamente **Tablero**, **Solicitudes del vendedor** y **Mis preparaciones y etiquetas**.
- El botón **Cargar un envío · Venta Rápida** abre el módulo existente de Venta Rápida. No existe un formulario independiente de alta en Gestión de Envíos.
- **Detalle y GPS** se abre al seleccionar un envío; no aparece como pestaña superior.
- La vista de **Envíos asignados** también existe en Panel Vendedor a continuación de **Precios**.
- Los portales del **personal interno**, **repartidor** y **cliente** son páginas independientes, no pestañas administrativas.

## Incidencias y notificaciones

- Ningún banner urgente encima del tablero; cada envío afectado presenta un marcador rojo en su propia fila.
- La alerta crítica general se ve en la campana de **Notificaciones**.
- Las incidencias de preparación (falta de stock, falta de embalajes, daños, otros) pueden reportarse desde el QR del personal, y las del reparto desde su portal.

## Escaneo del QR

- Primero se elige **Soy personal de Flor Mía** o **Soy repartidor**.
- **Personal de Flor Mía:** acceso autenticado, datos y productos, botón único **Pedido preparado y listo para retirar**, o **No puedo preparar el pedido**.
- **Repartidor:** una única acción principal contextual según el estado actual. Para Repositorio: retiro del origen, llegada al repositorio, salida del repositorio, entrega; para entrega directa: retiro y entrega.
- La solicitud GPS debe ser discreta y solo mostrarse cuando corresponde seguir el tramo final.
- Existe acceso a Google Maps para llegar al destino: el primer tramo a repositorio requiere su dirección configurada, no se inventa.
- **Cliente:** acceso independiente y solo de lectura; estado y mapa ilustrativo.

## Conservación de arquitectura funcional

- Venta Rápida descuenta stock al confirmar la venta desde el origen seleccionado.
- Panel Vendedor con envío registra la venta sin descontar stock: la autorización administrativa determina el origen y ejecuta un solo descuento.
- Los pedidos se crean exclusivamente a través de las ventas; no se generan pedidos mediante Gestión de Envíos.
- PDF de múltiples etiquetas A4, una etiqueta y un QR independiente por pedido.

## Alcance de la maqueta

Los datos son ficticios y el prototipo no tiene Firebase, GPS, autenticación, impresora de producción ni gestión real de pedidos. El mapa es ilustrativo; los QR codifican identificadores de demostración y no permiten operar pedidos. El enlace automático de WhatsApp queda pendiente para una etapa posterior.
