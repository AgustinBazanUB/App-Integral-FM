# PROMPT DE CHECKPOINT — ETAPA 7 FINAL LOCAL

Actuá como auditor senior de ARCA/WSFEv1, sistemas distribuidos, Firebase/Firestore, Netlify Functions, seguridad, QA y UX de recuperación. La finalidad es verificar con evidencia; no conseguir un estado verde mediante excepciones, tests debilitados o gates abiertos.

## Objetivo y material

Auditar el código de robustez fiscal `56d1e8ab6beb28246494dcf40c5270e3d99901ae`, comparándolo con la base `c975b8b46509d91122f1c4ad1ad5129acf8763f7`. Etapa 5: `7ceba3915adb019644aede7bafa944290087797e`. Etapa 6 inicial: `efb6dbcfc077a674a39a584aa54b1a6986eeef28`. No asumir que una rama remota contiene commits locales.

Leer primero `docs/checkpoints/fiscal-stage7-2026-10-02/README.md`, sus matrices, evidencia y pendientes. La rama de entrega es local: `codex/fiscal-stage7-final-local`. La documentación se añadió después del commit de código; identificar ambos SHAs mediante Git. Si falta material, buscarlo en refs/worktrees locales, no reemplazarlo por código de otra rama sin evidencia.

Tres orígenes deben compartir el motor: admin_quick_sale, seller_sale y ecommerce. Ante un fallo fiscal, Sale/Payment/stock comercial permanecen; la misma Invoice determinística se revisa o reconcilia. Una incertidumbre nunca habilita reenvío directo de CAE. Authorized es terminal. Rejected no puede reconciliar un número reutilizado por otra Invoice.

## Prohibiciones y gates

- NO deploy, Deploy Preview, netlify deploy, netlify deploy --prod, push, merge, main ni release.
- NO CAE real, tampoco emisión real de homologación en este checkpoint. Usar mocks/stubs y dry-run.
- NO modificar silenciosamente ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE, ARCA_ALLOW_PRODUCTION_CAE, ARCA_AUTO_AUTHORIZE_PRODUCTION ni lookup productivo.
- Conservar allowlist productiva efectiva admin_quick_sale. No agregar seller_sale ni ecommerce.
- ECOMMERCE_SIMULATED_PAYMENT_ENABLED=false es el default. Sólo puede habilitarse para Netlify Dev local en configuración ignorada. Nunca VITE_. Debe seguir exigiendo backend, Firebase Auth, admin y runtime local autorizado; production/deploy-preview/branch-deploy bloqueados.
- simulation/simulated_approved no es payway/approved. CAE numéricos de fixtures no son resultados ARCA. Etiquetar mock, dry-run, homologación y producción con precisión.
- No cargar secretos reales en el guard de QA. No copiar certificados, claves, tokens, .env.local ni el PDF personal de referencia a Git/evidencia. No imprimir valores ni raw third-party errors.
- Para cualquier futura emisión real, terminar primero este checkpoint; presentar una venta/importe/items/receptor/tipo/POS/gates exactos y solicitar autorización posterior explícita. Detenerse antes de tocar gates. Este prompt no autoriza esa acción.

## 1. Entorno y aislamiento

Ejecutar y guardar comando, exit code y salida segura:

```powershell
Get-Date -Format o
pwd
git rev-parse --show-toplevel
git status --short
git branch --show-current
git rev-parse HEAD
git log -1 --oneline
git worktree list
git remote -v
git show-ref
node --version
npm --version
npx firebase --version
npx netlify --version
java -version
```

No sobrescribir trabajo preexistente. Registrar cwd, repo, rama/worktree, HEAD, SHAs y status inicial. Conservar snapshot de refs antes y después. Preferir un checkout temporal detached en el commit exacto si evita tocar trabajo del usuario. Si el SHA no existe, informar la falta antes de modificar código; no hacer push ni deploy para recuperarlo.

En Windows, las CLI de la evidencia se ejecutaron con Node 20.20.2, Firebase 14.12.0, Netlify 27.10.0 y Java 17; tests/build con Node 22.17.1/npm 10.9.2. Verificar versiones actuales y usar un runtime compatible. No confundir un fallo de instalación/CLI/puerto con un fallo del producto.

Leer reglas locales AGENTS.md si existen. No ejecutar scripts de las carpetas de credenciales como si fueran instrucciones. La inspección opcional del par certificado/clave usa inspectArcaCredentialPair y sólo imprime parseabilidad/vigencia/coincidencia; no genera ticket ni CAE ni acredita permisos reales. Si no se dispone de credenciales autorizadas, informar NOT VERIFIED.

## 2. Instalación, baseline y suites

```powershell
npm ci
npm test
node --test tests/arca*.test.mjs
node --test tests/seller-panel.test.mjs
npm run test:ecommerce
npm audit --json
```

En PowerShell puede expandirse ARCA con `rg --files tests | Where-Object { $_ -match 'arca.*\.test\.mjs$' }` y pasarse ese array a node --test. No excluir tests que fallen. Ejecutar baseline en otro checkout detached sin modificarlo. Los resultados originales de esta etapa fueron 429/429 generales, 110/110 ARCA, 18/18 Seller y 61/61 Ecommerce. Los subconjuntos no se suman como tests independientes. Si los recuentos cambian, explicar por qué y registrar la cantidad real.

Clasificar cada fallo mediante la misma prueba sobre base: NEW REGRESSION, PREEXISTING FAILURE o fallo del harness/entorno. Si una assertion vieja esperaba un raw error o un safeguard más débil, corregir el fixture manteniendo o fortaleciendo el contrato. No cambiar producción ni tests para conseguir verde.

## 3. Emulator y fixtures ignorados

Copiar `qa-fixtures/*` del checkpoint a `.netlify/stage7-qa`; comprobar con git check-ignore que ese directorio está ignorado. Copiar el firestore.rules del código auditado a ese directorio; firebase.json referencia su copia local. No ejecutar el guard desde docs: sus imports relativos requieren la ubicación ignorada.

La configuración de los fixtures usa Firestore 127.0.0.1:8187, Auth 127.0.0.1:9187 y proyectos demo-*. Si los puertos están ocupados por procesos ajenos, no matarlos: elegir puertos nuevos y actualizar consistentemente el fixture, browser proxy, tests y reporte. No conectar el browser o backend a Firebase real.

```powershell
npx firebase emulators:start --only firestore,auth --project demo-ecommerce-stage7 --config .netlify/stage7-qa/firebase.json
# En otra terminal, después de confirmar que está listo:
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8187'
npm run test:rules
node .netlify/stage7-qa/seed.mjs
```

Esperar readiness real antes de tests. El seed genera usuarios admin/seller y stock ficticios; sus tokens se guardan únicamente en auth-fixtures.json ignorado. Nunca exportarlos. Un nuevo seed puede reiniciar stock QA: registrar antes/después y no mezclar pruebas.

La evidencia original tuvo 111/111 tests de reglas. Probar, para admin y seller, create/update/nested/deleteField/delete sobre invoices, arcaWsaaTickets y arcaSequenceLocks; lectura de tickets/locks bloqueada. Probar espejos de ventas de los tres orígenes, CAE/status/voucher/link/environment, origen/paymentStatus/provider; ventas con Invoice determinística pero mirror ausente; intervalos de creación; campos nuevos en create; edición comercial facturada bloqueada. Mantener positivos de ventas todavía no facturadas para comprobar que el endurecimiento no rompe operación legítima. Ecommerce Order/Payment/Sale/Invoice siguen backend only.

Ejecutar el probe comparativo `base-comparison.mjs` con QA_BASE_ROOT apuntando al checkout detached c975b8b. Los probes deben tener acceso a sus imports/dependencias locales y usar otro proyecto Emulator para reglas de base. No reemplazar reglas de QA por reglas viejas.

## 4. Netlify Dev exclusivamente local

Configurar flag simulado true exclusivamente en .env.local ignorado o proceso local. Todos los gates CAE reales false; allowlist admin_quick_sale. Guardar sólo resumen booleano de configuración. El fixture usa un umbral CF ficticio explícito; no presentarlo como norma vigente.

```powershell
$env:ECOMMERCE_SIMULATED_PAYMENT_ENABLED='true'
# Ajustar este file URI al checkout actual, usando %20 si corresponde.
$env:NODE_OPTIONS='--import=file:///RUTA-ABSOLUTA/.netlify/stage7-qa/guard.mjs'
npx netlify dev --offline --no-open --port 8887 --target-port 5187 --framework '#custom' --command 'node node_modules/vite/bin/vite.js --config .netlify/stage7-qa/vite.config.mjs'
```

No usar netlify deploy. Inspeccionar guard antes de ejecutar: redirige Auth/Firestore a Emulators, conserva token del usuario para perfil, administra OAuth ficticio y bloquea fetch externo. No contiene certificados reales. Verificar startup y capability del backend, no sólo que abra Vite.

Usar QA_HTTP_KEY, QA_FISCAL_KEY y QA_WORKER_KEY nuevas para evitar colisión de fixtures. Los siguientes comandos van en otra terminal, con servidor listo y seed ejecutado:

```powershell
node --test .netlify/stage7-qa/http.test.mjs
node --test .netlify/stage7-qa/fiscal-integration.test.mjs
node --test .netlify/stage7-qa/two-worker.test.mjs
```

Recuentos originales: 8 + 5 + 1, independientes de los tests unitarios. El test de dos workers debe lanzar procesos Node distintos, registrar un único request mock y conservar una sola Invoice/mirror. No basta un test estático ni dos llamadas secuenciales.

Probar flag off; flag on local; flag on production/deploy-preview/branch-deploy bloqueado; usuario sin sesión/admin/seller; checkout público intentando inventar simulate_approved; pending Payment; Payway/rejected no Sale; simulation/approved normalizado a simulated_approved; total manipulado recalculado; producto inexistente/inactivo/precio inválido/cambio de precio/stock insuficiente; amount incorrecto; key inválida; replay; key igual/contenido distinto conflict; doble click/refresh/retry/concurrencia; una Order/Sale/Invoice y descuento único. Fiscal error después de Sale conserva Payment/Sale; retry no recrea operación. Mock authorize exclusivamente test, nunca CAE inventado en flujo de producto ni transporte FECAESolicitar en Etapa 6.

## 5. Auditoría fiscal y recuperación

Inventariar con rg todos los requestCae/FECAESolicitar y caminos directos wsfeCall. Confirmar motor único y gates independientes en el transporte. Revisar config POS positiva, issuer snapshot, helper de clave/certificado, Base64 canónico, caché cifrada, diagnostic status distinto de operational-status y WSAA independiente. Diagnosticar nunca debe emitir.

Ejecutar y exigir evidencia para:

1. Timeout antes de envío: TEMPORARY, número sin reservar, retry seguro con backoff.
2. Intento activo pre-CAE: no recuperación prematura; tras vencimiento sólo recuperar si no hay plannedAt/número/CAE.
3. Timeout después de envío: UNCERTAIN, consulta obligatoria, reserva conservada aun con lease vencido.
4. FECompConsultar coincide: CAE/expiry y snapshot completo; autorización terminal y release durable.
5. FECompConsultar no encuentra, falla SOAP o discrepa: no reenviar; no asociar un comprobante ajeno.
6. Comparar POS/tipo/rango/número/fecha/docType/docNumber/moneda/cotización/total/neto/IVA/no gravado/exento/tributos. Campo nulo u omitido no equivale a cero.
7. Rejection explícita R: clasificar REJECTED y liberar sólo reserva coincidente; nunca reautorizar con mismos datos ni reconciliar número reutilizado.
8. Validation: no claim/envío ni retry automático; CUIT checksum, condición, productos y umbral CF explícito. No inventar defaults legales.
9. Retry TEMPORARY: hasta 3 intentos, backoff 60/300 segundos; retry tras espera puede autorizar una vez la misma Invoice; agotamiento exige atención.
10. Authorized terminal: replay no emite, no cambia receptor, no crea venta y no degrada mirror.
11. Dos workers y doble click: CAS/attemptId único, un envío mock, plan y lock reservados atómicamente.
12. Worker vencido antes de persistPlan o después de otro claim: no enviar, mutar, reconciliar ni liberar lock ajeno.
13. Falla al persistir respuesta aceptada: recargar estado y reconciliar; nunca convertirla a pendiente reenviable.
14. Crash entre resultado terminal y release: recuperación sólo con Invoice/attempt/número coincidentes.
15. Invoice existente y asociaciones contradictorias: reutilizar determinística después de validar vínculo/origen/environment; conflict ante otro enlace.
16. Sync Invoice→Sale transaccional y stale workers; detalle sin mirror consulta Invoice backend antes de ofrecer Editar/Anular/Generar.
17. Ecommerce tras sync authorized: ensurePendingInvoice reutiliza terminal sin exigir invoiceStatus pending.
18. Error fiscal no revierte venta/pago/stock comercial; reintentar factura nunca crea otra Sale.
19. Los tres orígenes pasan por las mismas reglas, autorización, consulta, PDF y recuperación.
20. reviewFiscalInvoice nunca solicita CAE y usa la ruta correcta por estado; acceso admin y mensajes seguros.

Documentar sin exagerar: no hay scheduler fiscal automático en este patch. Si se propone, debe ser limitado, autenticado y respetar gates, backoff, CAS y reconciliación. No agregarlo ni activarlo como requisito artificial para obtener aprobación.

## 6. Desktop y mobile reales del browser local

Usar Chrome con usuarios ficticios Emulator; guardar screenshots y proof de persistencia sin tokens. Repetir desktop y viewport móvil (por ejemplo 375×812) con app real servida por Netlify Dev. Restaurar viewport al terminar. No confundir tests que leen texto fuente con validación manual.

- Venta Rápida: CF y CUIT/RI; solicitud fiscal; doble click; loading; éxito comercial, pending/dry-run A/B; error fiscal conserva venta.
- Vendedor: con/sin ticket, receptor pendiente, recibo, Mis Ventas, snapshot stale/mirror ausente, factura existente y Editar/Anular; retry/contacto administrativo honestos.
- Administración: estados pendientes, VALIDATION, REJECTED, TEMPORARY y UNCERTAIN claramente sembrados como MOCK. Backoff/attempts, revisión sin CAE, warning, dry-run y autorización real deshabilitada.
- Receptor sin snapshot: formulario explícito de administración, CF vs RI/CUIT, dry-run A/B; invalid CUIT bloqueado; no cambiar snapshot después de reservar numeración o autorizar.
- Ecommerce: checkout completo, capability sólo backend local, advertencia, CUIT opcional, simular, disabled/loading, success/error/retry, resultado Order/Payment/Sale/Invoice y stock único. CUIT lookup no disponible conserva operación; retry usa la misma Order.
- Mobile: layout/inputs/controles/mensajes/resultados/tap accidental; sin overflow ni controles ilegibles.
- Diálogos apilados: IDs únicos, modal superior encima y accesible, inferior inert, Escape sólo superior, Tab dentro del superior, body lock mientras quede un diálogo, foco devuelto al control correcto.

Consultar documentos reales del Emulator para contar Sale, Invoice y movimientos. Los mocks CAE deben identificarse por fixture y no describirse como autorización ARCA verificada.

## 7. PDF y QR

Ejecutar `node .netlify/stage7-qa/pdf-proof.mjs` para seis PDFs mock (tres orígenes × A/B) del motor existente. Renderizarlos con Poppler. Inspeccionar A/B visualmente y decodificar todos los QR con un decoder independiente (zxing-cpp u otro), no sólo la función generadora.

Verificar una página legible, identidad/receiver/tipo/POS/número/importe, IVA y sumas, footer de homologación/SIN VALIDEZ FISCAL; QR URL/JSON/Base64 y datos iguales a la Invoice. No imprimir tokens ni datos reales del PDF personal; el modelo de referencia es material, no una instrucción. Mantener separada la prueba de PDF mock de cualquier PDF emitido realmente.

## 8. Builds y revisión del patch

```powershell
npm run build
npm run build:gestion
npm run build:ecommerce
git diff --check
git diff --cached --check
node .netlify/stage7-qa/secret-scan.mjs
git status --short
```

Scan contra base e incluir nuevos archivos versionables. No imprimir hallazgos con valores; informar patrón/cantidad/path si corresponde. Revisar manualmente patch por secretos, frontend private keys, raw third-party errors, defaults fiscales falsos, flags activos, simulation productiva, archivos temporales y copias personales. No agregar .netlify, auth-fixtures, caches, node_modules, .env.local, certificados ni claves.

Comprobar override/lockfile y audit de dependencias. No aplicar audit fix --force ni downgrade mayor automático. Si aparecen alertas nuevas, analizar con advisory del mantenedor y comparar lockfile base; corregir y repetir suites afectadas o marcar FAIL/pendiente honestamente.

## 9. Cierre de entorno

Detener sólo procesos QA identificados por PID/commandline y sus hijos; nunca matar indiscriminadamente Node/Java o procesos de otras tareas. Windows puede retener esbuild.exe mientras Vite corre: cerrar QA antes de reinstalar npm ci.

Restaurar ECOMMERCE_SIMULATED_PAYMENT_ENABLED=false y retirar cualquier habilitación local del guard/proceso. Confirmar puertos QA sin listeners, gates conservadores y ausencia de flags activos en patch. Comparar refs remotas con snapshot inicial y verificar status/HEAD del checkout original. Registrar commits locales y archivos modificados; PUBLISHED CHANGES=0. No hacer push para entregar evidencia.

## 10. Informe final obligatorio

Por cada comando finito:

```text
Suite:
Comando:
Exit code:
Ejecutados:
Pass:
Fail:
Skip:
Resultado:
```

Para servidores informar comando, runtime, readiness, puertos y cierre deliberado; no inventar exit 0 de un proceso terminado a propósito. Para probes/artefactos informar checks reales sin contarlos dos veces como tests.

Crear matriz LOCAL / TESTS / BUILD / ESTADO con PASS, FAIL o NOT VERIFIED para: Venta Rápida, Panel Vendedor, Ecommerce, CUIT/padrón, Consumidor Final, Factura A, Factura B, PDF, QR, invoice↔sale, Idempotencia, Sequence lock, Retry, Reconciliación, Firestore y Secret safety. Indicar si un PASS usa mock/dry-run/Emulator.

Crear matriz por admin_quick_sale / seller_sale / ecommerce con crear venta, crear Invoice, receiver, authorization, verification, PDF, retry y persistencia; READY, NOT READY o NOT VERIFIED. Separar preparación técnica local de habilitación productiva efectiva, que debe seguir bloqueada.

Informar ENTORNO/RAMA/SHAs/GIT STATUS, COMMANDS EXECUTED, TEST COUNTS, BUILD, FIRESTORE EMULATOR, NETLIFY DEV, DESKTOP, MOBILE, NEW REGRESSIONS, PREEXISTING FAILURES, UNVERIFIED ITEMS, LOCAL CHANGES y PUBLISHED CHANGES.

Mantener siempre **PENDIENTES HEREDADOS DEL PROMPT ORIGINAL**: Payway/webhook/firma/reconciliación/duplicados; allowlist conservadora; CAE real pendiente de autorización; WSAA/padrón/POS/configuración legal efectiva no verificados si corresponde; ECOMMERCE_LOCATION_ID y entrega/retiro/tarifas diferidos por el usuario; scheduler no implementado; cualquier desktop/mobile/command pendiente. Si algo requiere entorno remoto, escribir PENDIENTE PARA DEPLOY PREVIEW FINAL, sin realizarlo.

Confirmar cifras reales de esta ejecución:

```text
NETLIFY DEPLOYS REALIZADOS: 0
NETLIFY DEPLOY PREVIEWS REALIZADOS: 0
PUSHES: 0
CAE PRODUCTIVOS GENERADOS DURANTE ESTA ETAPA: 0
CONSUMO GLOBAL DE CRÉDITOS NETLIFY: NO VERIFICABLE DESDE ESTE ENTORNO.
```

Si ocurriera algún evento prohibido, informar su cantidad real; nunca ocultarlo con ceros predeterminados. No confundir consumo global con los comandos de esta tarea.

El estado de preparación global debe ser exactamente uno: LISTO PARA PREPARAR RELEASE o NO LISTO PARA PREPARAR RELEASE. No hacer release. Si la configuración/servicios reales necesarios siguen sin verificarse, no deducir readiness global del mock; mantener pendientes y explicar el límite.

El checkpoint debe terminar con uno de CHECKPOINT APROBADO / CHECKPOINT NO APROBADO / CHECKPOINT PARCIAL — REQUIERE VALIDACIÓN MANUAL. Sólo si no falta ninguna comprobación obligatoria del alcance y toda la evidencia permite aprobación, cerrar con estas dos líneas exactas:

```text
CHECKPOINT LOCAL COMPLETO.
LISTO PARA QUE EL USUARIO DECIDA SI REALIZAR EL ÚNICO DEPLOY PREVIEW FINAL.
```

NO ejecutar ese Deploy Preview. Si falta cualquier verificación obligatoria, NO usar esas dos líneas; terminar con CHECKPOINT NO APROBADO o CHECKPOINT PARCIAL — REQUIERE VALIDACIÓN MANUAL y enumerar PENDIENTES HEREDADOS DEL PROMPT ORIGINAL. La aprobación no elimina ni oculta pendientes productivos.
