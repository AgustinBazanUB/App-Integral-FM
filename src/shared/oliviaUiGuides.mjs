import { OLIVIA_APP_GUIDE } from './oliviaAppGuide.mjs';
import { can, canAccessManagementRoute, normalizedRole } from '../gestion/permissions.js';
export const UI_GUIDE_VERSION = '2026-10-30.1';
const step = (id, title, description, options = {}) => ({ id, title, description, ...options });
const guides = {
  'locations-create': { module: 'locations', action: 'create', title: 'Crear una ubicación', steps: [
    step('location.create', 'Abrí el formulario', 'Tocá Crear ubicación. La guía no toca el botón por vos.', { advanceOn: 'location.name' }),
    step('location.name', 'Nombre de la ubicación', 'Escribí cómo querés reconocerla, por ejemplo Local Centro.'),
    step('location.prefix', 'Código de ventas', 'Usá hasta 8 letras o números, por ejemplo LC. No necesitás DNI.'),
    step('location.type', 'Tipo y calendario', 'Elegí Local, Feria o Evento. Revisá las fechas y horarios si corresponde.'),
    step('location.save', 'Revisá antes de guardar', 'Guardar crea la ubicación vacía. Hacelo solo cuando los datos estén bien; no agrega mercadería.', { terminal: true }),
  ] },
  'products-create': { module: 'products', action: 'create', title: 'Crear un producto', steps: [
    step('product.create', 'Nuevo producto', 'Tocá Nuevo producto para abrir su ficha.', { advanceOn: 'product.name' }),
    step('product.name', 'Nombre y presentación', 'Usá el nombre y tamaño exactos, por ejemplo Aceite Arbosana de 500 ml.'),
    step('product.abbreviation', 'Abreviación', 'Elegí hasta 8 caracteres para reconocer el producto.'),
    step('product.price', 'Precio', 'Indicá el precio predeterminado en pesos. Revisá también categoría, alertas e IVA si vas a facturar.'),
    step('product.save', 'Revisar y crear', 'El botón crea el producto en catálogo. El stock se carga después en cada ubicación o depósito.', { terminal: true }),
  ] },
  'customers-create': { module: 'loyal-customers', action: 'create', title: 'Crear un cliente', steps: [
    step('customer.create', 'Nuevo cliente', 'Abrí Nuevo cliente.', { advanceOn: 'customer.phone' }),
    step('customer.phone', 'Teléfono', 'Es el único dato obligatorio. Incluí el código de área; evita duplicar al mismo cliente.'),
    step('customer.name', 'Datos opcionales', 'Podés completar nombre y zona. Si el teléfono existe, se conserva su identidad.'),
    step('customer.save', 'Guardar ficha', 'Revisá el teléfono y guardá cuando estés conforme.', { terminal: true }),
  ] },
  'sale-create': { module: 'quick-sales', action: 'create', title: 'Registrar una venta', steps: [
    step('sale.origin', 'Canal y origen', 'En Canal elegí cómo llegó la venta y de dónde sale físicamente la mercadería.'),
    step('sale.catalog', 'Elegir productos', 'Buscá el producto y tocá su presentación. Elegí primero un origen si el catálogo todavía no tiene stock visible.'),
    step('sale.cart', 'Revisar cantidades', 'Revisá productos, cantidades y precios de la venta.'),
    step('sale.customer', 'Cliente y descuentos', 'Elegí si asociás un cliente y si corresponde una promoción.'),
    step('sale.payment', 'Forma de pago', 'Indicá cómo se pagó; si combinás medios, revisá sus importes.'),
    step('sale.submit', 'Revisión final', 'Revisá el total y la decisión de comprobante antes de confirmar. La guía no registra ventas.', { terminal: true }),
  ] },
  'warehouse-create': { module: 'warehouse', action: 'create', title: 'Crear un depósito', steps: [
    step('warehouse.create', 'Nuevo depósito', 'Abrí Nuevo depósito.', { advanceOn: 'warehouse.name' }),
    step('warehouse.name', 'Nombre del depósito', 'Elegí un nombre para reconocer el lugar. Descripción y dirección son opcionales.'),
    step('warehouse.save', 'Crear depósito vacío', 'Revisá antes de crear. Después vas a poder agregar productos y stock.', { terminal: true }),
  ] },
  'stock-location': { module: 'locations', action: 'loadStock', title: 'Cargar mercadería en un local', entity: 'locationId', steps: [
    step('location.open', 'Elegí la ubicación', 'Abrí el local donde recibiste la mercadería. Después elegí Agregar stock en el producto.', { advanceOn: 'location.stock' }),
    step('location.stock', 'Agregar stock', 'Usá Agregar stock en el producto que recibió unidades. Si todavía no está asignado, usá Agregar producto.', { advanceOn: 'stock.quantity' }),
    step('stock.quantity', 'Cantidad recibida', 'Escribí las unidades que recibiste; se suman al stock actual.'),
    step('stock.save', 'Revisá el ingreso', 'Revisá stock actual y nuevo antes de Confirmar ingreso. La guía no altera stock.', { terminal: true }),
  ] },
  'stock-warehouse': { module: 'warehouse', action: 'edit', title: 'Cargar mercadería en un depósito', entity: 'warehouseId', steps: [
    step('warehouse.open', 'Abrí el depósito', 'Elegí el depósito donde llegó la mercadería.', { advanceOn: 'warehouse.product' }),
    step('warehouse.product', 'Productos y stock', 'Agregar producto permite elegir uno del catálogo y su stock inicial. Para un producto ya asignado usá su acción Agregar stock.', { terminal: true }),
  ] },
  'stock-transfer': { module: 'warehouse', action: 'transferStock', title: 'Transferir mercadería', steps: [
    step('transfer.open', 'Transferir stock', 'Abrí Transferir stock.', { advanceOn: 'transfer.origin' }),
    step('transfer.origin', 'Origen físico', 'Elegí el depósito o ubicación de donde sale la mercadería.'),
    step('transfer.destination', 'Destino físico', 'Elegí dónde se recibe y quién la transporta.'),
    step('transfer.items', 'Cantidades reales', 'Elegí productos y cantidades previstas, preparadas y recibidas. No des por recibido lo que sigue en camino.', { terminal: true }),
  ] },
  'seller-sale': { module: 'seller', action: 'create', title: 'Venta en Panel Vendedor', steps: [step('seller.sale', 'Preparar una venta', 'Elegí tu ubicación asignada, productos, cantidades y pago. Revisá cliente, promociones y comprobante antes de confirmar. Tus ventas sin conexión quedan pendientes en el dispositivo.', { terminal: true })] },
};
for (const row of OLIVIA_APP_GUIDE) guides[`module-${row.module}`] = { module: row.module, action: 'view', title: row.title, steps: [step(row.module === 'seller' ? 'seller.sale' : 'module.content', row.title, `${row.assisted} ${row.manual}`.replace(/prepare_[a-z_]+/g, 'la carga asistida'), { terminal: true })] };
export const UI_GUIDES = Object.freeze(guides);
export const UI_TARGET_IDS = new Set(Object.values(guides).flatMap(guide => guide.steps.map(step => step.id)));
export const UI_ERROR_IDS = ['location.form', 'product.form', 'customer.form', 'warehouse.form', 'sale.form', 'transfer.form'];
export function guideAllowed(profile, guide) {
  if (!profile?.active || !guide) return false;
  if (normalizedRole(profile) === 'seller') return guide.module === 'seller' && can(profile, 'quick-sales', guide.action === 'view' ? 'view' : 'create');
  return guide.module !== 'seller' && canAccessManagementRoute(profile, guide.module) && (guide.action === 'view' || can(profile, guide.module, guide.action));
}
export function getUiGuide(profile, id, context = {}) {
  const guide = UI_GUIDES[id];
  if (!guideAllowed(profile, guide)) return null;
  const base = guide.module === 'seller' ? '/vendedor?view=sale' : OLIVIA_APP_GUIDE.find(row => row.module === guide.module)?.route;
  if (!base) return null;
  let path = base;
  if (guide.entity && /^[A-Za-z0-9_-]{1,128}$/.test(context[guide.entity] || '')) {
    const allowed = guide.entity !== 'locationId' || can(profile, 'locations', 'viewAllLocations') || profile.allowedLocationIds?.includes(context.locationId);
    if (allowed) path += '/' + context[guide.entity] + (id === 'stock-location' ? '/stock' : '');
  }
  return { id, version: UI_GUIDE_VERSION, ...guide, path };
}
export function guideForMessage(message, context = {}, previous = null, profile = {}) {
  const text = String(message).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (context.uiGuide?.guideId && getUiGuide(profile, context.uiGuide.guideId, context)) {
    if (/explic[a-z]* (?:este |el )?paso|que (?:hago|falta|necesito) (?:aca|aqui|en este paso)|error (?:en este paso|del formulario)/.test(text)) return { control: 'explain' };
    if (/cancel[a-z]* (?:la )?guia|termina[a-z]* (?:la )?guia/.test(text)) return { control: 'cancel' };
    if (/pausa[a-z]* (?:la )?guia/.test(text)) return { control: 'pause' };
    if (/retoma[a-z]* (?:la )?guia|continua[a-z]* (?:la )?guia/.test(text)) return { control: 'resume' };
    if (/siguiente paso|segui con la guia/.test(text)) return { control: 'next' };
    if (/paso anterior/.test(text)) return { control: 'previous' };
  }
  const ask = /(?:^|[¿?])\s*(?:olivia[, ]+)?como\b|\b(?:guiame|guiarme|guia visual|mostra[a-z]* como|ensena|paso a paso|donde (?:cargo|creo|registro|encuentro)|explic[a-z]* como)/.test(text);
  if (!ask && previous?.topic !== 'stock-destination') return null;
  if (/stock|mercaderia|inventario/.test(text) || previous?.topic === 'stock-destination') {
    if (/transfer|traslad/.test(text)) return { id: 'stock-transfer' };
    if (/deposito/.test(text) || context.warehouseId) return { id: 'stock-warehouse' };
    if (/local|ubicacion/.test(text) || context.locationId) return { id: 'stock-location' };
    if (previous?.topic === 'stock-destination' && !/^(?:en |a |un |una |el |la )*(?:deposito|local|ubicacion)/.test(text)) return null;
    return { topic: 'stock-destination', question: 'Dale, te ayudo. Primero elegimos el destino: ¿querés cargar la mercadería en un local o en un depósito?' };
  }
  if (/ubicacion|feria|evento/.test(text) && /crea|nuev|alta/.test(text)) return { id: 'locations-create' };
  if (/producto/.test(text) && /crea|nuev|alta/.test(text)) return { id: 'products-create' };
  if (/cliente/.test(text) && /crea|nuev|alta|registra/.test(text)) return { id: 'customers-create' };
  if (/venta|vender/.test(text)) return { id: normalizedRole(profile) === 'seller' ? 'seller-sale' : 'sale-create' };
  if (/deposito/.test(text) && /crea|nuev|alta/.test(text)) return { id: 'warehouse-create' };
  const row = OLIVIA_APP_GUIDE.find(row => text.includes(row.title.toLowerCase()) || (row.module.length > 2 && new RegExp(`\\b${row.module}\\b`).test(text)));
  return row ? { id: `module-${row.module}` } : ask && /esta pantalla|este panel|aca|aqui/.test(text) ? { id: `module-${context.module}` } : null;
}
