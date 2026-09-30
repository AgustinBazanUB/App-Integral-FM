> Informe histórico de la auditoría inicial. El cierre posterior autorizado por el usuario está en [arca-stage2-close.md](arca-stage2-close.md).

# Auditoría local de Etapa 2 ARCA — 30/09/2026

## Veredicto

**CHECKPOINT NO APROBADO.** Los fallos directamente causados por Etapa 2 fueron corregidos localmente. Persisten fallos heredados demostrados; no se amplió el alcance para corregirlos ni se alteraron tests para ocultarlos.

## Integridad y entorno

- Commit exacto auditado: `2909605b4d87f1fdc93529ed1d4f9d5af9943e0d`.
- Parent único: `735478e3be28911978d22257da88e3fe7d1eeee1`.
- El diff original contiene exactamente los 18 archivos previstos; `git diff --check` pasa.
- Repo GitHub: `AgustinBazanUB/App-Integral-FM`; rama remota permanece en `41f0c2b776fbd2a280c3bddf98adefe1affef5c5`.
- Se preservaron los cuatro cambios locales preexistentes del clon original. La auditoría usa un clon separado detached.

## Correcciones propias de esta etapa

1. `publicError`: códigos sólo del catálogo, incluso cuando un SOAP Fault trae un código arbitrario; normalización de namespace seguida de allowlist exacta. Sin reflejar mensajes, detalles, causas o stack remotos.
2. Clasificación explícita de timeout, gates de red, caché WSAA y errores conocidos de certificado/firma/autorización del servicio.
3. Rechazo de totales vacíos, booleanos, arrays y objetos antes de convertir a número. Sin default fiscal de threshold.
4. Diálogo: controles deshabilitados durante consulta y guard versionado. Cambiar total/origen, cerrar o iniciar otra consulta invalida respuestas/errores anteriores. La confirmación es local y no solicita CAE.
5. Venta Rápida: elimina el campo cliente `invoiceStatus`, incompatible con las nuevas reglas. No se permite crear ese campo, ni siquiera con `pending`; la sincronización fiscal server-side existente conserva su responsabilidad.
6. Regresiones de dominio, errores públicos, los cinco endpoints y respuestas asíncronas; reglas probadas para todos los campos fiscales, incluyendo nested update y deleteField.

## Evidencia

| Comprobación | Resultado |
|---|---|
| `npm ci` | PASS, sin cambios de dependencias o lockfile |
| Suite original Etapa 2 | 85/85 PASS antes de corregir |
| Reproducciones iniciales agregadas | 4 PASS / 6 FAIL antes de corregir |
| `node --test tests/arca*.test.mjs` corregido | 97/97 PASS; 0 fail/skip |
| Suite con Node 20 | 97/97 PASS; 0 fail/skip |
| Firestore filtro `facturas fiscales\|caché WSAA` | 7/7 PASS; 0 fail/skip; incluye locks y delete de invoice/ticket/lock |
| Firestore completo corregido | 20/22 PASS; dos fallos heredados |
| Firestore completo en parent `735478e` | 16/18 PASS; mismos dos fallos heredados |
| `npm run build` | PASS; advertencia previa de tamaño de bundle |
| `FiscalInvoiceDialog` mediante `transformWithEsbuild` | PASS; el build por sí solo no prueba este módulo sin ruta |
| Netlify Dev offline, puerto local 8893 | Function real cargada; 7/7 comprobaciones HTTP PASS |
| Desktop 1280; móviles 375 y 430 | PASS: sin overflow, revisión legible, confirmación, foco y Escape |

El runtime local utiliza upstream Firebase Auth/perfil **simulado**, umbral sintético explícito de 1000 y transporte externo bloqueado. Se ejecuta el handler real de Netlify, incluyendo su resolver y adaptador real: Consumidor Final no consulta Padrón; CUIT inválida falla antes; CUIT válida sin configuración devuelve CONFIGURATION_ERROR. No prueba credenciales reales ni el éxito de una consulta Padrón real dentro de ese runtime.

El harness visual usa el componente y los estilos reales con el servicio simulado. Se guardó fuera del repositorio y se eliminó tras la validación. La carrera se reprodujo antes del fix: modo CUIT con revisión Consumidor Final y confirmación habilitada. Después, cambiar el total invalida la respuesta pendiente y mantiene confirmación deshabilitada. El cierre devuelve foco al botón que abrió el modal.

## Fallos heredados que impiden el cierre

- Readiness acepta PV fuera del rango, considera válida una clave cifrada WSAA inválida, anuncia emisión sin alcance manual/automático y confunde gate de red con indisponibilidad. Cuatro probes fallan tanto aquí como en `735478e`.
- El correctivo previo de Etapa 1 `6c196097...` no es un ancestro de este trabajo y no se incorporó silenciosamente.
- `arca-authorize`, en dry-run con una solicitud `reconciling`, devuelve el documento invoice completo, incluido `error.message` persistido. Un sentinel sensible llega a la respuesta HTTP 200. Se reprodujo sin red, sin writes y sin CAE tanto aquí como en el parent. El catálogo nuevo no sanea esta vía de resultado exitoso heredada.
- Venta/anulación atómicas en la suite general exceden el límite de 1000 expresiones de Firestore. Se clasifican PREEXISTING FAILURE; no se corrigieron.

## Seguridad y límites

- Gates PREPARE/CAE/AUTO permanecen false en `.env.example`; allowlist `admin_quick_sale` sin seller_sale/ecommerce.
- Authorizer, invoice ID, asociación invoice↔sale, sequence lock, estados y reconciliación no se modificaron; sus tests pasan con stubs.
- Invoices sin write cliente; tickets y locks sin read/write cliente; todos los campos fiscales espejo de sales reservados al backend. Rules sólo aplicadas en demo.
- El patch original se escaneó sin imprimir valores: referencias documentales/código, sin valores de las claves/certificado locales; patch temporal eliminado.
- Suites ARCA con fetch/socket bloqueados, cero intentos de transporte externo en la evidencia. Runtime aislado bloqueó una consulta auxiliar a edge.netlify.com; no hubo acción de deploy.
- CAE PRODUCTIVOS GENERADOS DURANTE ESTE CHECKPOINT: 0.
- NETLIFY DEPLOYS REALIZADOS: 0. NETLIFY DEPLOY PREVIEWS REALIZADOS: 0.
- Consumo global de créditos Netlify: NO VERIFICABLE DESDE ESTE ENTORNO.

## Repetición

```bash
npm ci
node --test tests/arca*.test.mjs
npm run build
npx firebase-tools@14.12.0 emulators:exec --only firestore --project demo-flor-mia-integral 'node --test --test-name-pattern="facturas fiscales|caché WSAA" tests/firestore.rules.mjs'
```

La ejecución de Windows usó JDK 21 portable y runner externo con exactamente ese filtro para evitar problemas de quoting de cmd.exe. No existe lint/typecheck focalizado configurado.

Para cerrar posteriormente: integrar y auditar en un checkout local las correcciones de Etapa 1, sanear las proyecciones públicas de resultados históricos del authorizer con tests de reflexión y repetir la validación. No habilitar gates, emitir CAE ni publicar ramas/deploys para demostrarlo. El checkpoint presente conserva el FAIL heredado y no constituye aprobación productiva.
