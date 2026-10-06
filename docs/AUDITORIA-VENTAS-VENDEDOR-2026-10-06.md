# Panel Vendedor: registro de ventas y descuentos

Fecha: 6 de octubre de 2026. Base: `origin/main` en `b53510b`.
Producción observada: `https://appintegralflormia.netlify.app/vendedor`.

## Motivo del bloqueo observado

Al iniciar la revisión en Chrome había cinco unidades, Promo 2 AOVE y total
$101.000. Ningún medio de pago estaba seleccionado. `Continuar` tenía `disabled`
y no permitía ejecutar la validación que ya explicaba la falta de pago.
La revisión fue de lectura; no se confirmó ninguna venta real.

La carpeta principal estaba en una rama anterior a producción. El cambio se
desarrolló en un worktree desde el main actual para conservar precios de
inventario, integración fiscal y la política vigente de stock negativo.

## Correcciones

- Continuar, confirmar pagos, completar saldo, confirmar descuentos, vaciar y
  sincronizar permiten tocar y explican las validaciones pendientes. Las acciones
  que están guardando conservan la protección contra envíos simultáneos.
- Los errores aparecen en rojo debajo de la acción, con un código y una
  explicación en castellano. Los errores de permisos, conexión, sesión,
  transacciones y almacenamiento local tienen traducción. Un error desconocido
  muestra su código sin volcar datos internos.
- Los descuentos guardados y manuales se editan como un borrador. Se aplican al
  pulsar **Confirmar descuentos**. Cancelar, cerrar y Escape descartan el borrador.
  También se pueden deseleccionar descuentos ya aplicados y confirmar su retiro.
- Los atajos de descuentos abren una propuesta para confirmar. Un atajo de pagos
  combinados abre el desglose, en lugar de seleccionar un pago sin importes.
- Si cambia el total, los importes de pagos combinados se conservan para corregir
  la diferencia. Si una promoción deja de estar disponible, se explica su retiro.
- Las líneas del carrito conservan la categoría para evaluar promociones por
  categoría. Un producto retirado del catálogo queda identificado y la
  validación indica que hay que quitarlo del carrito.
- Al cambiar de ubicación se vacía el stock de la anterior hasta cargar el nuevo.
- Una venta guardada conserva el recibo aunque falle la consulta posterior de
  Mis ventas. El mensaje aclara que ya se registró y que no hay que cargarla otra
  vez. Lo mismo se aplica al guardado local y a la anulación confirmada.
- La sincronización tiene una protección inmediata contra dobles intentos y
  siempre libera su estado de carga, incluso si falla leer IndexedDB.
- Enter sobre un botón activa ese botón. NumpadEnter conserva el atajo de venta.
- Se quitó `cursor: not-allowed` de los estilos de toda la aplicación. Los
  controles ajenos al vendedor conservan sus validaciones y estados actuales.

El stock cero o negativo **no bloquea** la venta presencial: se mantiene la
advertencia existente, el movimiento de stock y su registro de auditoría.
No se modificaron permisos ni reglas de Firestore.

## Códigos para informar problemas

Copiar el mensaje completo, indicar qué botón se tocó, ubicación y hora. No
hace falta enviar teléfonos de clientes ni credenciales.

| Código | Qué indica |
| --- | --- |
| `PAGO-FALTANTE` | Falta seleccionar cómo se cobró. |
| `PAGO-DESGLOSE` | Importes inválidos, medios repetidos o diferencia con el total. |
| `PAGO-TOTAL-CAMBIO` | Hay que ajustar el desglose porque cambió el carrito o descuento. |
| `VENTA-VACIA` | Todavía no hay productos. |
| `VENTA-UBICACION` / `VENTA-CARGANDO` | Falta ubicación activa o terminar de cargar sus productos. |
| `PRODUCTO-NO-DISPONIBLE` / `PRODUCTO-PRECIO` | Producto retirado o precio inválido. |
| `DESCUENTO-FALTANTE` / `DESCUENTO-NO-DISPONIBLE` | Falta selección o dejó de estar habilitado. |
| `DESCUENTO-MONTO` / `DESCUENTO-PORCENTAJE` | Valor manual inválido. |
| `VENTA-PERMISO`, `PAGO-PERMISO`, `TICKET-PERMISO` | El perfil no puede realizar esa acción. |
| `permission-denied` | El servidor rechazó la operación por permisos o reglas. |
| `unavailable` / `deadline-exceeded` | Fallo de conexión o respuesta demorada. |
| `QuotaExceededError` / `SecurityError` | Almacenamiento local lleno o bloqueado. |
| `PENDIENTES-REVISAR` | Ver el motivo individual de cada pendiente. |

## Verificación

- `npm test`: 530 pruebas aprobadas, ninguna fallida.
- `npm run build`: aprobado; persiste la advertencia previa de chunks mayores
  a 500 kB, ajena a este cambio.
- Pruebas de regresión del dominio y handler real: medios de pago, permisos,
  productos retirados, doble click, error posterior al guardado, cola offline y
  teclado. Servicios sustituidos por adaptadores locales.
- Eventos del componente real de descuentos: selección sin aplicar, confirmar,
  cancelar/reabrir, retiro del último descuento, manual inválido, permisos y
  promoción que deja de estar disponible.
- Chrome con el panel real y servicios ficticios: total $10.000 sin cambios al
  seleccionar; $9.000 después de confirmar 10%; cancelar no aplica; pagos
  incompletos muestran la diferencia; pagos de $4.000 y $5.000 se conservan al
  editar; producto retirado muestra su nombre; el recibo sobrevive a un fallo de
  consulta de ventas.
- No se ejecutaron ventas de prueba en Firestore de producción ni pedidos ARCA.

## Seguimientos de la auditoría

1. El vendedor online todavía no tiene un identificador persistente de intento
   como Venta Rápida administrativa. El doble click queda protegido, pero un
   acuse de guardado perdido debe comprobarse en Mis ventas antes de reintentar.
   La mejora siguiente es reutilizar una misma identidad de intento entre
   reintentos y recargas, con pruebas de reglas para un vendedor puro.
2. La recuperación offline comprueba ubicación y descuentos antes de recuperar
   una venta ya existente. Conviene cubrir en emulador el caso de una venta
   guardada cuyo marcado local falló y cuya promoción venció antes del reintento.
3. La lectura de ventas del día se limita a 150 registros. En una ubicación con
   más ventas por vendedor se necesita paginación para revisar el día completo.

Estos seguimientos no se presentaron como causas comprobadas del bloqueo
observado; requieren una entrega específica de servicios y reglas.
