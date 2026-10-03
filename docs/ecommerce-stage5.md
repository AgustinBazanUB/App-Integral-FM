# Ecommerce comercial — Etapa 5

## Objetivo

Convertir la tienda editorial en una base comercial real sin conectar todavía Ecommerce con emisión ARCA.

Flujo de esta etapa:

`Tienda -> producto -> carrito -> checkout -> Order + Payment pending`

Sólo el modo de prueba local explícito puede simular un pago aprobado para ejercitar:

`Order -> Payment simulated_approved -> Sale + descuento de stock`

No se crea Invoice, no se llama `arca-invoice`, no se llama `arca-authorize` y no existe ningún camino hacia `FECAESolicitar` dentro de los módulos Ecommerce de Etapa 5.

## Fuente de productos

La colección Firestore `products` continúa siendo el **catálogo maestro comercial**.

`src/data/products.js` permanece como catálogo editorial. Puede aportar:

- copy;
- fotografías;
- tags;
- ocasiones;
- atributos visuales;
- presentación editorial.

No es autoridad para:

- precio;
- stock;
- activo/inactivo;
- ID comercial;
- IVA ARCA.

El catálogo público se obtiene mediante `/.netlify/functions/ecommerce-catalog`. El backend lee `products` y, cuando existe una ubicación Ecommerce explícita, une cada producto por su ID con:

`locationStock/{ECOMMERCE_LOCATION_ID}/items/{productId}`.

No se crea una segunda colección de productos.

## Mapeo editorial

El ID comercial que viaja en carrito, Order y Sale siempre es el document ID real de `products`.

La capa editorial puede asociarse únicamente por coincidencia explícita:

- `product.ecommerceEditorialId` / `product.editorialId`;
- mismo document ID;
- mismo slug comercial/editorial.

Si no existe una asociación explícita, la tienda utiliza nombre, descripción e imagen del catálogo maestro. No se hace matching heurístico por nombre para construir identidad comercial.

## Fuente de precios

El precio se resuelve server-side con la semántica existente de inventario:

1. `priceMode=custom` -> `priceOverride`;
2. `priceMode=default` -> `products.defaultPrice`;
3. stock legacy con `price` -> se conserva como precio local explícito;
4. sin precio válido -> producto no comprable.

El navegador puede mostrar un precio, pero ese valor no participa en el cálculo final del backend.

Campos como `price`, `unitPrice`, `subtotal`, `total` enviados desde cliente se ignoran como fuente de verdad.

## Fuente de stock

El stock autoritativo es:

`locationStock/{ECOMMERCE_LOCATION_ID}/items/{productId}.currentStock`.

El backend comprueba:

- existencia del producto;
- `active`;
- `deleted`;
- existencia de stock;
- stock activo;
- cantidad entera;
- cantidad > 0;
- máximo por línea;
- stock suficiente;
- IVA ARCA configurado.

Para una operación que confirma venta, el update de stock utiliza una precondición con `updateTime` dentro de un commit Firestore atómico. Si el stock cambió entre lectura y commit, la operación falla y debe recalcularse.

## Ubicación Ecommerce

**PENDIENTE DE DEFINIR.**

No existe ningún ID de ubicación por default.

Se requiere:

`ECOMMERCE_LOCATION_ID=<document-id-real-de-locations>`

Mientras falte:

- el catálogo puede exponer productos maestros;
- precio y stock se muestran como no disponibles;
- ningún producto queda comercialmente listo;
- el checkout final no puede confirmarse.

También existe:

`ECOMMERCE_PICKUP_ENABLED=false`

Debe habilitarse explícitamente sólo cuando la operativa real de retiro esté confirmada.

La entrega a domicilio sigue **PENDIENTE DE DEFINIR**:

- zonas;
- tarifas;
- cálculo;
- condiciones;
- plazos.

No se inventa un costo de envío ni se acepta uno enviado por navegador.

## Order / Payment / Sale / Invoice

Las cuatro entidades se mantienen separadas conceptualmente.

### Order

`orders/{orderId}`

Existe desde que el cliente confirma un checkout válido.

Contiene snapshots autoritativos de:

- cliente;
- items;
- precio unitario;
- subtotal;
- descuento;
- shipping;
- total;
- paymentStatus;
- saleId;
- invoiceId;
- invoiceStatus.

El ID es determinístico respecto de `requestId`, para soportar reintentos sin duplicar pedidos.

### Payment

`payments/{paymentId}`

Estado permitido por dominio:

- `pending`;
- `simulated_approved`;
- `approved`;
- `rejected`;
- `cancelled`.

En el flujo público actual el checkout crea sólo `pending`.

`simulated_approved` requiere simultáneamente:

- `ECOMMERCE_LOCAL_TEST_MODE=true`;
- `ECOMMERCE_ALLOW_SIMULATED_PAYMENTS=true`.

Ambos defaults son false.

El navegador no puede marcar `approved`.

### Sale

`sales/{saleId}`

No se crea cuando Payment está `pending`.

Una Sale sólo se crea cuando existe un estado de pago confiable que requiere commit de stock. Etapa 5 lo ejercita únicamente con `simulated_approved` local.

La Sale utiliza:

`sourceType=ecommerce`

y queda con:

`invoiceStatus=not_requested`.

La creación de Sale, stockMovements y decremento de `locationStock` forman una única operación backend.

### Invoice

Etapa 5 **no crea invoices**.

El futuro paso ARCA deberá partir de una Sale Ecommerce ya confirmada y deberá reutilizar el motor fiscal existente. No debe facturar un Order pendiente ni interpretar Payment e Invoice como la misma entidad.

## Seguridad de Firestore

El navegador no puede crear ni mutar:

- `orders`;
- `payments`;
- una `sales` con `sourceType=ecommerce`;
- `invoices`.

Estas operaciones son backend-only.

Las reglas existentes de ARCA para `arcaWsaaTickets` y `arcaSequenceLocks` permanecen cerradas.

## Checkout

El carrito persistido guarda exclusivamente:

- `productId`;
- `quantity`.

No persiste precio como autoridad.

Al crear el pedido el cliente envía IDs/cantidades y datos de contacto. El backend relee Products + LocationStock y recalcula todo.

La respuesta pública contiene sólo el resumen necesario del pedido; no devuelve credenciales, datos administrativos ni payloads fiscales.

## Punto de integración futura Payway

Payway debe integrarse en el límite **Payment -> approved/rejected/cancelled**.

Arquitectura esperada:

1. checkout crea Order + Payment pending;
2. backend crea intención/operación Payway;
3. callback/webhook confiable valida la respuesta del proveedor;
4. transición idempotente de Payment;
5. si pasa a approved, backend vuelve a validar stock;
6. commit atómico crea Sale + movimientos + decremento de stock;
7. sólo después una etapa ARCA podrá preparar la Invoice Ecommerce.

Nunca aceptar `approved` desde el frontend.

La implementación Payway debe incorporar:

- idempotency key;
- validación de firma/autenticidad;
- monto esperado server-side;
- reconciliación;
- manejo de respuesta incierta;
- reintentos seguros.

## Alcance ARCA

La configuración ARCA de esta etapa no se modifica.

Debe continuar:

`ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=admin_quick_sale`

No agregar `ecommerce`.

No habilitar:

- `ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE`;
- `ARCA_ALLOW_PRODUCTION_CAE`;
- `ARCA_AUTO_AUTHORIZE_PRODUCTION`.

Etapa 5 prepara datos compatibles con una facturación futura, pero no emite.
