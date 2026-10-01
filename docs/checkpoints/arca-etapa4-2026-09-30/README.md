# Checkpoint de auditoría ARCA — Etapa 4

**Estado: NO APROBADO.** Fecha: 2026-09-30. Esta rama conserva el código auditado y la evidencia para continuar desde otra PC. No contiene correcciones de producto y no habilita emisión.

## Identidad e integridad

- Repositorio: `AgustinBazanUB/App-Integral-FM`.
- Commit auditado: `9078b3997394c1af778da0b491cbc09b25c8b617`.
- Mensaje: `feat(arca): add seller post-sale invoice flow`.
- Parent único confirmado: `29d0af7e5c802d4520b510af899375de1a8ab059`.
- Rama de continuación: `codex/audit-arca-etapa4-checkpoint`.
- `feature/arca-integration` observado: `1419f984011616384705c95b48e032cbb60f76a7`.
- `main` observado: `36c7eb010b4c7b7246edbbc4ba471c0862a14ac8`.
- El checkpoint agrega únicamente documentación, fixtures locales de auditoría y evidencia sintética. Los worktrees y trabajos locales anteriores se conservaron.

El commit auditado NO contiene las correcciones locales posteriores de Etapa 3 (`e2be0bbfdea10286a031bcc17a169aaa6f7f4321`) ni el ajuste de factura PDF (`6ae301cd43f59a962eb664240db997d605b38237`). También se conserva ese trabajo previo en `prior-stage3-security-pdf.bundle` para recuperarlo en otra PC. No se aplicó a Etapa 4 ni se considera auditada su combinación con el flujo seller.

GitHub rechazó publicar directamente el historial auditado: la autorización OAuth disponible no tiene permiso `workflow` para actualizar `.github/workflows/arca-ci.yml`. Por eso la rama publicada parte de `1419f984...` y agrega sólo este checkpoint. El código exacto de Etapa 3/4 está preservado en `audited-code.bundle`, como objetos Git transportables e inertes. No se cambió ninguna autorización para sortear el rechazo. Recuperar el código mediante los pasos siguientes antes de ejecutar sus pruebas.

Se comprobó la recuperación en un clon local nuevo sin objetos compartidos: fetch del primer bundle, worktree con SHA exacto `9078b399...` y parent `29d0af7...`, y fetch del segundo bundle con SHA exacto `6ae301cd...`. La comprobación de recuperación no repitió todas las suites; esas se ejecutaron sobre el worktree auditado descrito en este informe.

## Alcance de las comprobaciones

Se revisaron exactamente los 15 archivos esperados del commit: workflow ARCA, documentación, persistencia de invoices, Firebase Auth, Function `arca-invoice`, permisos, SellerPanel, SellerSaleInvoiceSection, offlineSales, arcaService, sellerService y cuatro archivos de tests ARCA/seller.

Se confirmó que no cambiaron `.env.example`, `firestore.rules`, config, authorizer, sequenceLock, wsaa, wsfe, arca-document ni arca-taxpayer respecto del parent exacto.

La validación de interfaz utilizó componentes React reales, servicios seller reales, Netlify Dev y handlers fiscales reales con transporte Firebase/Firestore simulado en localhost. IndexedDB fue real. Los permisos de Firestore se probaron por separado con su emulador real. La simulación offline cambia `navigator.onLine` y emite eventos online/offline; no representa un corte físico de red. Los resultados de los fixtures NO prueban conectividad con ARCA ni credenciales productivas.

No se utilizaron certificados, claves, cuentas reales, Token/Sign ni TA del usuario. Los identificadores, CUIT, CAE y datos comerciales de las capturas son sintéticos. Una clave RSA de prueba se genera en memoria para ejercitar el cliente Firebase Admin; no se persiste.

## Resultados ejecutados

Node 24.14.0; Java 21; Firebase CLI 14.12.0; Netlify CLI 27.10.0.

| Comando | Ejecutados | PASS | FAIL | SKIP | Resultado |
| --- | ---: | ---: | ---: | ---: | --- |
| `npm ci` | — | — | — | — | PASS; 164 paquetes, 0 vulnerabilidades |
| `npm run test:arca` | 155 | 154 | 1 | 0 | FAIL |
| `node --test tests/seller-panel.test.mjs` | 21 | 20 | 1 | 0 | FAIL |
| `npm test` | 380 | 374 | 6 | 0 | FAIL |
| `npm run test:rules:fiscal` | 8 | 8 | 0 | 0 | PASS |
| `npm run test:rules:core` | 23 | 23 | 0 | 0 | PASS |
| Prueba adicional comercial/fiscal con emulador | 2 | 0 | 2 | 0 | FAIL: escrituras que debían denegarse fueron permitidas |
| `npm run build` | — | — | — | — | PASS; advertencia de bundle >500 kB |
| Transformación esbuild de los cuatro JSX fiscales/seller | 4 archivos | 4 | 0 | — | PASS |
| `git diff --check 29d0af7 9078b39` | — | — | — | — | PASS |

No existen scripts focalizados de lint/typecheck aplicables en el package.json auditado. No se retiró el network guard de los tests ARCA.

### Baseline limpio del parent exacto

| Comando | Ejecutados | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: | ---: |
| `npm run test:arca` | 141 | 141 | 0 | 0 |
| `node --test tests/seller-panel.test.mjs` | 18 | 17 | 1 | 0 |
| `npm test` | 363 | 358 | 5 | 0 |

La comparación se realizó en un worktree limpio del parent; no se usaron resultados de un checkout contaminado por probes anteriores.

## Fallos nuevos de Etapa 4

### N1. Suite ARCA roja: contrato de test desactualizado

`tests/arca-invoice-persistence.test.mjs:362`, test «vendedor sólo puede pedir factura de su propia venta; administración puede hacerlo» espera que administración pueda usar `admin_quick_sale` con una venta identificada como seller. La nueva comprobación `saleMatchesSource` rechaza correctamente esa fuente incompatible. El test/fixture no se alineó con el contrato más estricto. Corregir el caso de prueba conservando el rechazo de fuentes incorrectas; no debilitar el safeguard.

### N2. Invoice existente invisible cuando el objeto de venta no trae mirror

`SellerSaleInvoiceSection.jsx:93` retorna sin consultar metadata cuando la venta local no tiene referencia fiscal. Con el detalle abierto y snapshot desactualizado se reprodujo «Factura no generada» y «Generar factura» aunque ya existía una invoice determinística en el backend. El servidor reutiliza la invoice, pero la interfaz incumple el requisito de mostrar la existente y no ofrecer otra original.

Evidencia: [existing-invoice-stale.png](evidence/existing-invoice-stale.png).

### N3. Edición/anulación siguen visibles inmediatamente después de preparar invoice

Los callbacks `onInvoicePersisted` de SellerPanel refrescan la lista diaria pero no actualizan `detailSale`. Con una invoice pending creada por el handler real, el mismo detalle mostró simultáneamente el estado fiscal y «Editar»/«Anular». Una recarga carga el mirror y oculta los botones, pero no corrige el estado actual del modal.

Evidencia: [post-invoice-edit-stale.png](evidence/post-invoice-edit-stale.png).

### N4. Diálogos anidados y cierre/focus

Receipt/detalle más FiscalInvoiceDialog producen dos dialogs con IDs repetidos `fm-modal-title`. En móvil 375, Escape cerró ambos y el foco quedó en BODY. La interacción nueva de Etapa 4 expone este problema del componente Modal compartido. Se necesita controlar apilado, etiquetas únicas y retorno de foco sin cerrar el contexto de venta.

### N5. Cobertura CI seller incompleta

El workflow amplía filtros de rutas, pero no ejecuta `tests/seller-panel.test.mjs`. Las suites que sí ejecuta no sustituyen esa comprobación.

## Fallos heredados reproducidos

### H1. Seguridad: Firestore permite modificar una venta facturada

En el emulador, un vendedor activo propietario de la venta pudo cambiar directamente `total` y `status: cancelled` conservando sus referencias fiscales. Ambos `assertFails` fallaron porque la escritura fue autorizada. Las rules protegen los campos fiscales contra cambios, pero no hacen inmutable la parte comercial de una venta con invoice.

`src/gestion/services/sellerService.js` se ejecuta en el navegador. Sus seis guardas de update/cancel por `fiscalInvoiceId`, `fiscalInvoice` o `invoiceStatus` sí rechazaron las operaciones, pero no constituyen seguridad de backend: un cliente puede llamar al SDK directamente. Las reglas no cambiaron en Etapa 4, por lo que el hueco es heredado y bloquea cerrar el requisito de protección fiscal seller.

Reproducción portable: [fiscal-commercial-probe.mjs](qa-fixtures/fiscal-commercial-probe.mjs). Usar exclusivamente proyecto demo/emulador. No ejecutarlo contra producción.

### H2. Conflicto de asociación invoice ↔ sale

`ensurePendingInvoice` reutiliza una invoice determinística existente antes de rechazar que la venta ya esté vinculada a otra invoice en el mismo ambiente. El probe devuelve `REUSED_CONFLICT` tanto en el parent como en Etapa 4.

### H3. Source declarado incompatible puede presentarse como admin_quick_sale

Los probes con `sale.sourceType=ecommerce` o `seller_sale`, sin `saleOrigin=seller_panel`, se aceptan si la petición administrativa declara `admin_quick_sale`. El caso explícito seller_panel + fuente admin sí devuelve 403; la llamada seller directa ecommerce también devuelve 403. Esos rechazos no cubren el caso heredado de fuente declarada enmascarada.

### H4. Base64 no canónico

Se aceptan claves que decodifican a 32 bytes aunque tengan padding Base64 extra. Se rechazan 31 bytes. La longitud se valida, pero no se cumple completamente «Base64 canónico». No se imprimieron valores de claves.

### H5. Cinco fallos de suite general ya presentes

- Los formularios con cierres inline quedan cubiertos por el fix global.
- Cargar stock abre directamente la sección correcta y valida actividad.
- Los productos se crean desde la ubicación con alcance local predeterminado.
- La vista de productos está agrupada por categoría.
- Stock, navegación y venta actual tienen reglas responsive compactas.

El último también es el FAIL de seller-panel. No se corrigieron fallos ajenos.

### H6. UX heredada

En mobile la navegación pierde nombres accesibles cuando el CSS oculta las etiquetas. Los modales comerciales de edición/anulación presentan problemas de capas y cierre ya existentes; el envío por teclado permitió comprobar ambos flujos. No se atribuyen estos componentes unchanged exclusivamente a Etapa 4.

## Evidencia funcional y Network

| Escenario local | Resultado comprobado |
| --- | --- |
| Venta online normal | Una venta, un movimiento y un descuento; `saleOrigin=seller_panel`; 0 llamadas fiscales durante creación |
| Venta sin factura | Se completa y permanece registrada |
| Receipt y detalle | Ofrecen generar sólo después de venta persistida; defectos N2/N3/N4 pendientes |
| Permisos seller | Estándar y permiso explícito presente: 200; deny, permiso explícito ausente, otro owner y fuente incorrecta: 403 |
| Consumidor Final | Resumen correcto; Factura B con emisor fixture RI; no CAE |
| CUIT | Inválida bloqueada antes de HTTP; válida, inexistente, inactiva, IVA no resoluble y error temporal diferenciados |
| Emisor sin condición fiscal segura | «Se resolverá en el motor ARCA», sin inventar tipo |
| Doble click real | 1 POST arca-invoice desde esa instancia |
| Concurrencia backend | Dos requests; uno created=true y otro false; mismo ID, una invoice |
| Authorized existente | created=false, mismo ID, sin nuevas invoices/autorizaciones |
| Offline | IndexedDB real; sin venta remota, invoice local, CAE ni POST fiscal |
| Sync offline y legacy | Dos ventas remotas determinísticas, dos descuentos; cola vacía; 0 llamadas fiscales durante sync |
| Error fiscal después de venta | Sale, stock y movimientos idénticos antes/después del error |
| Editar/anular venta sin invoice | Operaciones comerciales completadas; no llamadas fiscales |
| Persistencia | Cinco campos fiscales escritos server-side; reload conserva asociación y no pide otra original |
| PDF | metadata y pdf por arca-document; descarga real, PDF de una página inspeccionado con pdfplumber |
| Compartir / reenviar | Se pidió PDF; API nativa respondió «Permission denied». Entrega/compartir no aprobado |

El visor blob no pudo inspeccionarse mediante la automatización del navegador; se respetó esa restricción. La descarga de archivo sí se comprobó. Esto no sustituye revisar visualmente el PDF en un visor permitido ni prueba conformidad con el PDF de referencia del usuario, cuyo ajuste previo no forma parte del commit auditado.

Desktop 1280 y mobile 375/430 se probaron realmente. Sin overflow horizontal; CUIT/resumen legibles, botones PDF de 46 px y cierre de 44 px. El control visual global es FAIL por los defects de estado/cierre y compartir pendiente. Ver [mobile430-real.png](evidence/mobile430-real.png) y [mobile375.png](evidence/mobile375.png).

Conteo total de la sesión sintética (incluye pruebas negativas, fixtures y reintentos): arca-invoice 13, arca-document 10, arca-receiver 11; arca-authorize 0. Hubo 7 commits comerciales y 7 movimientos; stock final 16 desde 20. El conteo agregado no equivale a llamadas por una venta: se usaron snapshots separados para confirmar los ceros en crear/offline/sync/error/PDF. [Resumen](evidence/network-summary.json).

## Safeguards y secretos

Las tres gates productivas versionadas permanecen false y la allowlist versionada es únicamente admin_quick_sale. El harness fuerza gates false sólo dentro de su proceso sintético, elimina credenciales ARCA heredadas y no modifica archivos de secretos del usuario. El entorno de la consola auditora no tenía override de allowlist y el lanzador local examinado tampoco lo configuraba. No fue posible inspeccionar con certeza el entorno de otros procesos de usuario ni variables reales de Netlify.

Escaneo del patch: BEGIN PRIVATE KEY 0; BEGIN CERTIFICATE 0; ARCA_PRIVATE_KEY_PEM 0; ARCA_TA_ENCRYPTION_KEY 0; FIREBASE_ADMIN_PRIVATE_KEY 0; Token 1 (identificador/referencia, no valor secreto); Sign 0. Patch temporal eliminado. Los nombres de variables en los fixtures no son secretos.

No se ejecutó FECAESolicitar ni requestCae real durante este checkpoint. La emisión productiva no se intentó: sus prerequisitos locales no pasan. El guard registró un intento GET de Netlify CLI a edge.netlify.com y lo bloqueó; no hubo intentos a endpoints ARCA. GitHub Actions se consultó por el SHA auditado antes de publicarlo: 0 ejecuciones asociadas. No se revisaron logs remotos ARCA/Netlify ni consumo global de créditos.

## Continuar desde otra PC

1. Instalar Git, Node compatible (se utilizó 24.14.0) y Java 21; comprobar `git --version`, `node -v`, `java -version`.
2. Clonar la rama de checkpoint en una carpeta nueva:

   ```powershell
   git clone --branch codex/audit-arca-etapa4-checkpoint --single-branch https://github.com/AgustinBazanUB/App-Integral-FM.git FM-ARCA-Etapa4
   cd FM-ARCA-Etapa4
   git status --short
   git log -2 --oneline
   $qaCheckpoint = (Resolve-Path docs/checkpoints/arca-etapa4-2026-09-30).Path
   git bundle verify "$qaCheckpoint/audited-code.bundle"
   git fetch "$qaCheckpoint/audited-code.bundle" refs/heads/codex/arca-etapa4-source-local
   git worktree add --detach ../FM-ARCA-Etapa4-Audit 9078b3997394c1af778da0b491cbc09b25c8b617
   cd ../FM-ARCA-Etapa4-Audit
   npm ci
   New-Item -ItemType Directory -Force .netlify/stage4-qa
   Copy-Item -Path "$qaCheckpoint/qa-fixtures/*" -Destination .netlify/stage4-qa -Recurse
   ```

3. Revisar este informe antes de corregir. El worktree recién creado tiene HEAD exacto `9078b399...`; su parent es `29d0af7...`. La rama de GitHub es únicamente el contenedor de documentación y bundles. No usarla como aprobación ni desplegarla. Los fixtures copiados a `.netlify` permanecen ignorados por Git.
4. Repetir los comandos de tests/build de la tabla. Los dos comandos de rules deben ejecutarse secuencialmente para no competir por el puerto del emulador.
5. Reproducir los guards heredados y el hueco de rules sin credenciales:

   ```powershell
   node --import ./scripts/arca-test-network-guard.mjs .netlify/stage4-qa/inherited-guards-probe.mjs
   ```

   Ese probe sólo usa objetos en memoria y no emite. Para el emulador:

   ```powershell
   npx firebase-tools@14.12.0 emulators:exec --only firestore --project demo-flor-mia-integral "node --test .netlify/stage4-qa/fiscal-commercial-probe.mjs"
   ```

   El resultado esperado del código actual es FAIL 2/2, porque las operaciones indebidas son permitidas.

6. Para repetir el flujo visual, copiar los fixtures a su ruta de ejecución local ignorada. El paquete portable se arrancó y se comprobó en un segundo worktree local con una ruta distinta; esto no equivale a haberlo ejecutado físicamente en otra PC:

   ```powershell
   $qaGuard = (Resolve-Path .netlify/stage4-qa/guard.mjs).Path
   $qaPreviousNodeOptions = $env:NODE_OPTIONS
   $env:NODE_OPTIONS = '--import="' + ([System.Uri]$qaGuard).AbsoluteUri + '"'
   npm exec --yes --package=netlify-cli@27.10.0 -- netlify dev --offline --no-open --skip-gitignore --framework '#custom' --command 'node .netlify/stage4-qa/server.mjs' --target-port 5181 --functions .netlify/stage4-qa/functions --port 8888
   ```

   Abrir `http://localhost:8888/.netlify/stage4-qa/index.html`, NO la app conectada a Firebase real. No se requiere login, netlify link, .env ni claves. Detener con Ctrl+C; restaurar `$env:NODE_OPTIONS = $qaPreviousNodeOptions` en esa consola. No compartir este servidor por una red externa: es una herramienta local sintética, no un backend de producción.

7. En la página QA usar el Panel Vendedor real para vender el producto de fixture. Probar receipt → generar y Mis ventas → generar. Para demora/error fiscal, en otra consola:

   ```powershell
   node .netlify/stage4-qa/control.mjs config invoiceDelay=1200
   node .netlify/stage4-qa/control.mjs config invoiceError=true
   node .netlify/stage4-qa/control.mjs config invoiceError=false invoiceDelay=0
   ```

   Los botones QA permiten desconectar/conectar, inspeccionar IndexedDB, añadir legacy y probar guardas comerciales. Para PDF, después de preparar la primera invoice sintética:

   ```powershell
   node .netlify/stage4-qa/control.mjs authorize-fixture
   ```

   Ese comando sólo cambia el fixture en memoria a authorized con CAE ficticio; NO llama a ARCA. Recargar y abrir el detalle. Para los casos de CUIT usar `receiverCase=ok`, `not-found`, `inactive`, `unresolved` o `temporary` con control config. `receiverCase=neutral` prueba emisor sin condición fiscal segura. Verificar manualmente compartir en un navegador que admita esa API, sin enviar datos reales ni facturas reales.

8. Corregir N1–N4 y H1–H4 en trabajo local aislado, con tests dirigidos que demuestren el contrato seguro. Actualizar CI seller/documentación. No cambiar expectativas para aceptar los huecos de seguridad. Repetir todos los controles antes de decidir si se cierra la etapa.

### Recuperar el trabajo previo de seguridad y estructura PDF

Después de recuperar el primer bundle, el parent requerido por el segundo ya está disponible. Se puede abrir el trabajo anterior en otro worktree, sin combinarlo automáticamente con seller:

```powershell
git bundle verify "$qaCheckpoint/prior-stage3-security-pdf.bundle"
git fetch "$qaCheckpoint/prior-stage3-security-pdf.bundle" refs/heads/codex/arca-stage3-security-pdf-local
git worktree add --detach ../FM-ARCA-Etapa3-Seguridad-PDF 6ae301cd43f59a962eb664240db997d605b38237
```

Revisar los diffs y resolver conscientemente la integración de esos cambios antes de una nueva auditoría. No publicar ni desplegar los worktrees como parte de esta recuperación.

## Publicación de este checkpoint

El usuario autorizó expresamente publicar el checkpoint para otra PC después del pedido inicial de no push. Se utiliza una rama codex separada basada en la rama remota, con documentación y bundles; no se mueve feature/arca-integration ni main y no se abre PR. El commit de documentación lleva `[skip netlify] [skip ci]`. Netlify documenta que el marcador en el último commit omite el deploy de todos los commits de ese push: https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/#skip-a-deploy.

No se ejecuta ningún comando de deploy. La ausencia de ejecución local no permite afirmar por sí sola el consumo global de la cuenta ni el estado de todos los servicios remotos.

## Cierre

Los 16 pendientes heredados fueron intentados. Los fallos de tests, seguridad de Firestore y estados/cierre de UI están reproducidos; el compartir nativo y el runtime real permanecen sin aprobación. **La Etapa 4 no puede cerrarse en el commit auditado.**
