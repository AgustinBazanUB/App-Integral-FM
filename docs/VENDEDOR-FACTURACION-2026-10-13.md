# Facturación y anulación desde Panel Vendedor

La rama de revisión incorpora la actualización de `main` del 13 de octubre y
conserva las mejoras de vendedor, CAE, PDF y Gmail del 9 de octubre. El sitio
principal todavía usa otra versión; esta entrega se revisa en un deploy sin
publicar y no hace merge a `main`.

## Emitir y entregar

**Generar factura** abre el mismo formulario en Vendedor y Venta Rápida:
consumidor final, responsable inscripto, monotributista, exento u otra condición.
El consumidor final permite DNI opcional, sujeto al umbral fiscal configurado.
Los otros receptores requieren CUIT/CUIL y consulta al padrón. El servidor vuelve
a resolver la condición real; la selección del navegador no fuerza una clase.

Antes de registrar la venta se comprueban los gates de emisión, documentos,
productos, IVA y total con descuentos. Luego se registra una única venta y se
solicita su CAE en el mismo flujo. Si ARCA falla después del registro comercial,
la venta permanece guardada y su factura puede completarse desde esa misma
venta; no se pide al vendedor que vuelva a cargarla. Los resultados inciertos
se consultan antes de cualquier nueva emisión.

El comprobante registrado y Mis ventas reúnen descargar PDF, imprimir y enviar
por mail. El detalle muestra productos, precio unitario, subtotal, descuentos,
total, desglose de pagos y cliente asociado. La interfaz no ofrece un ticket
separado. Los campos internos `ticketRequested`/`ticketStatus` se conservan para
compatibilidad con ventas históricas y reglas existentes.

## Anular venta y factura

La factura emitida se conserva: la reversión fiscal se realiza mediante una
nota de crédito vinculada por `CbtesAsoc`. La anulación total de A usa tipo 3 y
la de B tipo 8, con los importes, IVA, receptor y emisor de la factura original.
Los importes no se recalculan a partir del catálogo actual.

El endpoint autenticado `sale-cancel` valida permisos, titularidad, ubicación,
stock y vínculo fiscal. Reserva la anulación en una transacción y crea una única
nota de crédito por factura. Reutiliza el motor de CAE, sus locks de numeración,
idempotencia, conciliación y verificación. Solamente después de confirmar la
nota en ARCA anula la venta y restituye el stock en una transacción con
movimientos y auditoría. Un reintento no crea otra nota ni restituye stock otra
vez. Si el resultado es incierto, la venta permanece activa con anulación
pendiente; se permite continuar para consultar el resultado, sin reenviar CAE.

Una solicitud fiscal sin emisión se cancela sin crear nota de crédito. Una
solicitud con autorización en curso o resultado incierto bloquea la anulación
hasta aclarar su estado. Las reglas Firestore impiden crear, editar o eliminar
desde el navegador la reserva de anulación y sus campos fiscales.

Mis ventas conserva la factura original para descargar, reimprimir o reenviar,
y muestra también el PDF y correo de la nota de crédito. Leer una nota nunca
reemplaza el vínculo de la factura original en la venta.

## Validación

Pruebas de borrador fiscal, descuento, consumidor final y padrón; anulación
sin factura; notas A/B; estado incierto; verificación fallida; permisos; stock
faltante; lectura de nota; idempotencia; reglas Firestore y compilación.
La revisión visual utiliza datos ficticios aislados de Firebase y ARCA.
Las comprobaciones del preview reutilizan facturas existentes; no emiten nuevas
facturas ni anulan ventas reales ni envían correos de clientes.

Fuentes:
[Comprobantes ARCA](https://www.arca.gob.ar/facturacion/comprobantes/) y
[WSFEv1 4.7](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf).
El enlace inmutable actualizado y el resultado de CI se mantienen en
[PR #38](https://github.com/AgustinBazanUB/App-Integral-FM/pull/38).
