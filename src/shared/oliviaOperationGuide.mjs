// Human explanations shared by the runtime and the capability audit. These
// describe inputs; schemas, permissions and confirmation remain authoritative.
export const OPERATION_NAMES = {
  prepare_create_location: 'crear una ubicación', prepare_update_location: 'editar una ubicación',
  prepare_product_create: 'preparar el alta de un producto', prepare_customer_create: 'crear un cliente', prepare_customer_update: 'actualizar un cliente',
  prepare_stock_load: 'cargar stock', prepare_catalog_stock_load: 'cargar la lista de mercadería', prepare_stock_transfer: 'preparar una transferencia',
  prepare_sale: 'preparar una venta', prepare_batch_sales: 'preparar las ventas', prepare_expense_create: 'registrar un gasto',
  prepare_warehouse_create: 'crear un depósito', prepare_supplier_create: 'crear un proveedor', prepare_alert_create: 'crear una alerta',
  prepare_marketing_campaign: 'preparar una campaña en borrador', prepare_social_lead_create: 'registrar una consulta de redes',
  prepare_shipment_create: 'revisar un envío', prepare_shipment_update: 'revisar un envío',
  prepare_invoice_review: 'revisar la facturación de una venta', prepare_sale_cancellation_review: 'revisar la anulación de una venta',
  prepare_user_role_review: 'revisar los permisos de un usuario', prepare_configuration_review: 'revisar la configuración', prepare_ecommerce_order_review: 'revisar un pedido',
  forecast_fair: 'estimar la mercadería para una feria', forecast_product_demand: 'estimar ventas de un producto', creative_brief: 'preparar una propuesta creativa',
};
const nouns = { prepare_create_location: 'la ubicación', prepare_update_location: 'la ubicación', prepare_product_create: 'el producto', prepare_customer_create: 'el cliente', prepare_customer_update: 'el cliente', prepare_warehouse_create: 'el depósito', prepare_supplier_create: 'el proveedor', prepare_alert_create: 'la alerta', prepare_marketing_campaign: 'la campaña', prepare_social_lead_create: 'la consulta', prepare_expense_create: 'el gasto' };
export const FIELD_GUIDANCE = {
  name: 'el nombre con el que querés reconocer el registro', type: 'si se trata de un local permanente, una feria o un evento',
  codePrefix: 'un código corto para identificar sus ventas; por ejemplo, LC para Local Centro (hasta 8 letras o números)',
  abbreviation: 'una abreviación para reconocer el producto; por ejemplo, AO500 para un aceite de 500 ml (hasta 8 caracteres)',
  defaultPrice: 'el precio de venta en pesos; por ejemplo, 8500', description: 'una descripción del producto, si querés agregarla', categoryId: 'el nombre de la categoría del producto; voy a buscarla en el catálogo',
  phone: 'el teléfono del cliente, con código de área; sirve para encontrar su ficha y evitar duplicados', customerId: 'el nombre o teléfono del cliente que querés actualizar; voy a buscar su ficha',
  zoneId: 'la zona del cliente por su nombre', zoneName: 'el nombre de la zona del cliente',
  locationId: 'el nombre de la ubicación donde vamos a trabajar; por ejemplo, Local Centro', productId: 'el nombre del producto y su presentación; por ejemplo, aceite Arbosana de 500 ml',
  quantity: 'cuántas unidades querés cargar; por ejemplo, 12 botellas', reason: 'qué querés hacer o corregir y por qué',
  items: 'los productos y sus cantidades; por ejemplo, 12 botellas de aceite de 500 ml', lines: 'los productos, cuántas unidades salen y cuántas preparaste y recibiste físicamente; si algo está pendiente, decímelo',
  originId: 'el nombre del depósito o ubicación de donde sale la mercadería', destinationId: 'el nombre del depósito o ubicación que recibe la mercadería',
  originType: 'si la mercadería sale de un depósito o de una ubicación', destinationType: 'si el destino es un depósito o una ubicación', carrierName: 'quién transporta la mercadería',
  paymentMethod: 'cómo se pagó: efectivo, tarjeta, transferencia o una combinación; si combinás medios, indicá cuánto en cada uno', payments: 'los medios de pago y cuánto se pagó con cada uno',
  ticketRequested: 'si necesitás un comprobante; la emisión fiscal se revisa en su propio formulario', customerDecision: 'si asociamos un cliente a la venta o la dejamos sin cliente', promotionDecision: 'si aplicamos alguna promoción o dejamos la venta sin promociones',
  customer: 'el nombre o teléfono del cliente, si elegiste asociarlo', discounts: 'qué promoción querés aplicar, si corresponde', sales: 'cada venta por separado, con productos, cantidades, origen, canal y pago; después te preguntaré por cliente, promociones y comprobante si faltan',
  amountCents: 'el monto del gasto en pesos; por ejemplo, 12500 (yo hago la conversión interna)', category: 'la categoría del gasto; por ejemplo, alquiler o transporte', nature: 'si el gasto es fijo, variable o extraordinario', accruedOn: 'la fecha a la que corresponde el gasto', dueOn: 'la fecha de vencimiento, si la tiene', paidOn: 'la fecha de pago, si ya se pagó', cashAccount: 'si se pagó desde caja o banco',
  startDate: 'la fecha de inicio o desde cuándo querés analizar los datos', endDate: 'la fecha de finalización o hasta cuándo querés analizar los datos', days: 'cuántos días dura la feria', forecastDays: 'para cuántos días querés la estimación', comparableLocationIds: 'los nombres de las ferias que querés usar como referencia',
  inventoryType: 'si querés consultar un depósito o una ubicación', inventoryId: 'el nombre del depósito o ubicación que querés consultar', sellerId: 'el nombre del vendedor que querés consultar',
  entityId: 'qué registro querés revisar: podés decirme su nombre o referencia; no necesitás conocer un identificador interno',
  objective: 'qué querés lograr; por ejemplo, dar a conocer un producto o aumentar las ventas', audience: 'a quién querés llegar', format: 'qué pieza necesitás; por ejemplo, un post, un video o un texto', style: 'el tono o estilo que preferís',
  notes: 'los detalles que querés dejar anotados', query: 'qué querés buscar o conocer', topic: 'qué tema público querés investigar',
  module: 'qué sección de la aplicación querés abrir; por ejemplo, Productos o Ubicaciones',
};
export function fieldGuidance(intent, field) {
  if (/receivedQuantity/.test(field)) return 'cuántas unidades llegaron físicamente al destino; no des por recibida mercadería que todavía está en camino';
  if (/preparedQuantity/.test(field)) return 'cuántas unidades preparaste físicamente para enviar';
  if (field === 'name' && nouns[intent]) return `cómo querés que se llame ${nouns[intent]}; por ejemplo, ${intent.includes('location') ? 'Local Centro' : intent.includes('product') ? 'Aceite Arbosana de 500 ml' : 'un nombre que te resulte fácil reconocer'}`;
  return FIELD_GUIDANCE[field] || null;
}
export function operationGuidance(intent, fields = [], { detail = false, starting = false } = {}) {
  const pending = [...new Set(fields)].filter(field => field !== 'dniMode');
  if (!pending.length) return 'Ya tenemos los datos necesarios. Revisá la propuesta antes de confirmar.';
  const selected = detail ? pending : pending.slice(0, 2);
  const descriptions = selected.map(field => fieldGuidance(intent, field) || 'el dato que falta en el formulario; te ayudo a ubicarlo en la aplicación');
  const opening = starting ? `Dale, vamos a ${OPERATION_NAMES[intent] || 'preparar esa operación'}.` : detail ? 'Claro, te lo explico con más detalle.' : 'Vamos con lo que falta.';
  return `${opening} ${descriptions.length === 1 ? 'Pasame' : 'Pasame estos datos:'}\n\n${descriptions.map((description, i) => `${i + 1}. ${description[0].toUpperCase()}${description.slice(1)}.`).join('\n')}\n\n${detail ? 'Podés responder con tus palabras. Conservo los datos que ya me diste.' : 'Podés decírmelo con tus palabras y seguimos desde ahí.'}`;
}
