# Cierre correctivo de Etapa 2 — 30/09/2026

## Alcance y veredicto

**CHECKPOINT APROBADO para el código de Etapa 2 y la entrega de homologación**, con los límites operativos descritos abajo. La auditoría anterior permanece como evidencia histórica en `arca-stage2-checkpoint.md`; no se presenta el commit original como aprobado.

Base remota previa: `41f0c2b776fbd2a280c3bddf98adefe1affef5c5`. Original Etapa 1: `735478e3be28911978d22257da88e3fe7d1eeee1`. Original Etapa 2: `2909605b4d87f1fdc93529ed1d4f9d5af9943e0d`, parent 735478e. Correctivo previo de Etapa 2: `654a3ddc0de4d30a9a6d995376e898c7c59bebf9`.

Se integra el correctivo de Etapa 1 `6c196097ac88b3ead425ed1cf571cf0899777626` como `d614761`, preservando las rules estrictas de Etapa 2. Se trabaja en clon aislado y rama local `codex/arca-stage2-close`, preservando los cambios del clon original. El usuario autorizó después la publicación de este cierre en Netlify; esa autorización sucede después del checkpoint original sin deploy.

## Correcciones del cierre

1. Integra validación de PV 1..99999, clave de caché de 32 bytes, readiness sin secretos, separación WSAA/WSFE, errores funcionales de PV y finalización honesta del estado de carga.
2. Gate de red deshabilitado y ticket vigente perdido se clasifican como configuración, no caída temporal.
3. Proyección explícita de resultados exitosos de autorización/reconciliación/verificación: no se devuelve el documento Firestore entero ni errores históricos arbitrarios. Conserva estados, numeración/CAE fiscales, importes, identificación y bloqueos definidos. Los mensajes remotos conservan código numérico y texto estático. Se aplica también a resultados de verificación automática, receptor de metadata y errores de diagnóstico/PV.
4. El authorizer persiste errores/observaciones nuevos saneados, sin texto remoto arbitrario. No modifica claims, CAS, IDs determinísticos, sequence lock, numeración, FECompConsultar, reconciliación ni política de reintento.
5. Reordena la misma alternativa de permisos de movimientos de Venta Rápida para evitar la matriz de roles ajena y el límite de 1000 expresiones. Mantiene las mismas alternativas de acceso; no relaja reglas fiscales.
6. Ajusta una prueba heredada de Etapa 1 que aceptaba `invoiceStatus=pending` al contrato estricto de Etapa 2: ahora exige DENY y comprueba por separado la creación comercial válida. No se eliminan pruebas.
7. Mensaje específico para umbral de Consumidor Final ausente y dependencia inyectable del diálogo para QA sin backend. Las respuestas obsoletas siguen invalidadas.
8. Scripts portables de pruebas/emulador y diagnóstico local; exclusión reforzada de credenciales en gitignore; documentación para otra PC. Preview QA fuera de las rutas/build publicados.
9. Parches transitivos de `@grpc/grpc-js` 1.13.6 y `nanoid` 3.3.18 con overrides explícitos y lockfile, sin downgrade/major de Firebase ni `npm audit fix --force`. Avisos oficiales: [gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j), [Nano ID](https://github.com/advisories/GHSA-2v37-7h3g-55p8).

## Evidencia ejecutada

| Comando/comprobación | Resultado |
|---|---|
| `npm ci` | PASS, 164 paquetes; 0 vulnerabilidades |
| `npm run test:arca` | 122 tests, 122 PASS, 0 FAIL, 0 SKIP; transporte real bloqueado |
| Misma suite con Node 20 | 122 PASS, 0 FAIL, 0 SKIP |
| `npm run test:rules:fiscal` | 8 PASS, 0 FAIL; incluye cache, locks, espejos y borrados |
| Emulador + `npm run test:rules` | 53 PASS, 0 FAIL en las cinco suites de reglas |
| Suite comercial central | 23 PASS; registro/anulación atómicos ya no fallan |
| `npm run build` | PASS; permanece advertencia previa de tamaño de chunk |
| Parse JSX explícito del diálogo y SettingsPage | PASS |
| `git diff --check` | PASS |
| Netlify Dev, handler real con upstream de autenticación simulado | 7/7 HTTP PASS: 405, 401, CF 200, >= umbral 422, CUIT inválida 400, falta configuración 409 |
| UI real del diálogo, fixtures | Desktop PASS; 375 y 430 px PASS, sin desborde; confirmación sin emisión, Escape y retorno de foco |
| Netlify Dev con sesión Firebase real y archivos locales existentes | Configuración renderizada; certificado/PV3/WSAA/WSFE/Firebase Admin listos |
| Function real `arca-receiver` con sesión real | CF devuelve faltante explícito de umbral; CUIT oficial devuelve ticket vigente perdido, sin reflexión de secretos |
| `npm audit --json` después del parche | 0 vulnerabilidades |

En Node 24 el filtro del emulador omite los casos no seleccionados sin contarlos como skips. Se ejecutó además la suite completa de rules para evitar una aprobación parcial por filtro.

## Seguridad

Los tres gates productivos conservan sus valores; `.env.example`: false/false/false. Allowlist: `admin_quick_sale`. AUTO no habilita la autorización manual sin venta objetivo. Los tests siguen cubriendo idempotencia, asociación invoice ↔ sale, CAS, bloqueo de secuencia, estados, recuperación pre-CAE y FECompConsultar. No se habilita CAE de homologación ni productivo.

Pruebas unitarias con red real bloqueada; pruebas runtime con upstream simulado; diagnóstico real sólo lectura protegido por guardia local. **CAE productivos generados durante este cierre: 0.** No se envió FECAESolicitar real ni se crearon facturas durante la validación. Los CAE visibles en Configuración son históricos, no generados por el checkpoint.

Rules verificadas en emulador: invoices no mutables por navegador; tickets y locks no legibles/escribibles; los 12 campos fiscales del espejo de ventas rechazan create/update/deleteField, incluyendo nested updates. Modificación comercial legítima permitida.

## Límites que no se presentan como aprobados

- El entorno real de homologación carece de condición IVA/datos visibles del emisor y umbral de CF. No se inventaron esos valores. Por ello `NO OPERATIVO` es correcto; cerrar Etapa 2 no declara readiness productivo.
- Padrón con credenciales reales no completó el lookup exitoso en la nueva instancia: WSAA ya tiene un ticket vigente que ésta no conserva. Se verificó la respuesta controlada y su clasificación; no se acredita un lookup real exitoso en este cierre.
- No se publican rules al Firebase compartido en un deploy de Netlify. Publicarlas aisladamente rompería clientes productivos anteriores que crean `invoiceStatus`. Se requiere futura entrega coordinada de cliente y rules. Este cierre acredita las rules versionadas y probadas, no un cambio de la política ya desplegada en Firebase.
- Suite general: 343 tests, 338 PASS y 5 FAIL ajenos a ARCA. Los mismos cinco fallan en base 735478e (suite focalizada: 25/30). Son assertions estáticas de `global-overlay-focus` (cierres inline), `location-enhancements` (stock/navegación, alcance local, agrupación) y `seller-panel` (clases responsive). Sus fuentes no se modifican en este cierre; no se borraron ni relajaron tests para ocultarlos.
- No se evaluó toda la actividad externa histórica de ARCA ni consumo global de créditos. Publicar esta entrega sí consume el build/deploy autorizado por el usuario.

## Continuidad

Pasos ejecutables, rutas reemplazables, controles seguros y restricciones de publicación en [arca-local-another-pc.md](arca-local-another-pc.md). Integrar el receptor definitivamente a los flujos de venta y definir la identificación CF por encima del umbral quedan para la etapa siguiente, sin ampliar la allowlist.

## Publicación

La evidencia de SHA, deploy y URL se completa tras confirmar el estado Published. Proyecto destino exclusivo: `flor-mia-arca-homologacion`. Main y el proyecto productivo permanecen intactos. Se restablece la pausa de builds al terminar para seguir desarrollando localmente sin nuevos deploys automáticos.
