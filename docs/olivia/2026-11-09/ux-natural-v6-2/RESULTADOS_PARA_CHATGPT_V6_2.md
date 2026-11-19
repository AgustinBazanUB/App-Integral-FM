# Olivia V6.2 — resultado para revisión posterior

**Candidata parcial, no aprobada para producción.** [Preview 58](https://deploy-preview-58--appintegralflormia.netlify.app/gestion/settings), [PR 58 draft](https://github.com/AgustinBazanUB/App-Integral-FM/pull/58). Código final: `5de043ef6f7e605fd8d0d209be6daed425b7c29d`. El commit documental posterior no cambia la aplicación.

## Resultado demostrable

Se separó hidratación de inferencia, habilitó borrador inmediato, agregó indicador CSS de conexión, permitió texto durante conexión y separó Developer mediante menú. Se introdujo recopilación nativa no verificada de stock/productos, sin otro clasificador ni proveedor. Se conservaron permisos, motor Luna, cola y confirmaciones existentes.

La auditoría real detectó y corrigió preguntas seguras descartadas por «Tomado», restauración de borradores por ASR tardío, mezcla entre tareas independientes, persistencia del borrador anterior al cambiar de tema, ubicación «qué local» interpretada como un lugar y tareas deterministas incompletas que se marcaban completadas. La última regresión dejó el producto en needs-input por abreviación/precio, en la misma tarea correcta.

1164 tests aprobaron, build correcto; advertencia de chunks grandes existente. No se confunde eso con aprobación funcional.

## Métricas

36 aperturas previas, 30 posteriores. Nueva conversación: P50 1273,9 → 973,3 ms; P95 2461,1 → 1058,2. Reapertura caliente: P50 58,2 → 58,5; P95 572,0 → 988,9. Cero estados falsos de procesamiento posteriores. Objetivos de apertura no cumplidos; no hay mejora global de la cola caliente.

Ocho turnos sociales directos: P50 1482,6 ms, P90/P95/máximo 1949,6, promedio 1548,3; cero delegaciones. Son fin del estímulo virtual a primer PCM programado, no audio físico. No se usa una muestra de ocho para certificar percentiles generales.

Cincuenta entradas de audio: 48 habladas y dos ruidos de control. 45 habladas con reloj estable, tres inválidas por recuperación/suspensión. 44 con turnComplete; 29 IDs con algún PCM programado, incluyendo casos interrumpidos o de atribución ambigua. No afirmar 37 respuestas acústicas completas.

Lista N20-B: veinte elementos ficticios completos, 80 bloques recibidos/programados, misma longitud, diferencia int16 máxima 1, ASR local independiente sobre ambos. Una repetición exitosa; estabilidad 20/20 todavía no aprobada. N20-A parcial y N10 con entrada retrasada se conservan como inválidos para sus métricas de reconocimiento/latencia.

Ruido de 150 ms no cortó; 500 ms cortó y no reanudó. Interrupción intencional sí cambió de tema. No hubo captura del micrófono físico ni ruido privado de la PC.

## Tareas y costos

Stock y dos consultas coexistieron; Gemini respondió mientras trabajaban. Dos consultas terminaron, stock llegó a confirmación. Otra regresión mantuvo producto, cliente y transferencia en tres IDs distintos. No se confirmó ninguna modificación comercial. No se valida una integración de escritura por haber llamado directamente al backend: las solicitudes comenzaron hablando con Olivia y las inspecciones posteriores fueron de lectura.

Gemini adicional conocido USD 0,284884; Luna/Sol USD 0,0207328. Una nueva medición desconocida por proveedor; no certificar factura total. Reserva final 0, sin sesión activa. Ver COSTOS para separación de estimaciones.

## Pendientes que bloquean aprobación

1. Variantes naturales de recopilación quedan escritas sin audio por la gramática de seguridad. No ampliar el filtro permitiendo hechos comerciales sin validar.
2. Ruido prolongado e interrupción accidental no reanudan automáticamente. No probado con acústica física real.
3. Entrada durante reconexión puede perderse o retrasarse; no reenviar automáticamente instrucciones comerciales ya aceptadas.
4. Repetición estable de veinte y batería completa de respuestas reproducidas, no solo generadas/programadas.
5. Alta de cliente interpretó nombre implícito pese a que el estímulo decía no tenerlo; investigar extracción desde historial. No se creó un cliente ni se autorizó esa inferencia.
6. Un 409 de lectura Firebase interrumpió la voz; una medición Gemini quedó desconocida. Conciliar además el nuevo desconocido Luna del flujo QA.
7. Ciclo físico de permisos, seller real, pausa/reanudar de punta a punta y varias escrituras concurrentes verificadas siguen pendientes.
8. Chunks lazy retirados durante redeploy requieren recargar; no hay recuperación local del panel Developer obsoleto.
9. Después de recargar el chat de QA, algunas respuestas quedaron antes de sus mensajes de usuario. Orden del historial pendiente de diagnóstico y corrección.

## Git y seguridad de entorno

Rama `codex/olivia-ux-natural-v6-2`, origin/main inicial `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`, V6 heredada `400b4a0b4e90a5f9116fa8a2a65d7e5c7ac6716b`. Se preservaron las otras ramas/worktrees. PR abierto en draft; PR 57 no se fusionó ni cerró. El PR 58 incluye V6 y V6.2.

Frontend, Auth, Functions y Firestore de pruebas verificados. Producción no se alteró; no se desplegaron reglas/índices ni se migraron documentos. Registros QA conservados. La revisión visual y una autorización específica futura siguen siendo necesarias para integrar a main; continuar o pasar CI no sustituye esa autorización.

Los otros siete entregables y evidencia sanitizada están en este directorio. El manifiesto identifica capturas, PCM y scripts privados por hash. No reiniciar el baseline de costos si se continúa la auditoría.

## Commits de implementación

| Commit | Cambio |
|---|---|
| 47337d9 | Hidratación, interfaz, costos y recopilación contextual |
| f5c19b5 | Acuse seguro Tomado |
| 418ffc8 | Revisiones ante ASR tardío |
| 5d0dbcd | Pedidos nuevos con tarea independiente |
| c4f204b | Reemplazo persistido del borrador y ubicación desconocida |
| 81e3df6 | Alta determinista queda needs-input |
| 5de043e | Ancho móvil dentro del dispositivo |

CI y Netlify del código final aprobaron. Se cerró la captura virtual, se liberó la reserva, se restauraron las emulaciones y la preferencia Developer del preview anterior, y se detuvo el servidor Vite propio. El preview nuevo queda abierto con voz apagada. Se reutilizó la sesión autenticada de staging para entrar al nuevo origen; no se cambiaron credenciales ni permisos.
