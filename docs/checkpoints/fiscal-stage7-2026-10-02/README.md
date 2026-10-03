# Etapa 7 — Robustez fiscal y checkpoint final local

**Código:** `56d1e8ab6beb28246494dcf40c5270e3d99901ae`. **Base:** `c975b8b46509d91122f1c4ad1ad5129acf8763f7`.

Se consolidó la recuperación común de `admin_quick_sale`, `seller_sale` y `ecommerce`, se protegieron las escrituras fiscales y se completaron las validaciones de código, Emulator, Netlify Dev e interfaz. La evidencia fiscal usa transporte mock o dry-run. Ningún comprobante de este checkpoint fue emitido en ARCA.

**Estado del alcance de código local: PASS. Estado de preparación de release: NO LISTO PARA PREPARAR RELEASE. Checkpoint global: CHECKPOINT PARCIAL — REQUIERE VALIDACIÓN MANUAL.** Las verificaciones contra WSAA/padrón/WSFE reales y la configuración operativa efectiva siguen sin evidencia en esta sesión. No se infiere aprobación real a partir del mock, de una clave criptográficamente válida o de un build exitoso.

**NETLIFY DEPLOYS REALIZADOS: 0. NETLIFY DEPLOY PREVIEWS REALIZADOS: 0. PUSHES: 0. CAE PRODUCTIVOS GENERADOS DURANTE ESTA ETAPA: 0.** CONSUMO GLOBAL DE CRÉDITOS NETLIFY: NO VERIFICABLE DESDE ESTE ENTORNO.

## Entorno y trazabilidad

| Campo | Evidencia |
|---|---|
| Fecha | 2026-10-02, America/Buenos_Aires |
| Primer registro conservado | Snapshot de refs creado a las 10:10:42; es un registro de evidencia, no una estimación de inicio de toda la conversación |
| Sistema | Windows / PowerShell |
| Repo | `https://github.com/AgustinBazanUB/App-Integral-FM.git` |
| Worktree de auditoría | `C:\Users\agsba\OneDrive\Documentos\ChatGPT\FM-Fiscal-Etapa7-Local` |
| HEAD inicial | Detached, `c975b8b46509d91122f1c4ad1ad5129acf8763f7`, status limpio |
| Rama local de entrega | `codex/fiscal-stage7-final-local` |
| Código de Etapa 5 | `7ceba3915adb019644aede7bafa944290087797e` |
| Código inicial de Etapa 6 | `efb6dbcfc077a674a39a584aa54b1a6986eeef28` |
| Etapa 6 corregida | Código `64e8bfed659c92d5e49f5c9636f6a751154e0b49`, documentación/base `c975b8b...` |
| Node / npm | 22.17.1 / 10.9.2 |
| CLI | Firebase 14.12.0 / Netlify 27.10.0, ejecutados con Node 20.20.2 |
| Java | 17, Firestore Emulator 1.19.8 |
| Servicios | Firestore 8187, Auth 9187, Netlify Dev 8887, Vite 5187 |
| Proyecto QA | `demo-ecommerce-stage7`; comparación de reglas en `demo-stage7-base-comparison` |
| Workspace original | `App Web Integral FM`, rama `feature/meta-ads-campaign-planner`, HEAD `e8734ce748249b3830926e0ef8338fb9cb5ef644`; su `?? tmp/` preexistente se preservó |

[Entorno capturado](evidence/environment.json), [cierre y refs](evidence/shutdown.json). Se trabajó detached durante la auditoría y luego se creó únicamente una rama local para conservar los commits. No se ejecutaron fetch, push, merge, deploy ni preview durante Etapa 7. Los cambios publicados son cero; las ramas remotas conocidas y el checkout original permanecen iguales.

Los fixtures ignorados dirigen Auth y Firestore a Emulators, generan una clave administrativa ficticia sólo en memoria y bloquean `fetch` externo. Las credenciales ARCA reales no se cargaron en Netlify Dev. Su inspección criptográfica independiente produjo sólo booleanos: certificados vigentes, claves parseables, pares coincidentes y claves de caché de 32 bytes Base64 canónico, tanto para producción como homologación. **Esto no verifica alta de servicios WSAA, permisos de padrón, POS ni autorización WSFE.** [Inspección sin valores](evidence/credential-inspection.json), [transporte](evidence/network-summary.json).

La configuración activa de QA fue conservadora: todos los gates de CAE/automatización productiva, preparación productiva, lookup productivo y CAE de homologación estuvieron en `false`. `ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES=admin_quick_sale`. El flag de pago simulado estuvo en `true` exclusivamente para Netlify Dev local y se restauró a `false`. Los objetos de entorno de los tests mock habilitan su transporte aislado; no modifican producción. `10000000` se usó exclusivamente como umbral **ficticio de QA**, sin afirmar que sea el umbral legal vigente. El default implícito y el valor numérico del ejemplo se retiraron: ahora se exige configuración explícita.

## Implementación y comportamiento

| Clasificación | Comportamiento seguro |
|---|---|
| VALIDATION | Sin CAE ni retry automático. Corregir datos/configuración; los bloqueos del plan se devuelven al administrador |
| REJECTED | Sin retry de los mismos datos; no entra a reconciliación de numeración que pueda reutilizar otra invoice |
| TEMPORARY | Sólo antes del envío; hasta 3 intentos, 60 s después del primero y 300 s después del segundo; al agotarse requiere atención |
| UNCERTAIN | Conserva reserva durable. Primero `FECompConsultar`; nunca un nuevo `FECAESolicitar` directo |
| AUTHORIZED | Terminal: replay devuelve la misma Invoice, sin nueva autorización ni cambio de receptor |

`recoveryService.mjs` centraliza la revisión administrativa: dry-run, recuperación de claim pre-CAE vencido o reconciliación según el estado. La acción **Revisar recuperación no emite CAE**. No se agregó scheduler, cron ni emisión desatendida: quedaron preparados los campos y gates de retry limitado; la autorización posterior exige una acción explícita y los gates existentes. El servicio conserva `attemptCount`, `nextRetryAt`, `lastError` y `retryable`.

Cada claim tiene un identificador aleatorio y CAS. La persistencia del plan y la reserva del sequence lock forman una transacción Firestore. Un worker vencido no puede reservar/enviar bajo un claim sustituido ni degradar el resultado de otro. Una reserva incierta no vence con el lease; bloquea esa secuencia hasta resolver el comprobante. La liberación exige leer un resultado terminal que coincida con el intento y número reservados; también se recupera una liberación interrumpida.

La respuesta consultada debe coincidir con POS, tipo, número/rango, fecha, receptor, moneda/cotización y seis componentes de importes. Requiere CAE y vencimiento válidos y resultado A. Datos omitidos, importes nulos, errores SOAP, consulta sin comprobante o discrepancias mantienen UNCERTAIN. Los planes legacy sin snapshot completo **no se asocian automáticamente**: requieren revisión administrativa con evidencia; no se reconstruye una identidad adivinada. [Operación oficial FECompConsultar](https://servicios1.afip.gov.ar/WSFEv1/Service.asmx?op=FECompConsultar).

El inventario de llamadas encontró un único transporte `FECAESolicitar`, en `wsfe.mjs:requestCae`, invocado por el authorizer común. Tiene su propio gate de entorno antes de SOAP. Los diagnósticos, revisión, dry-run y Ecommerce Etapa 6 no usan ese transporte. La consulta del último comprobante no inventa el número cero si ARCA omite la respuesta.

La Invoice sigue teniendo ID determinístico por entorno/origen/venta. La creación fiscal y el sync a Sale usan transacciones para impedir carreras con edición comercial y mirrors viejos. Se valida la asociación antes de reutilizar una Invoice. El retry de Ecommerce después del sync autorizado vuelve a cargar la Invoice terminal; no exige que su Sale vuelva a `pending`.

Firestore impide escrituras cliente de Invoice, tickets WSAA y locks, incluso nested/deleteField/delete. Una venta con Invoice determinística o mirror fiscal no se puede modificar comercialmente por SDK; esto también cubre el intervalo anterior al mirror. El create de ventas no puede fabricar campos fiscales; Ecommerce continúa exclusivamente backend. Los campos fiscales y payment/source declarados de ventas existentes están protegidos. Se conservaron pruebas positivas de edición comercial de ventas todavía no facturadas.

La UI diferencia pendiente, rechazo, datos inválidos, temporal e incierto. Administración muestra las últimas 25 solicitudes, backoff y revisión segura. El vendedor puede solicitar factura sin inventar receptor; administración dispone de un formulario explícito previo a dry-run/autorización. El receptor validado se fija junto con la reserva y no cambia después. La UI consulta la Invoice existente aunque el detalle comercial esté desactualizado, bloquea edición/anulación fiscal y conserva Sale/Payment cuando falla la preparación. Los botones respetan loading y los handlers bloquean doble click inmediatamente; los diálogos usan IDs únicos, orden visual, foco y Escape del modal superior.

También se corrigió un provider faltante que rompía el catálogo unificado. `@grpc/grpc-js` pasó de 1.9.16 a 1.13.6 mediante override, manteniendo Firebase 12.17.0. El advisory del mantenedor identifica 1.13.6 como versión corregida. [Advisory oficial](https://github.com/grpc/grpc-node/security/advisories/GHSA-m9gg-hp2v-232j). La reinstalación y todas las suites relacionadas se repitieron con ese lockfile; `npm audit` final registró cero vulnerabilidades. [Antes](evidence/dependency-audit.json), [después](evidence/dependency-audit-final.json).

## Commands executed / test counts

Las suites ARCA, Seller y Ecommerce son subconjuntos de los 429 tests generales: **no se suman dos veces**. Total final independiente: **554 tests, 554 pass, 0 fail, 0 skip** = 429 + 111 + 8 + 5 + 1. La decodificación de seis QR se informa aparte como comprobación de artefactos.

| Suite / comando | Exit code | Ejecutados | Pass | Fail | Skip | Resultado |
|---|---:|---:|---:|---:|---:|---|
| `npm ci`, inicio | 0 | 0 | 0 | 0 | 0 | 163 paquetes; 5 alertas altas heredadas |
| `npm test`, base c975b8b | 0 | 380 | 380 | 0 | 0 | Base sin fallos unitarios |
| `npm install --package-lock-only --ignore-scripts` | 0 | 0 | 0 | 0 | 0 | Override de dependencia vulnerable |
| `npm ci`, primer intento con Vite activo | -4048 | 0 | 0 | 0 | 0 | Windows retenía esbuild.exe; se cerró sólo QA |
| **`npm ci`, final** | **0** | 0 | 0 | 0 | 0 | 164 paquetes, cero alertas |
| **`npm test`** | **0** | **429** | **429** | **0** | **0** | Código completo |
| **`node --test tests/arca*.test.mjs`** | **0** | **110** | **110** | **0** | **0** | ARCA, incluidos recuperación y documentos |
| **`node --test tests/seller-panel.test.mjs`** | **0** | **18** | **18** | **0** | **0** | Vendedor |
| **`npm run test:ecommerce`** | **0** | **61** | **61** | **0** | **0** | Contratos y ejecución comercial/fiscal |
| **`npm run test:rules`**, Emulator | **0** | **111** | **111** | **0** | **0** | Incluye 26 tests fiscales agrupados con múltiples asserts |
| **`node --test .netlify/stage7-qa/http.test.mjs`** | **0** | **8** | **8** | **0** | **0** | Netlify Dev, Auth, pago, stock, idempotencia y retry |
| **`node --test .netlify/stage7-qa/fiscal-integration.test.mjs`** | **0** | **5** | **5** | **0** | **0** | Persistencia REST real en Emulator / transporte fiscal mock |
| **`node --test .netlify/stage7-qa/two-worker.test.mjs`** | **0** | **1** | **1** | **0** | **0** | Dos procesos Node, un envío mock y una Invoice |
| `node .netlify/stage7-qa/base-comparison.mjs` | 0 | 0 | 0 | 0 | 0 | Cinco probes comparativos; no se cuentan como suite Node |
| **`npm run build`** | **0** | 0 | 0 | 0 | 0 | Build unificado |
| **`npm run build:gestion`** | **0** | 0 | 0 | 0 | 0 | Build gestión |
| **`npm run build:ecommerce`** | **0** | 0 | 0 | 0 | 0 | Build ecommerce |
| **`npm audit --json`**, final | **0** | 0 | 0 | 0 | 0 | Cero vulnerabilidades reportadas |
| **`git diff --check` / `git diff --cached --check`** | **0** | 0 | 0 | 0 | 0 | Código y documentación sin errores de whitespace |
| **`node .netlify/stage7-qa/secret-scan.mjs`** | **0** | 0 | 0 | 0 | 0 | Siete patrones, cero hallazgos; más revisión manual |

[Logs finales](evidence/). Los builds conservan advertencias de chunks grandes, sin errores. El scan es focalizado y no acredita ausencia universal de secretos. No se copiaron el PDF personal de referencia, credenciales, tokens Emulator, `.env.local`, `node_modules`, caches ni certificados al patch. El primer agregado de evidencia produjo exit 2 en diff-check porque Git trataba PDFs ASCII como texto y detectó espacios del xref, además de una línea final vacía de firebase.json. Se conservaron los bytes de PDF mediante atributos binarios limitados a esos artefactos y se normalizó el JSON. El diff-check final pasó; no se modificaron PDFs para ocultar errores del producto.

Se ejecutaron también `pwd`, `git rev-parse --show-toplevel`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git log -1 --oneline`, versiones Node/npm/CLI, `git show`, `git diff`, `git show-ref`, búsquedas `rg` y lectura de archivos. Se creó el checkout con `git worktree add --detach ... c975b8b...`; se conservó el código con un commit local y `git switch -c codex/fiscal-stage7-final-local`. El informe se agrega en otro commit local. No se movieron refs remotas.

Emulator se inició con `firebase emulators:start --only firestore,auth --project demo-ecommerce-stage7 --config .netlify/stage7-qa/firebase.json`. Netlify Dev se inició con CLI 27.10.0 bajo Node 20: `netlify dev --offline --no-open --port 8887 --target-port 5187 --framework '#custom' --command 'node node_modules/vite/bin/vite.js --config .netlify/stage7-qa/vite.config.mjs'`, usando el guard mediante `NODE_OPTIONS=--import=file:///.../guard.mjs` y el flag local ignorado. No se invocó ningún subcomando deploy. Los procesos de servidor se detuvieron deliberadamente al cerrar; su terminación no es un fallo de una suite finita.

Se generaron seis PDFs con `node .netlify/stage7-qa/pdf-proof.mjs`, se renderizaron con Poppler y se decodificaron los seis QR independientemente con zxing-cpp/Pillow. Se inspeccionaron visualmente A y B. Todos los PDFs están marcados MOCK/SIN VALIDEZ FISCAL; sus CAE son fixtures numéricos, **no CAE ficticios incorporados al producto**. [QR decodificados](evidence/qr-proof.json), [PDF A mock](evidence/pdf-mock-admin_quick_sale-A.pdf), [PDF B mock](evidence/pdf-mock-admin_quick_sale-B.pdf).

Las ejecuciones intermedias reprodujeron o detectaron fallos que ya están corregidos: fixtures antiguos de consulta incompletos, falta de clasificación de validación, assertions viejas que esperaban mensajes raw, umbral implícito eliminado, Emulator no listo, forma incorrecta de respuesta REST en el harness y un probe que suponía equivocadamente que la base reconciliaba rechazadas. No se contabilizan como fallos finales ni se silencian tests. Se actualizaron fixtures a contratos más estrictos y se añadieron verificaciones de comportamiento.

## Desktop, mobile y persistencia

Revisión manual por navegador local Chrome con usuarios ficticios de Firebase Auth Emulator: desktop y viewport móvil 375 × 812. No acredita Safari ni dispositivos físicos.

| Flujo | Evidencia observada |
|---|---|
| Venta Rápida desktop | Doble click después de la corrección: FM-LOC-0003, una venta/Invoice; stock 45 → 44; CF, plan B sin CAE |
| Venta Rápida mobile | FM-LOC-0006, una venta; stock 37 → 36; receptor CUIT/RI y plan A sin CAE |
| Vendedor desktop | FM-LOC-0004, una venta con solicitud fiscal; stock 44 → 43; recibo pendiente, detalle sin Editar/Anular |
| Vendedor mobile | FM-LOC-0005 sin solicitud fiscal, doble tap con una venta; stock 43 → 42; detalle comercial y anulación anidada |
| Diálogos mobile | Modal superior visible, IDs sin duplicados, un Escape cierra sólo el superior, devuelve foco a Anular y mantiene bloqueo del fondo |
| Ecommerce mobile CF | Order `59fd7829-8260-4817-bfe3-23f9ba7f2184`; doble tap, loading, una Sale, un movimiento de stock -1 y una Invoice B pending; pago simulated_approved |
| Ecommerce desktop CUIT/error/retry | Order `7a0e0169-1617-4ace-a164-8d265d942424`; lookup no disponible, Sale/Payment permanecen. Corrección a CF y retry conservan Order/Sale; un movimiento -1, una Invoice B |
| Administración | Estados VALIDATION/REJECTED/UNCERTAIN sembrados y claramente MOCK; temporal/backoff; revisión sin CAE; controles móviles legibles sin overflow horizontal |
| Receptor de vendedor | Formulario explícito: RI/CUIT devuelve dry-run A desktop; CF devuelve dry-run B mobile; autorización real permanece deshabilitada |

[Persistencia de compras UI](evidence/ui-ecommerce-proof.json), [ventas inspeccionadas](evidence/ui-sales-proof.json), [foco/overlays](evidence/mobile-overlay-proof.json), [resultado retry desktop](evidence/desktop-ecommerce-retry-result.png), [estados mobile](evidence/mobile-attention-states.png). Los snapshots comerciales corresponden al momento de cada prueba, no al stock final después de todos los probes. FM-LOC-0001 y 0002 reprodujeron el doble click heredado antes del fix: no se presentan como éxito.

Los ocho casos HTTP finales también prueban Auth ausente 401, seller 403, capability admin local, bloqueo de pago inventado desde checkout, total recalculado, dos approvals concurrentes con una Sale/Invoice, descuento único, replay, key/contenido distinto conflict, bloqueo de alias y retry después de error fiscal sin rollback. [Resultados HTTP](evidence/http-results.json).

Los cinco casos REST fiscales utilizan el motor y las transacciones reales contra Emulator con mock WSFE: tres orígenes, terminal y mirror; timeout con reserva que bloquea otra Invoice, consulta exacta que libera; gates reales de Netlify Dev cerrados. La prueba adicional lanza dos procesos independientes, registra un único request mock y la Invoice/mirror únicos. [Integración](evidence/fiscal-integration-proof.json), [dos procesos](evidence/two-worker-proof.json).

## Comparación contra base

| Hallazgo | Clasificación / evidencia |
|---|---|
| SDK podía alterar venta facturada y mirror | PREEXISTING FAILURE; reproducido en base para admin y seller, denegado con reglas nuevas |
| Lease vencido ignoraba incertidumbre fiscal | PREEXISTING FAILURE; base adquiría lock, reserva durable actual bloquea |
| Retry de Invoice Ecommerce tras sync autorizado | PREEXISTING FAILURE; base falla con arca-invoice-not-requested, actual reutiliza terminal |
| Provider de catálogo, doble click, disabled/loading y overlays | PREEXISTING FAILURE; código base conservado y reproducción UI, corregidos sin debilitar el backend |
| Cinco alertas npm por gRPC | PREEXISTING FAILURE; lockfile base retenía 1.9.16; override 1.13.6 y audit final cero |
| Stale worker podía afectar un nuevo claim y reconcile de rechazadas | NEW REGRESSION intermedia de Etapa 7, detectada y corregida; tests dedicados; la base bloqueaba rejected |
| Suites finales | Sin NEW REGRESSION conocida; 429/111/8/5/1 en verde |

[Comparación reproducible](evidence/base-comparison.json), [base 380/380](evidence/baseline-tests.log). No se atribuyen los fallos originales del checkpoint Etapa 4 al trabajo de Etapa 7; esta base ya incorpora las correcciones de Etapa 6.

## Matriz final

PASS significa evidencia **local**, con mocks/dry-run donde se indica. BUILD acredita compilación, no servicio real. NOT VERIFIED conserva el límite práctico de la evidencia.

| Área | LOCAL | TESTS | BUILD | ESTADO |
|---|---|---|---|---|
| Venta Rápida | PASS | PASS | PASS | PASS, sin CAE |
| Panel Vendedor | PASS | PASS | PASS | PASS, receptor y solicitud pendiente |
| Ecommerce | PASS | PASS | PASS | PASS, simulation/dry-run |
| CUIT / padrón | NOT VERIFIED | PASS | PASS | NOT VERIFIED, mock y fallo seguro probados; lookup real pendiente |
| Consumidor Final | PASS | PASS | PASS | PASS local; umbral real debe configurarse |
| Factura A | PASS | PASS | PASS | PASS mock/dry-run |
| Factura B | PASS | PASS | PASS | PASS mock/dry-run |
| PDF | PASS | PASS | PASS | PASS mock, emisor real pendiente |
| QR | PASS | PASS | PASS | PASS, seis QR mock decodificados |
| invoice ↔ sale | PASS | PASS | PASS | PASS, REST Emulator |
| Idempotencia | PASS | PASS | PASS | PASS |
| Sequence lock | PASS | PASS | PASS | PASS, reserva durable |
| Retry | PASS | PASS | PASS | PASS, control limitado; sin scheduler |
| Reconciliación | PASS | PASS | PASS | PASS mock; WSFE real NOT VERIFIED |
| Firestore | PASS | PASS | PASS | PASS, Emulator |
| Secret safety | PASS | PASS | PASS | PASS del alcance escaneado/revisado |

## Matriz por origen

READY se limita a comportamiento local verificado. No habilita gates ni acredita facturación productiva.

| Origen | Crear venta | Crear Invoice | Receiver | Authorization | Verification | PDF | Retry | Persistencia | Estado |
|---|---|---|---|---|---|---|---|---|---|
| admin_quick_sale | READY | READY | READY local | READY mock | READY mock | READY mock | READY local | READY Emulator | READY local / NOT VERIFIED real |
| seller_sale | READY | READY | READY, formulario admin | READY mock | READY mock | READY mock | READY local | READY Emulator | READY local / NOT VERIFIED real |
| ecommerce | READY, simulation | READY | READY local | READY mock/dry-run | READY mock | READY mock | READY local | READY Emulator | READY local / NOT READY pago real |

**Gates efectivos del checkpoint:** los tres orígenes tienen CAE real bloqueado. La allowlist automática productiva conservada contiene sólo admin_quick_sale; seller_sale y ecommerce no se habilitaron. Estar READY en un mock no significa estar autorizado en producción.

## Unverified items y pendientes heredados del prompt original

- WSAA real: alta/permiso del servicio, ticket real y operación independiente. Pares de claves válidos localmente no lo demuestran.
- Padrón real con CUIT y WSFE real: permisos, respuesta efectiva, POS habilitado y numeración real. No se ejecutó FECAESolicitar real, ni homologación real de emisión.
- Configuración fiscal efectiva: CUIT/condición del emisor, POS, datos legales del PDF, umbral CF vigente y política para reparar registros legacy/VALIDATION/REJECTED. No se ofrece un editor arbitrario de snapshots fiscales ni un reset de numeración.
- Payway no integrado; webhook, firma/validación, reconciliación y webhook duplicado pendientes. simulation/simulated_approved permanece separado de payway/approved.
- Ecommerce y seller_sale no están en allowlist productiva permanente. Emitir un CAE real exige autorización posterior inequívoca para una venta e importe exactos, con gates temporales y reconciliación ante timeout.
- ECOMMERCE_LOCATION_ID y configuración comercial reales, entrega/retiro/tarifas: diferidos por indicación del usuario. QA usa únicamente qa-local ficticio. No se inventaron datos del establecimiento.
- Desktop/mobile en Chrome local completados; dispositivos físicos y Safari no verificados.
- Scheduler automático de retry no implementado. El modelo limitado y el retry seguro están probados; no se despliega un worker fiscal desatendido con los gates cerrados.
- Comportamiento del bundle/configuración en Netlify remoto: **PENDIENTE PARA DEPLOY PREVIEW FINAL**. No se ejecutó Preview. Debe continuar sin emisión real ni flag de simulación productivo.
- No hay comandos de tests o builds locales obligatorios pendientes. Sí quedan las verificaciones reales anteriores; su falta impide declarar preparación global de release.

## Continuación local reproducible

Leer primero este informe y [PROMPT DE CHECKPOINT — ETAPA 7 FINAL LOCAL](PROMPT-DE-CHECKPOINT-ETAPA7-FINAL-LOCAL.md). El código se conserva en la rama **local** codex/fiscal-stage7-final-local; no asumir que GitHub contiene ese commit. En este repo, `git worktree add --detach ../FM-Fiscal-Etapa7-Checkpoint 56d1e8ab6beb28246494dcf40c5270e3d99901ae` evita mezclar cambios del usuario.

Los [fixtures de QA](qa-fixtures/) se copian a `.netlify/stage7-qa`, que debe estar ignorado. No usar directamente el guard desde docs: allí sus imports relativos no corresponden y sus outputs no deben quedar versionados. Copiar `firestore.rules` del código auditado junto a `firebase.json`. Para cada rerun usar keys nuevas QA_HTTP_KEY/QA_FISCAL_KEY/QA_WORKER_KEY. `seed.mjs` genera usuarios, stock y tokens únicamente en Emulator; auth-fixtures.json nunca se agrega a Git.

La evidencia muestra que el patch local resuelve la recuperación y las regresiones encontradas. Se conserva el estado **NO LISTO PARA PREPARAR RELEASE / CHECKPOINT PARCIAL — REQUIERE VALIDACIÓN MANUAL** hasta validar los pendientes reales de configuración y servicios. Este informe no autoriza ni realiza release, deploy, preview, push ni CAE.
