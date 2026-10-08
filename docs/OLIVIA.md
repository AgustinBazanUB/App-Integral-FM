# Olivia en el Sistema Integral Flor Mía

Actualización del 5 de octubre de 2026: el [anexo de modelos y tareas](OLIVIA-MODEL-ROUTER.md) y su [matriz de 52 secciones](OLIVIA-ANNEX-REQUIREMENTS.md) definen la política vigente: Luna HIGH/XHIGH, Sol solo creativo en módulos autorizados y GPT-Live con delegación al mismo backend de texto.

Olivia es una capa conversacional autenticada de Gestión y Panel Vendedor. La evolución parte de PR 31 y conserva operación manual, historial, costos, cuotas, permisos, auditoría y confirmaciones existentes.

## Experiencia

El composer permite escribir, adjuntar archivos/imágenes, dictar o iniciar conversación. El mensaje aparece inmediatamente y SSE presenta fases y texto progresivo; se puede detener y recuperar el chat. Los adjuntos muestran carga, error, nombre, tipo y miniaturas. Dictado tiene barras de volumen reales, duración, cancelar, STOP para revisar y SEND para transcribir/enviar.

Voz usa Realtime/WebRTC con herramientas backend nativas, transcripciones persistentes, interrupción y reconexión. Mute conserva la sesión y permite escribir; la respuesta textual verificada se comparte con el contexto de voz. El modelo no puede ejecutar una operación diciendo sí: las mutaciones requieren tarjeta visual.

En móvil se consideran visualViewport, safe areas, texto de 16 px, expansión del textarea, scroll y controles con poco espacio vertical. El consumo/costo es desplegable en modo compacto. Los detalles técnicos solo aparecen en modo desarrollador administrativo.

## Capacidades

| Área | Administrador autorizado | Vendedor |
|---|---|---|
| Texto, adjuntos, dictado y voz | Sí | Sí |
| Stock/precios/promociones | Según permiso | Ubicaciones permitidas |
| Venta y ventas de hoy | Según permiso | Venta y ventas propias |
| Métricas y análisis histórico | Sí, según módulo | No ofrece herramientas administrativas |
| Feria, stock recomendado y transferencia | Heurística con datos vivos y confirmación | No |
| CRM/finanzas/ubicaciones/depósitos | Lecturas y preparaciones específicas | Flujos permitidos del Panel Vendedor |
| Ecommerce/social/marketing/envíos/alertas/proveedores | Catálogo explícito por módulo | No |
| Fiscal/roles/configuración | Revisión en el flujo manual seguro | No |
| Biblioteca permanente/IA/supervisión | Administración | Consulta de ayuda autorizada |

## Seguridad y operación

La sesión se verifica con Firebase; perfil y permisos se releen server-side. Pantalla aporta IDs y filtros acotados, no autoridad. Herramientas y Skills son explícitas y seleccionadas por intención/rol. No existe acceso arbitrario a Firestore.

Propuestas tienen huella de datos y vencimiento de cinco minutos. Confirmar revalida dentro de una transacción, escribiendo efectos comerciales, movimientos, auditoría y resultado una vez. Precios, promociones, identidad CRM, stock negativo permitido de ubicaciones y prohibición en depósitos conservan el dominio manual. El pronóstico nunca acredita recepción física.

Datos, archivos y conocimiento se tratan como contexto no confiable. Todas las colecciones Olivia rechazan acceso directo del cliente. OpenAI/Firebase Admin permanecen server-side. La biblioteca se publica y retira mediante confirmación administrativa separada de los adjuntos temporales.

## Costos, cuotas e historial

Administradores mantienen uso sin cupo de tokens; controles de sesión/concurrencia/duración permanecen. Vendedores conservan cupos diarios/semanales/mensuales, renovación argentina, ampliación temporal y solicitud de extensión. Reservas y deduplicación evitan consumo duplicado.

La vista común muestra ARS estimados y costo guardado de última llamada. Conversión utiliza referencia con fuente/fecha y factor 1,05; no se recalcula una llamada anterior con otra cotización. Sin medición/tarifa/cotización se informa falta de datos, nunca cero ficticio. Audio, archivos y almacenamiento semántico no se presentan como cargos textuales completamente medidos. El estimado escrito no llama al proveedor.

Retención configurable de 1–12 meses. Cache de hasta 40 mensajes y 18.000 caracteres; modelo recibe 16 recientes, memoria extractiva acotada y borrador. Historial íntegro en subcolección, páginas de 20 chats y 60 mensajes. Reapertura tras nueva autenticación invalida propuestas anteriores; cambios de permisos requieren nuevo contexto. La auditoría comercial se conserva separadamente.

## Documentación técnica

- [Arquitectura](OLIVIA-ARCHITECTURE.md)
- [Herramientas](OLIVIA-TOOLS.md)
- [Skills](OLIVIA-SKILLS.md)
- [Conocimiento permanente](OLIVIA-KNOWLEDGE.md)
- [Adjuntos](OLIVIA-ATTACHMENTS.md)
- [Dictado y voz](OLIVIA-VOICE.md)
- [Pronóstico de ferias](OLIVIA-FORECASTING.md)
- [Seguridad y auditoría](OLIVIA-SECURITY.md)
- [Pruebas y evidencias](OLIVIA-TESTING.md)
- [Auditoría de la base](OLIVIA-AUDIT.md)
- [Matriz completa de requisitos](OLIVIA-REQUIREMENTS.md)

## Referencias de integración

- [Responses y function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Archivos de entrada](https://developers.openai.com/api/docs/guides/file-inputs)
- [Files y expiración](https://developers.openai.com/api/reference/resources/files/methods/create)
- [Retrieval y filtros](https://developers.openai.com/api/docs/guides/retrieval)
- [Realtime y herramientas](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Eventos Realtime](https://developers.openai.com/api/reference/resources/realtime/client-events)
- [Netlify Functions](https://docs.netlify.com/build/functions/api/)
