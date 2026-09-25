# Integración ARCA — Flor Mía

> Estado: en implementación. Documento vivo.
> Rama de trabajo: `feature/arca-integration`.
> Base auditada: `main` @ `36c7eb010b4c7b7246edbbc4ba471c0862a14ac8`.
> Última verificación documental ARCA: 2026-09-25.

## 1. Estado por fases

- [x] FASE 1 — Auditoría de la App Integral Flor Mía.
- [x] FASE 2 — Diseño técnico del motor central de facturación.
- [ ] FASE 3 — Preparación ARCA / emisor (CUIT recibido y validado; falta punto de venta/certificado de homologación).
- [ ] FASE 4 — Backend ARCA (base WSAA + WSFEv1 implementada; falta conexión real con credenciales de homologación).
- [ ] FASE 5 — Datos fiscales.
- [ ] FASE 6 — Panel Vendedor.
- [ ] FASE 7 — Venta rápida.
- [ ] FASE 8 — E-commerce.
- [ ] FASE 9 — PDF y QR.
- [ ] FASE 10 — Seguridad.
- [ ] FASE 11 — Homologación.
- [ ] FASE 12 — Pruebas.
- [ ] FASE 13 — Producción.

## 2. Auditoría técnica

### Stack real

- React 18.3.1 + React DOM 18.3.1.
- JavaScript/JSX (no TypeScript en la base actual).
- Vite 6.
- Firebase 12.x: Authentication + Firestore.
- Netlify como hosting y backend serverless mediante `netlify/functions`.
- Node 20 configurado para build.
- Router propio en `src/router.jsx`.

### E-commerce

- Superficie pública en `src/Storefront.jsx`.
- Checkout en `src/pages/CheckoutPage.jsx`.
- Carrito local en `src/context/CartContext.jsx`.
- El checkout actual es deliberadamente preparatorio:
  - no procesa pagos;
  - no crea pedidos;
  - no tiene webhook;
  - los precios públicos aún pueden estar pendientes.
- La colección `orders` está prevista en el modelo y en Firestore Rules, pero el checkout público todavía no la utiliza.

Consecuencia para ARCA: el e-commerce no podrá emitir automáticamente hasta existir una confirmación de pago confiable del backend. La integración fiscal quedará preparada para recibir un `orderId` confirmado por webhook, pero no se simulará un pago inexistente.

### Panel Vendedor

Ruta: `/vendedor`.

Archivos principales:

- `src/gestion/seller/SellerPanel.jsx`
- `src/gestion/services/sellerService.js`
- `src/gestion/seller/CustomerDialog.jsx`
- `src/gestion/customers/customerDomain.js`

La venta real ya usa transacciones Firestore. En una confirmación se valida ubicación, stock, descuentos y pago; se actualiza el contador comercial de venta, se descuenta stock, se crean movimientos, se vincula/crea cliente, se guarda la venta y se crea auditoría.

Ya existe la intención `ticketRequested` / `ticketStatus`, pero no existe autorización fiscal ARCA.

El cliente del vendedor ya se identifica comercialmente por teléfono y usa normalización argentina + ID determinístico. Esa arquitectura se preservará.

### Admin — Venta rápida

Ruta: `/gestion/quick-sales`.

Archivos principales:

- `src/gestion/pages/QuickSalesPage.jsx`
- `src/gestion/services/managementService.js`

También registra venta + stock en transacción. Hoy tiene `customerDni`, `invoiceRequested` e `invoiceStatus`, con una leyenda de facturación manual posterior.

Hay una divergencia respecto del Panel Vendedor: Venta rápida todavía no reutiliza el flujo de cliente por teléfono. La integración ARCA deberá converger en un contrato compartido de cliente/facturación sin duplicar el motor de venta.

### Clientes

Colección real: `customers`.

- Teléfono = identificador comercial principal.
- `phoneNormalized` normaliza variantes argentinas.
- ID determinístico: `customer_<hash>`.
- Búsqueda directa por teléfono.
- Actualmente no hay campos fiscales persistidos de CUIT/CUIL, condición IVA ni razón social.

Se extenderá el documento existente de cliente; no se creará una base paralela de clientes fiscales.

### Ventas y stock

Colecciones relevantes encontradas:

- `sales`
- `locationStock/{locationId}/items/{productId}`
- `stockMovements`
- `counters`
- `customers`
- `auditLogs`
- `orders` (prevista)
- `invoices` (prevista)
- `financialEntries`

El contador actual de `sales` sólo genera el código comercial `FM-...`. NO será usado como numeración fiscal.

### Firebase / Firestore

- Firebase Authentication para usuarios internos.
- Perfil y roles en `users/{uid}`.
- Firestore Rules replican permisos del frontend.
- `invoices` ya existe conceptualmente en reglas/modelo, pero hoy permite create/update desde perfiles de Finanzas. Para comprobantes ARCA reales esto debe endurecerse: CAE, número fiscal, estado y datos de autorización serán escritura exclusiva del backend de facturación.
- No hay Firebase Storage configurado como infraestructura activa para comprobantes.

### Netlify

Funciones actuales:

- `netlify/functions/campaign-planner.mjs`
- `netlify/functions/theory-compiler.mjs`
- helper de autenticación en `netlify/functions/_lib/firebaseAuth.mjs`

El patrón actual confirma que la aplicación ya utiliza Netlify Functions para operaciones que requieren secretos y validación server-side.

No existe todavía código ARCA, WSAA, WSFEv1, certificados, CAE ni webhook de pago.

### Facturación previa encontrada

Se encontraron estados/intenciones, no un motor fiscal:

- Vendedor: `ticketRequested` / `ticketStatus`.
- Venta rápida: `invoiceRequested` / `invoiceStatus`.
- Modelo Firestore: colección conceptual `invoices`.
- Finanzas: descripción de facturación pendiente.

No hay implementación previa de ARCA para reutilizar.

## 3. Baseline de CI

El workflow real ejecuta:

1. `npm ci`
2. `npm test`
3. emulador Firestore + `npm run test:rules`
4. `npm run build`

No existen scripts de lint ni typecheck en `package.json`; no se inventarán.

El último workflow de `main` auditado ya estaba en rojo antes de ARCA: 5 tests de UI/expectativas fallaban (focus overlay, mejoras de ubicación/productos y responsive del seller). Deben tratarse como fallos preexistentes y no atribuirse a esta integración.

## 4. Punto de integración recomendado

ARCA se integrará como backend fiscal central, separado de la transacción comercial de venta:

```text
Vendedor ───────┐
Venta rápida ───┼──> venta/pedido confirmado ──> Billing API (Netlify)
E-commerce ─────┘                                  │
                                                   ├─ idempotencia
                                                   ├─ reglas fiscales
                                                   ├─ WSAA
                                                   ├─ WSFEv1
                                                   ├─ padrón
                                                   ├─ CAE
                                                   ├─ QR/PDF
                                                   └─ invoices + auditoría
```

Regla crítica: una caída de ARCA no revierte ni duplica una venta ya confirmada. La venta queda válida y la factura queda `pending/error` con reintento idempotente.

## 5. Diseño del motor central

### Contrato de origen

Toda solicitud fiscal se normalizará a un contrato equivalente a:

- `sourceType`: `seller_sale | admin_quick_sale | ecommerce`
- `sourceId`: `saleId | orderId`
- snapshot de importes e ítems
- cliente comercial
- identidad fiscal del receptor
- emisor y punto de venta obtenidos sólo desde configuración server-side

La clave idempotente principal será el origen (`sourceType + sourceId`). Una venta/pedido autorizado debe devolver siempre el comprobante existente y nunca pedir un segundo CAE.

### Estados

`not_requested -> pending -> authorizing -> authorized`

Errores recuperables o fiscales:

- `rejected`
- `error`
- futuro `credited` para comprobantes revertidos mediante documento fiscal válido

### Numeración

Nunca se calculará como “última factura Firestore + 1”.

Antes de autorizar, el backend consultará a WSFEv1 el último comprobante autorizado para el punto de venta y tipo de comprobante, y coordinará concurrencia/idempotencia para impedir dos solicitudes con el mismo número.

### Autenticación ARCA

WSAA se ejecutará exclusivamente en Netlify Functions:

```text
TRA -> firma CMS/PKCS#7 -> LoginCms -> Token + Sign
```

El Ticket de Acceso se cacheará hasta cerca de su expiración; no se solicitará uno por factura.

### Consulta fiscal del receptor

Se integrará el servicio oficial de Consulta a Padrón Constancia de Inscripción (`ws_sr_constancia_inscripcion`) cuando la autorización del emisor lo permita. La UI validará formato/dígito de CUIT localmente, pero la consulta fiscal real será server-side.

### Comprobante

La UI no le pedirá al vendedor que conozca códigos fiscales. La selección del tipo de comprobante se resolverá server-side usando:

- condición fiscal del emisor;
- condición IVA del receptor;
- datos/documento del receptor;
- reglas vigentes y tablas devueltas por ARCA.

No se limitará artificialmente a Factura A/B: el tipo válido depende de la situación fiscal real del emisor.

### PDF y QR

El comprobante se generará sólo después de una autorización válida. El QR se construirá con la especificación oficial de factura electrónica, usando el CAE y los datos realmente autorizados.

## 6. Seguridad

Nunca se expondrán al navegador:

- private key;
- certificado sensible;
- Token/Sign WSAA;
- credenciales ARCA;
- secretos de backend.

La private key y el certificado se cargarán como secretos de Netlify y no se commitearán.

Firestore será repositorio de metadatos fiscales autorizados, no de credenciales.

## 7. Entornos

Primero: homologación.

Variables server-side previstas (nombres sujetos a implementación final):

- `ARCA_ENVIRONMENT=homologation|production`
- `ARCA_ISSUER_CUIT`
- `ARCA_POINT_OF_SALE`
- `ARCA_PRIVATE_KEY_PEM`
- `ARCA_CERTIFICATE_PEM`

Los secretos nunca se definirán como variables `VITE_*`.

## 8. Documentación oficial vigente verificada

- WSAA: https://www.arca.gob.ar/ws/documentacion/wsaa.asp
- Manual WSAA: https://www.arca.gob.ar/ws/WSAA/WSAAmanualDev.pdf
- Certificados: https://www.arca.gob.ar/ws/documentacion/certificados.asp
- WSFE / Factura electrónica: https://www.arca.gob.ar/fe/ayuda/webservice.asp
- Manual WSFEv1: https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
- QR: https://arca.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
- Catálogo / Consulta a Padrón: https://www.arca.gob.ar/ws/documentacion/catalogo.asp

Notas verificadas:

- WSAA requiere certificado X.509.
- Testing/homologación y producción utilizan certificados/autorizaciones separadas.
- Para WSFE el `service` del Ticket de Acceso es `wsfe`.
- WSFEv1 ofrece consulta de puntos de venta, último comprobante autorizado y solicitud de CAE.
- La condición IVA del receptor forma parte de las validaciones vigentes.
- El QR fiscal contiene los datos oficiales del comprobante y CAE.
- La emisión por Web Service usa un punto de venta específico y numeración correlativa por punto de venta.

## 9. Base backend implementada

Se agregó una primera capa server-side en `netlify/functions/_lib/arca/`:

- validación y normalización de CUIT;
- selección estricta homologación/producción;
- endpoints oficiales WSAA, WSFEv1 y padrón;
- generador TRA para WSAA;
- firma CMS/PKCS#7 server-side con certificado + private key;
- parser de Ticket de Acceso con cache temporal;
- cliente SOAP WSFEv1;
- `FEDummy`;
- `FEParamGetPtosVenta`;
- `FECompUltimoAutorizado`;
- `FEParamGetCondicionIvaReceptor`;
- `FECAESolicitar`;
- `FECompConsultar`;
- pruebas unitarias de dominio.

El CUIT real del emisor no se hardcodea ni se agrega al repositorio: se cargará mediante variable server-side en Netlify.

## 10. Próximo bloqueo externo

El CUIT del emisor ya fue recibido y pasó la validación local de formato/dígito verificador. Se seleccionó el punto de venta 8, identificado como `FLOR MIA` y configurado como `RECE para aplicativo y web services`; queda sujeto a la verificación automática de `FEParamGetPtosVenta` cuando estén disponibles las credenciales de homologación. El siguiente bloqueo es obtener/configurar el certificado de testing y autorizar el servicio WSFE en WSASS. No se solicitarán por chat Clave Fiscal, private keys ni secretos.
