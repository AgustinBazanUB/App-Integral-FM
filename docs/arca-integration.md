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


## 24. Primera factura emitida desde la Web App y verificada

Prueba end-to-end integrada completada correctamente en homologación el 2026-09-28 desde la Web App:

- venta origen: `FM-FMLV-20260928-0001`;
- punto de venta: 3;
- tipo: Factura B (`CbteTipo=6`);
- número autorizado: 2;
- resultado de autorización: `A`;
- CAE: obtenido y persistido server-side;
- vencimiento de CAE: 2026-10-08;
- estado persistido: `authorized`;
- `FECompConsultar`: coincidencia completa con Firestore;
- punto de venta, tipo, número, CAE y vencimiento: coincidentes;
- no hubo observaciones de ARCA.

La prueba confirma el circuito integrado de la aplicación:

`venta -> invoice pending -> dry-run fiscal -> claim exclusivo -> lock de secuencia -> FECompUltimoAutorizado -> FECAESolicitar -> authorized -> FECompConsultar -> verification.matched=true`.

No se utilizó producción ni el punto de venta productivo.

### Robustez observada durante homologación

Antes de la autorización exitosa se detectó un `coe.alreadyAuthenticated` de WSAA. El parser SOAP estaba clasificándolo incorrectamente como un falso HTTP 502 de red. Se corrigió para conservar el código SOAP real.

También se corrigió el caso de un fallo anterior a reservar número de comprobante: si `FECompUltimoAutorizado` falla antes de `FECAESolicitar`, la solicitud vuelve a `pending` y queda reintentable; no permanece trabada en `authorizing`.

La consola administrativa dispone además de una recuperación explícita para intentos `authorizing` interrumpidos antes de reservar número y antes de solicitar CAE.

### Estado seguro de configuración

La UI puede consultar si el interruptor de CAE de homologación está habilitado mediante un endpoint de estado seguro que no llama a WSAA ni consume un Ticket de Acceso. Esto evita ejecutar el diagnóstico sólo para habilitar botones fiscales.

### Próxima etapa técnica obligatoria antes de producción

La caché actual de Ticket de Acceso WSAA es en memoria del proceso. Eso es suficiente para pruebas controladas, pero no es una solución final para un entorno serverless con múltiples instancias/cold starts.

Antes de producción debe implementarse una estrategia compartida y segura para reutilización de TA WSAA sin exponer Token/Sign al navegador, sin guardar secretos en colecciones accesibles al cliente y sin solicitar tickets duplicados mientras exista uno vigente.

Hasta completar esa etapa:

- `ARCA_ALLOW_CAE_HOMOLOGATION` debe permanecer en `false` salvo pruebas controladas;
- no se habilita emisión automática en producción;
- no se cambia `ARCA_ENVIRONMENT` a `production`;
- el PR #26 permanece sin merge.


## 25. Caché WSAA compartida cifrada

Se implementó la capa previa a producción para evitar que distintas Netlify Functions soliciten Ticket de Acceso WSAA de forma independiente.

### Arquitectura

La resolución de TA ahora sigue este orden:

1. caché caliente en memoria del proceso;
2. caché compartida server-side en Firestore;
3. lease exclusivo de renovación;
4. sólo el holder del lease puede llamar a `LoginCms`;
5. el TA resultante se cifra antes de persistirse;
6. otras instancias reutilizan el TA compartido.

Colección backend:

`arcaWsaaTickets/{environment}_{service}`

El navegador tiene lectura y escritura explícitamente denegadas por reglas Firestore. La cuenta de servicio del backend accede mediante la API administrativa.

### Cifrado

Token y Sign no se persisten en claro.

Se usa:

- AES-256-GCM;
- IV aleatorio de 96 bits;
- authentication tag de GCM;
- AAD ligada a versión, entorno y servicio;
- clave de 32 bytes Base64 en `ARCA_TA_ENCRYPTION_KEY`.

La AAD evita reutilizar un ciphertext de un entorno/servicio como si perteneciera a otro.

### Concurrencia

La renovación utiliza un lease con CAS basado en `updateTime` de Firestore.

Si dos instancias intentan renovar simultáneamente:

- una adquiere el lease;
- la otra espera y consulta el documento compartido;
- cuando el primer worker publica el TA, el segundo lo reutiliza;
- si otro worker publicó un TA entre lectura y adquisición del lease, no se vuelve a llamar WSAA.

### Producción

`requestAccessTicket` rechaza el uso de producción si no existe `ARCA_TA_ENCRYPTION_KEY`.

En homologación se mantiene temporalmente compatibilidad con caché en memoria si la clave todavía no está configurada, para permitir migración controlada.

### Inspección segura

Se agregó un diagnóstico de caché que informa únicamente:

- configurada/no configurada;
- documento presente;
- payload descifrable;
- TA reutilizable;
- vencimiento;
- lease activo y su vencimiento.

Nunca devuelve Token, Sign ni la clave de cifrado.

### Validación automatizada

Los tests ARCA cubren:

- longitud/formato de la clave;
- round-trip AES-256-GCM;
- ausencia de Token/Sign en el documento serializado;
- fallo de autenticación GCM si se intenta usar el payload para otro servicio;
- exclusión mutua del lease;
- reutilización del TA publicado;
- cold start simulado: caché de memoria vacía + reutilización desde Firestore sin llamar WSAA;
- bloqueo de producción sin caché compartida;
- inspección segura sin exposición de secretos.

Próxima prueba real: configurar una clave sólo en homologación, crear/reutilizar un TA sin emitir CAE, reiniciar Netlify Dev para borrar la caché en memoria y confirmar que una segunda operación autenticada reutiliza el TA cifrado persistido.


### Endurecimiento adicional del TA compartido

La AAD de AES-GCM quedó vinculada también al CUIT del emisor configurado. Un payload cifrado para otro emisor no puede descifrarse ni reutilizarse aunque comparta entorno, servicio y clave de cifrado.

Se agregó además un smoke test administrativo específico de homologación:

`FEParamGetPtosVenta -> requestAccessTicket -> caché WSAA compartida`

Esta prueba:

- es autenticada contra WSFE;
- no llama a `FECAESolicitar`;
- no crea comprobantes;
- informa si creó/renovó el TA o reutilizó uno ya persistido;
- permite validar un cold start reiniciando Netlify Dev y repitiendo la prueba;
- confirma la reutilización si `updatedAt` y `ticketExpiresAt` permanecen iguales.

La pantalla de Configuración puede inspeccionar el estado de TA de WSFE y Padrón sin mostrar Token/Sign ni la clave.


## 26. TA compartido WSFE validado en cold start real

La arquitectura de caché WSAA compartida fue validada en homologación con una clave AES-256-GCM configurada fuera del repositorio.

Prueba real:

1. `ARCA_ALLOW_CAE_HOMOLOGATION=false`.
2. Primera llamada autenticada a `FEParamGetPtosVenta`:
   - creó/renovó un TA `wsfe`;
   - el TA fue publicado cifrado en Firestore.
3. Se detuvo y reinició Netlify Dev para vaciar deliberadamente la caché en memoria.
4. Segunda llamada a `FEParamGetPtosVenta`:
   - reutilizó el TA persistido;
   - no ejecutó otro `LoginCms`;
   - no apareció `coe.alreadyAuthenticated`.
5. El estado seguro informó `TA compartido WSFE: reutilizable`.

Con esto queda validado el caso de cold start real para `wsfe` sin emitir CAE ni comprobantes.

## 27. Preparación adicional antes de producción

Se agregó un gate separado para conexiones a endpoints productivos:

`ARCA_ALLOW_PRODUCTION_READONLY=false`

Mientras permanezca en `false`, WSAA/WSFE/Padrón de producción no pueden ser contactados accidentalmente.

Incluso con el gate read-only habilitado, el autorizador de CAE continúa bloqueando producción por código. La futura validación productiva debe comenzar únicamente con operaciones de lectura/conectividad.

También se agregó un smoke compartido independiente para `ws_sr_constancia_inscripcion`, usando sólo el CUIT de ejemplo de homologación publicado por ARCA y sin consultar clientes reales.


## 28. Preflight productivo read-only preparado

Antes de cualquier habilitación de CAE productivo se incorporó una etapa explícita de sólo lectura.

Nuevo gate:

`ARCA_ALLOW_PRODUCTION_READONLY=false`

Mientras permanezca en `false`, cualquier conexión a WSAA/WSFE/Padrón productivo queda bloqueada por código. Homologación no requiere este gate.

Cuando en el futuro se configure un entorno productivo separado con certificado/autorizaciones reales, el preflight podrá validar sin emitir comprobantes:

- `FEDummy`;
- `FEParamGetPtosVenta`;
- presencia del punto de venta productivo configurado;
- `getPersona_v2` sobre el propio CUIT emisor;
- TA compartido `wsfe`;
- TA compartido `ws_sr_constancia_inscripcion`.

El resultado sólo expone metadatos operativos. No devuelve Token, Sign, certificado, clave privada ni datos fiscales detallados.

La emisión de CAE en producción continúa explícitamente bloqueada dentro del autorizador aunque el gate read-only esté habilitado.


### Compatibilidad de migración del primer TA cifrado

La primera validación real de cold start creó un documento de caché con esquema v1, antes de vincular la AAD al CUIT emisor.

Para no invalidar ese TA existente al actualizar código:

- el esquema actual de escritura es v2;
- el lector acepta temporalmente v1 y v2;
- v1 se descifra con la AAD histórica exacta;
- v2 usa AAD ligada a entorno + servicio + CUIT emisor;
- el diagnóstico marca `needsMigration=true` para v1;
- en la siguiente renovación natural, el documento se reescribe automáticamente como v2.

Así, un deploy nuevo no rompe el TA compartido que ya fue validado en homologación.


## 29. TA compartido de Padrón validado en cold start real

La caché WSAA compartida también fue validada en homologación para el servicio `ws_sr_constancia_inscripcion`.

Prueba real:

1. primera ejecución de `getPersona_v2` contra el CUIT de ejemplo oficial de homologación;
2. creación/renovación del TA específico de Padrón;
3. persistencia cifrada en Firestore;
4. reinicio completo de Netlify Dev para borrar la caché en memoria;
5. segunda ejecución de `getPersona_v2`;
6. reutilización del TA persistido, sin nuevo `LoginCms`;
7. estado seguro: `TA compartido Padrón: reutilizable`.

Con esto quedan validados en cold start real los dos servicios WSAA usados actualmente por la integración:

- `wsfe`;
- `ws_sr_constancia_inscripcion`.

## 30. Validación offline de certificado y clave

Antes de solicitar un TA nuevo, el backend valida localmente el par criptográfico configurado:

- el certificado debe parsear como X.509;
- la private key debe parsear correctamente;
- la clave pública derivada de la private key debe coincidir con la del certificado;
- el certificado debe estar dentro de su período de vigencia.

El estado seguro puede mostrar vigencia y fingerprint del certificado, pero nunca devuelve certificado completo ni private key.

Esta validación será especialmente útil antes del primer preflight read-only de producción.

### Próximo bloqueo externo

La arquitectura homologación ya valida:

- emisión y verificación de CAE;
- idempotencia y reconciliación;
- WSAA compartido WSFE;
- WSAA compartido Padrón;
- cold starts;
- cifrado server-only;
- reglas Firestore;
- gate productivo de sólo lectura;
- CAE productivo bloqueado.

El siguiente bloqueo ya no es de código: para probar producción en modo read-only hace falta un certificado de producción emitido por ARCA y asociado a los servicios `wsfe` y `ws_sr_constancia_inscripcion`, además del punto de venta productivo configurado.


## 31. Certificado productivo recibido y siguiente preflight

El certificado productivo fue creado fuera del repositorio y asociado en ARCA a:

- `wsfe`;
- `ws_sr_constancia_inscripcion`.

Alias productivo informado: `florMiaWebAppProduccion`.

La homologación local permanece separada y con CAE deshabilitado.

Antes de la primera conexión productiva deben cumplirse todos los prerrequisitos locales:

- `ARCA_ENVIRONMENT=production`;
- `ARCA_POINT_OF_SALE` productivo configurado;
- certificado productivo cargado en `ARCA_CERTIFICATE_PEM`;
- private key productiva correspondiente cargada en `ARCA_PRIVATE_KEY_PEM`;
- una clave de cifrado TA exclusiva del perfil productivo en `ARCA_TA_ENCRYPTION_KEY`;
- `ARCA_ALLOW_PRODUCTION_READONLY=true`;
- `ARCA_ALLOW_CAE_HOMOLOGATION=false`.

El preflight valida offline el par certificado/private key y la presencia de la clave de cifrado antes de realizar cualquier request a ARCA.

La pantalla de producción read-only no muestra los controles de homologación y el botón de preflight permanece deshabilitado hasta que certificado, clave, cifrado TA y punto de venta estén configurados.

La emisión de CAE productivo sigue bloqueada por código.
