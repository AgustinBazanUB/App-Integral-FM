# Integración ARCA — Flor Mía

> Estado: en implementación. Documento vivo.
> Rama de trabajo: `feature/arca-integration`.
> Base auditada: `main` @ `36c7eb010b4c7b7246edbbc4ba471c0862a14ac8`.
> Última verificación documental ARCA: 2026-09-25.

## 1. Estado por fases

- [x] FASE 1 — Auditoría de la App Integral Flor Mía.
- [x] FASE 2 — Diseño técnico del motor central de facturación.
- [x] FASE 3 — Preparación ARCA / emisor (CUIT validado, certificado de homologación creado, WSFE autorizado y punto de venta de testing resuelto).
- [x] FASE 4 — Backend ARCA (WSAA + WSFEv1 conectados realmente en homologación; Token/Sign, FEDummy, puntos de venta y tablas paramétricas verificados).
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

La Function `arca-invoice` implementa la primera etapa de ese contrato para ventas rápidas y ventas del panel vendedor: lee la venta desde Firestore con la cuenta de servicio, valida que esté activa y que tenga una solicitud explícita, y crea `invoices/{invoiceIdFor(sourceType, sourceId)}` mediante creación condicional. Si dos solicitudes coinciden, la segunda recupera el documento existente. Sólo guarda una intención `pending` y un snapshot de los importes e ítems; esta operación no llama a WSAA/WSFE, no reserva numeración y no solicita CAE. El checkout todavía no crea pedidos confirmados y queda fuera de esta etapa.

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

El CUIT del emisor ya fue recibido y pasó la validación local de formato/dígito verificador. Para producción se identificó el punto de venta 8, `FLOR MIA`, configurado como `RECE para aplicativo y web services`. En homologación, la consulta real `FEParamGetPtosVenta` devolvió únicamente el punto de venta 3; por lo tanto, homologación usa `ARCA_POINT_OF_SALE=3` y producción conservará el punto 8. El certificado de homologación del alias `florMiaWebApp` ya fue creado, autorizado para `Facturación Electrónica`, cargado en Netlify y validado mediante una autenticación WSAA real. El siguiente objetivo técnico es verificar correlatividad con `FECompUltimoAutorizado` y obtener el primer CAE de prueba en homologación.


## 11. Proyecto Netlify de homologación

Se creó un proyecto Netlify separado para homologación:

- Proyecto: `flor-mia-arca-homologacion`
- Rama esperada: `feature/arca-integration`
- Objetivo: aislar credenciales/certificados de testing del proyecto principal de producción.
- Estrategia de costo: compatible con plan gratuito; las credenciales se cargarán como variables de entorno del proyecto y sólo serán consumidas por Netlify Functions. Nunca se usarán variables `VITE_*` para secretos ARCA.

Siguiente paso operativo: cargar `ARCA_ENVIRONMENT`, `ARCA_ISSUER_CUIT`, `ARCA_POINT_OF_SALE`, `ARCA_CERTIFICATE_PEM` y `ARCA_PRIVATE_KEY_PEM`, luego realizar un nuevo deploy de la rama de homologación.


## 13. Primera conexión real de homologación

Resultado de la primera prueba real contra ARCA:

- `FEDummy`: AppServer OK, DbServer OK, AuthServer OK.
- WSAA: autenticación correcta; el certificado, la clave privada y la autorización a `wsfe` funcionan.
- `FEParamGetPtosVenta`: devolvió el punto de venta 3 en homologación.
- El punto de venta 8 no aparece en homologación y se mantiene reservado para producción.
- `FEParamGetCondicionIvaReceptor`: devolvió 11 condiciones, confirmando acceso autenticado a WSFEv1.

Configuración resultante:
- Homologación: `ARCA_POINT_OF_SALE=3`.
- Producción futura: punto de venta 8, sujeto a validación con certificado y endpoints de producción.


## 14. Próxima prueba fiscal

La siguiente prueba controlada se realizará exclusivamente en homologación:

1. consultar `FECompUltimoAutorizado` para Factura B (`CbteTipo=6`) y punto de venta 3;
2. calcular el siguiente número como último autorizado + 1;
3. solicitar un CAE de prueba para una Factura B de producto, receptor Consumidor Final (`CondicionIVAReceptorId=5`), documento tipo 99 / número 0 y monto pequeño;
4. si ARCA autoriza, consultar el mismo comprobante con `FECompConsultar` para validar recuperación/idempotencia;
5. no escribir aún comprobantes en Firestore ni tocar producción.


## 15. Primer CAE real de homologación

Prueba end-to-end completada correctamente el 2026-09-25:

- Punto de venta homologación: 3.
- Tipo de comprobante: Factura B (`CbteTipo=6`).
- `FECompUltimoAutorizado`: último = 0.
- Se solicitó comprobante número 1.
- `FECAESolicitar`: resultado `A` (aprobado).
- CAE obtenido: registrado únicamente como evidencia de homologación fuera del repositorio.
- `FECompConsultar`: recuperó el mismo comprobante y el mismo CAE.
- Verificación de recuperación/idempotencia: OK.

La prueba confirma el flujo técnico completo:
`certificado -> WSAA -> Token/Sign -> FECompUltimoAutorizado -> FECAESolicitar -> CAE -> FECompConsultar`.

No se emitió ningún comprobante de producción ni se utilizó el punto de venta 8.

## 16. Datos fiscales de productos y receptores

Se incorporó una base de dominio fiscal para:

- ID determinístico de factura por origen;
- estados del ciclo de facturación;
- distribución proporcional de descuentos;
- descomposición de precio final en neto + IVA;
- rechazo explícito si un producto no tiene alícuota IVA configurada;
- alícuota IVA ARCA editable en el catálogo maestro de Productos;
- cliente de Consulta a Padrón Constancia de Inscripción (`ws_sr_constancia_inscripcion`) con `getPersona_v2`.

La aplicación no inferirá la alícuota de un producto por su nombre/categoría ni inventará la condición fiscal de un receptor.


## 17. Autorización Padrón

El certificado de homologación `florMiaWebApp` ya fue autorizado en WSASS para el servicio `ws_sr_constancia_inscripcion`.

Próxima validación: solicitar un Ticket de Acceso específico para `ws_sr_constancia_inscripcion` y ejecutar `getPersona_v2` contra homologación utilizando la CUIT del propio emisor como caso de prueba.


## 18. Compatibilidad de endpoint del Padrón

La documentación oficial vigente V4.1 publica como endpoint primario de testing `awshomo.arca.gob.ar`, mientras documentación oficial anterior y el manual de WSAA siguen documentando el endpoint legado `awshomo.afip.gov.ar` para el mismo servicio.

La primera prueba desde el entorno local devolvió un error de red `fetch failed` antes de recibir respuesta SOAP. Para robustecer la integración, el cliente usa el dominio vigente como primario y reintenta exclusivamente ante errores de conectividad contra el endpoint oficial legado. No se hace fallback ante errores SOAP, de autenticación o de negocio.


## 19. Primera consulta real al Padrón

La prueba real de homologación confirmó:

- `dummy`: AppServer OK, DbServer OK, AuthServer OK.
- El endpoint primario `awshomo.arca.gob.ar` no respondió desde el entorno local probado.
- El fallback oficial legado `awshomo.afip.gov.ar` respondió correctamente.
- WSAA emitió Ticket de Acceso válido para `ws_sr_constancia_inscripcion`.
- `getPersona_v2` respondió sin error SOAP usando la CUIT representada del emisor.
- La CUIT real consultada no devolvió `datosGenerales` ni impuestos dentro del dataset de homologación, por lo que no debe interpretarse como una constancia vacía válida.

El parser ahora distingue explícitamente entre persona encontrada y respuesta con `errorConstancia`. Para validar el mapeo completo de datos fiscales se usará el CUIT de ejemplo `20164755100` publicado por ARCA en el ejemplo oficial de `getPersona_v2`.


## 20. Validación completa del Padrón

La segunda prueba real de homologación, usando el CUIT de ejemplo publicado por ARCA (`20164755100`), fue satisfactoria:

- persona encontrada: sí;
- tipo de persona: física;
- estado de CUIT: activo;
- impuestos devueltos: 3;
- IVA (`idImpuesto=30`): activo;
- Monotributo: no;
- `errorConstancia`: ninguno;
- endpoint utilizado: fallback oficial legado `awshomo.afip.gov.ar`.

Con esto queda validado el circuito:
`WSAA -> ws_sr_constancia_inscripcion -> getPersona_v2 -> parser de datos fiscales`.

También se agregó una capa conservadora para inferir la condición IVA del receptor:
- IVA activo (`idImpuesto=30`) -> condición 1, IVA Responsable Inscripto;
- Monotributo activo (`idImpuesto=20`) -> condición 6;
- categorías explícitas de Monotributo Social -> condición 13;
- Trabajador Independiente Promovido -> condición 16;
- si el Padrón no aporta evidencia suficiente, la aplicación no inventa una condición.

WSFEv1 queda preparado además para consultar dinámicamente tipos de comprobante, tipos de alícuota IVA y condiciones IVA de receptor.


## 21. Flujo local con Netlify Dev

Para continuar la homologación sin consumir deploys cloud, el proyecto puede ejecutarse con Netlify Dev en `http://localhost:8888`.

El entorno local debe cargar en memoria las variables ARCA y Firebase Admin desde archivos locales ignorados por Git. No es obligatorio vincular el clon al proyecto remoto de Netlify.

Se agregó:

- `netlify/functions/arca-taxpayer.mjs`: Function autenticada para consulta de CUIT y diagnóstico de homologación.
- `src/gestion/services/arcaService.js`: cliente autenticado desde la app usando Firebase ID Token.
- Panel `Configuración > Diagnóstico ARCA`, visible sólo a administración.
- El diagnóstico comprueba WSFE, punto de venta, Padrón y OAuth/lectura server-only de Firestore sin emitir CAE ni escribir ventas.

Las credenciales nunca se devuelven al navegador.


## 22. Diagnóstico desacoplado por servicio

Durante la prueba local, el primer intento llegó a ARCA pero falló la lectura server-side de Firestore; intentos posteriores recibieron errores de red HTTP 502 desde ARCA.

El diagnóstico de `Configuración > ARCA` ahora ejecuta y reporta de forma independiente:

- WSFE / FEDummy;
- punto de venta;
- Padrón;
- Firebase Admin OAuth;
- lectura server-side de Firestore.

Un error de red de ARCA ya no impide verificar IAM de la cuenta de servicio de Firebase. La lectura de Firestore continúa siendo no destructiva.
