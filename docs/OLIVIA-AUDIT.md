# Auditoría de la base PR 31

Base inspeccionada: `codex/olivia-integration`, PR 31, commit `12447682e2a24afd4b847f4a96af50b7d6363ac5`. Trabajo derivado: `codex/olivia-evolution`. Este documento consolida las observaciones sobre esa base; no atribuye a la base funcionalidades añadidas durante la evolución.

| Elemento de la base | Clasificación | Evidencia y decisión |
|---|---|---|
| Sesión/perfil/permisos | EXISTE / REUTILIZABLE | `http`, `guards`, `permissions`, reglas Firestore; conservar autoridad backend |
| Texto | EXISTE | `client` → endpoint → engine → Responses; completar con SSE |
| Engine | DEBE REFACTORIZARSE | 1.103 líneas de coordinación, almacenamiento y llamadas; extraer conversaciones/ejecución/dominios |
| Assistant | DEBE REFACTORIZARSE | 373 líneas de UI y recursos; separar composer, voz, consumo y observabilidad |
| Dictado | PARCIAL | Captura y transcripción existentes; faltaban waveform real y SEND directo |
| Realtime/WebRTC | EXISTE / PARCIAL | Track mute disponible técnicamente; faltaban control visible, contexto escrito y herramientas nativas |
| Streaming | FALTA | Respuesta textual completa al terminar; añadir transporte incremental y persistencia final |
| Adjuntos de chat | FALTA | Añadir endpoint, ownership, límite, validación, proveedor y chips |
| Historial/conversaciones | EXISTE / REUTILIZABLE | Cache y subcolección paginada, retención; preservar y añadir memoria/alcance de permisos |
| Cuotas/costos/pricing | EXISTE / REUTILIZABLE | Reservas, medición, ARS y FX trazable; preservar cargos desconocidos como desconocidos |
| Confirmaciones/idempotencia | EXISTE / REUTILIZABLE | Credenciales opacas, transacción, huella, auditoría; extender a nuevas operaciones |
| Catálogo tools | PARCIAL | Herramientas de panel/stock/venta/navegación; ampliar por módulos reales y selección |
| `oliviaKnowledge` | PARCIAL / REUTILIZABLE | Fragmentos curados por keywords; mantener fallback y añadir biblioteca semántica |
| Skills versionadas | FALTA | Añadir catálogo, carga dinámica y procesos auditables |
| Forecast ferias | FALTA | Añadir heurística con hechos vivos, escenarios y stock/transferencia |
| Dominio de ventas/CRM | EXISTE / REUTILIZABLE | `operationalWritePlans`, `saleWritePlan`, `customerDomain`, promociones y pagos; no alterar semántica |
| Transferencias manuales | EXISTE / DEBE REFACTORIZARSE | `inventoryService` valida líneas y efectos físicos; extraer plan compartido |
| Catálogo/ubicaciones/registros | EXISTE / REUTILIZABLE | `productService`, `locationManagementService`, `managementService`; compartir planes y conservar campos |
| Finanzas/ARCA | EXISTE / REUTILIZABLE | `financeDomain`, `financeService`, `arcaService`, backend fiscal; lectura viva y revisión en flujo existente |
| Ecommerce/social/marketing | EXISTE / REUTILIZABLE | `orders`, `campaigns`, `whatsappCampaigns`, `metaCampaignProjects`, módulos existentes; no publicar por chat |
| Rules/indexes | EXISTE / EXTENDER | Olivia es solo backend; añadir colecciones protegidas e índice de movimientos por depósito |
| Pruebas/documentación | EXISTE / EXTENDER | 634 pruebas Node iniciales aprobadas; docs previas inspeccionadas y actualizadas |

La ruta inicial de voz transcribía, llamaba al chat Responses y volvía a Realtime para hablar. El modo nativo ahora devuelve herramientas directamente a Realtime sin otorgarle autoridad de escritura. Las lecturas antes secuenciales pueden ejecutarse en grupos de tres; preparaciones siguen formando barreras.

El montaje autenticado y su barrera de errores permanecen. La operación manual conserva sus servicios y funciona sin Olivia. La extracción de planes reutiliza validaciones comerciales, no crea una segunda implementación del negocio.

No se hicieron cambios ni pruebas comerciales en producción. Los cambios de reglas/índices se entregan versionados y verificados en emulador; no se desplegaron al Firebase empresarial. La draft preview despliega código en Netlify, conserva autenticación y no reemplaza esa política.
