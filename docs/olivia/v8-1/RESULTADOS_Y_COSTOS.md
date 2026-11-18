# Resultados y costos — Olivia V8.1

**Fecha:** 2026-11-10. Los resultados de esta tabla corresponden a esta rama, no a informes previos del V8.

## Verificaciones locales

| Verificación | Resultado | Evidencia / límite |
|---|---|---|
| `npm test` | PASS — 1.197/1.197 | Incluye pruebas de foco, correcciones, lectura independiente, respuesta obsoleta, carga por depósito y confirmación de motor. |
| `npm run test:rules` | PASS — 140/140 | Firebase Emulator Suite local, proyecto `app-integral-fm-pruebas`, Firestore en puerto 8280; sin conexión a Firestore remoto. |
| `npm run build` | PASS | Vite produjo la aplicación. Aviso no fatal de bundle principal >500 kB. |
| `git diff --check` | PASS | Sin errores de whitespace. |
| npm audit (instalación bloqueada por lockfile) | 0 vulnerabilidades reportadas | `npm ci`; 338 paquetes instalados/auditados. |

## Rutas, latencia y costo

La implementación mantiene `DIRECT`, `FAST_READ` y `TASK`. Los tests automáticos no hacen una sesión real contra Gemini ni producen evidencia acústica y por eso no se usan para calcular latencias o costos de proveedor. La sección de costos de voz se completará con valores visibles/registrados en el preview V8.1 cuando se ejecuten los turnos manuales; no se extrapolan las mediciones que los documentos V8 anteriores atribuyen a otra versión.

No se realizaron pruebas de envío, cobros, facturación ni datos reales de producción. Las pruebas de modificación de inventario solo se harán con registros sintéticos y después de verificar frontend, Functions, Auth y Firestore del preview.
