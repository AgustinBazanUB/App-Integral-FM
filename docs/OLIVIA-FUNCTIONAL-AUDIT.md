# Auditoría funcional de Olivia — Flor Mía

Fecha: 4 de octubre de 2026. Fuente documental: carpeta compartida por el usuario y prompt local expresamente referido por él. Este informe audita requisitos; no afirma que cada módulo descrito esté implementado.

## Alcance y trazabilidad

Se listaron recursivamente las carpetas raíz, “1- Estudio Preliminar” y “05_Solucion_Propuesta”. Se recuperaron las 34 versiones funcionales disponibles (PDF, DOCX y documentos nativos), más ambas guías de cuestionario. Los textos y sus metadatos están en el directorio de trabajo `work/documentation`; `structured-sources.json` conserva versiones por ID.

Hay 18 temas/documentos funcionales únicos: cinco documentos 00–04, tres partes A–I, Finanzas, Ecommerce, Envíos, Alertas, Proveedores, Facturación, Actividad/Auditoría y tres documentos de IA. El PDF y el documento nativo de Auditoría son versiones separadas, ambas conservadas. No se encontró otro nivel de carpetas dentro de Solución Propuesta.

La documentación usa “preliminar” como estado del documento, pero distingue decisiones consolidadas dentro de él. “Definido” en esta matriz significa regla expresamente consolidada, no prueba de producción. Las preguntas de las guías son preguntas de relevamiento, no respuestas ni requisitos cerrados. El estudio de situación actual es organizacional y no representa por sí mismo el código actual.

## Fuentes

| Ref. | Tema | Fuente y fecha de relevamiento |
| --- | --- | --- |
| D00 | Índice documental | [00 — Índice](https://drive.google.com/file/d/1tcV1cAQedA3DasAxb1cclkcjqKEECpll/view?usp=drivesdk), 11/09/2026 |
| D01 | Situación actual | [01 — Estudio preliminar](https://drive.google.com/file/d/1Yhs3cgsZffvGjKLCwWlx2jBzoGMJcWo_/view?usp=drivesdk), 11/09/2026 |
| D02 | Objetivos y alcance | [02 — Objetivos](https://drive.google.com/file/d/168G47-aCon0ec54ahqHoWIo1sorUzKNY/view?usp=drivesdk), 11/09/2026 |
| D03 | Actores | [03 — Administrador y Vendedor](https://drive.google.com/file/d/1lRYeJ06YWWNkps1atDyArY-yBslX8ZL5/view?usp=drivesdk), 11/09/2026 |
| D04 | Frontera e integraciones | [04 — Sistemas externos](https://drive.google.com/file/d/1IhjKT9XoEwjnV9VWqPWO2ALxb4-FWyVV/view?usp=drivesdk), 18/09/2026 |
| AC | Productos y Ubicaciones | [Parte 1 A–C](https://drive.google.com/file/d/1TT2CBwml1vuP-LTUvojKOboLwwt_QgmN/view?usp=drivesdk), versión 0.2 |
| DF | Ventas, Venta Rápida y stock | [Parte 2 D–F](https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view?usp=drivesdk), versión 0.2 |
| GI | CRM, Dashboard y Métricas | [Parte 3 G–I](https://drive.google.com/file/d/1V7o_dkOc1mHnIolE3g0U3X1jjhB8TYZz/view?usp=drivesdk), versión 0.1 |
| FIN | Administración Financiera | [Finanzas](https://drive.google.com/file/d/10CXmW-OjeN5lE-ojVVPJte88qmIOKSdG/view?usp=drivesdk), 26/09/2026 |
| EC | Ecommerce | [Ecommerce](https://drive.google.com/file/d/1KEU9m82zisBsRqH-RoDTC0gU-PnPEfgz/view?usp=drivesdk), 28/09/2026 |
| SH | Envíos | [Gestión de Envíos](https://drive.google.com/file/d/1WSAw3VGp4nd_ZZ-ZMqvEtTtdbMrhklqN/view?usp=drivesdk), 30/09/2026 |
| AL | Alertas | [Alertas y Notificaciones](https://drive.google.com/file/d/1M8ck5Vf_IQFmStSHNkCe6B4NDUjfX9d6/view?usp=drivesdk), 30/09/2026 |
| SUP | Proveedores | [Proveedores y Reposición](https://drive.google.com/file/d/1Vw9rJ881O5BV9S5XTq8GpOrV1uOxmMtp/view?usp=drivesdk), 30/09/2026 |
| TAX | Facturación | [Facturación / ARCA](https://drive.google.com/file/d/1_zSA9-4uAQlBnqyEhR1T-Icl8lZV-WQX/view?usp=drivesdk), 30/09/2026 |
| AUD | Actividad / Auditoría | [Auditoría PDF](https://drive.google.com/file/d/1FXs0wdv1SOSVINw6FRK-F8eDsIem_FR1/view?usp=drivesdk), 30/09/2026; [documento nativo](https://docs.google.com/document/d/1ydW3FstADsDrSQoJQuQ1yoJe7zFtS-qQ6c_XwPV2b6U/edit?usp=drivesdk), 29/09/2026 |
| AIA | Asistente Administrador | [IA Administrador](https://docs.google.com/document/d/1Vr_hSAvQ13VQerFBwpkHeG3QYi8eJghU47FT-k5P1Mk/edit?usp=drivesdk), 29/09/2026 |
| AIV | Asistente Vendedor | [IA Panel Vendedor](https://docs.google.com/document/d/1OqRmESCs5Z0lEM2DyeQvjaSez6dYsKk6bHAOGasRN2Q/edit?usp=drivesdk), 29/09/2026 |
| AIC | Configuración IA | [Configuración de IA](https://docs.google.com/document/d/1lKt4_vMaFIiKnqw25QAXty45dd_EvunTSBSzniKgYh4/edit?usp=drivesdk), 29/09/2026 |
| GU | Preguntas A–V | [Guía de relevamiento](https://drive.google.com/file/d/1_f9b2Y8t10F3_IEgjRT681J8tW01Qs1E/view?usp=drivesdk), actualización 30/09/2026 |

La identidad “Olivia”, un núcleo compartido, schemas estrictos, idempotencia, recuperación selectiva y autorización server-side provienen del prompt que el usuario pidió aplicar; no se atribuyen falsamente a las preguntas pendientes de las guías.

## Matriz de capacidades

Todas las escrituras por Olivia requieren propuesta normalizada y confirmación Sí/No antes de modificar datos. Los permisos efectivos se validan de nuevo en backend. Una capacidad funcional no habilita una herramienta hasta que exista servicio, schema y prueba. Toda modificación conserva usuario, fecha/hora, módulo, resultado, datos afectados y origen “Asistente IA / Olivia”.

| Módulo | Lectura Administrador | Escritura Administrador | Alcance Vendedor | Confirmación / sensibilidad | Dependencia externa | Estado / fuente |
| --- | --- | --- | --- | --- | --- | --- |
| Productos | Catálogo y datos autorizados | Crear/editar/desactivar; eliminación condicionada a integridad | Productos/precios habilitados para ubicación; sin gestión global | Sí/No; eliminación sensible | Imágenes si aplica | Catálogo/precio definido; eliminación pendiente — AC |
| Ubicaciones | Información/historial/calendario | Stock, precios, descuentos y asignaciones según permiso | Solo ubicaciones asignadas; no administración | Sí/No; baja requiere reautenticación manual | Ninguna para consulta | Estados e historial definidos; baja/recuperación técnica pendiente — AC |
| Panel Vendedor / Ventas | Ventas y flujo operativo permitido | Venta, edición y anulación mediante servicio compartido | Venta completa y ventas del día; sin métricas históricas/globales | Sí/No; advertencia adicional por stock insuficiente | ARCA si factura; POS presencial fuera de app | Definido — DF, AIV |
| Venta Rápida | Canal real, origen de stock, clientes | Registro administrativo manual, precio editable | No acceso general | Sí/No; conservar trazabilidad | ARCA/WhatsApp cuando se factura | Separación canal/origen definida; catálogo de canales pendiente — DF |
| Stock | Inventario autorizado actualizado | Cargas/ajustes según permisos | Solo consulta propia; no aumentar stock | Sí/No con producto, cantidad y destino; no asumir pantalla como aprobación | Ninguna | Definido — DF |
| Depósitos | Inventario e historial | Ingresos/ajustes/transferencias | Sin acceso administrativo | Sí/No; depósito no es canal de venta | Ninguna | Definido; contenedores parciales pendiente — DF |
| Transferencias | Origen/destino/responsables/estado | Preparar y confirmar cantidades físicas; incidencias | No extender permisos del panel | Sí/No; recepción valida físico; daños no ingresan al destino | Tercero de traslado si aplica | Bidireccional definido; estados exactos pendientes — DF |
| Clientes / CRM | Datos e historial por permiso | Alta/deduplicación por teléfono; completar vacíos | Alta/asociación durante venta, campos permitidos | Sí/No; no sobrescribir datos existentes por importación implícita | WhatsApp/Excel en funciones específicas | Teléfono obligatorio; fidelización exacta pendiente — GI |
| Dashboard | Resumen, ventas/pagos/alertas | Navegación sin escritura; carga stock por flujo común | Sin panel administrativo | Navegación sin confirmar; escritura por herramienta | Ninguna para resumen | Definido; IA antes futura ahora autorizada por solicitud — GI, AIA |
| Métricas | Histórico autorizado y filtros | Configuraciones existentes, sin inventar análisis nuevo | Solo jornada actual vía Panel Vendedor | Consulta sin modificación; permisos de módulo | Feriados para promedios aplicables | Reglas de promedios definidas; multisitio/años parciales pendiente — GI |
| Finanzas | Ingresos/gastos/caja/conciliación por permiso | Gastos, presupuestos, resolución con motivo, reglas existentes | Ninguna información administrativa financiera | Sí/No; configuración crítica sensible y auditada | Banco/medios de cobro | Decisiones consolidadas; matching y tratamiento fiscal pendientes — FIN |
| Ecommerce | Pedidos, catálogo y estados autorizados | Configuración y gestión efectivamente implementadas | Sin gestión administrativa adicional | Sí/No; pago confirmado determina venta | Payway único; ARCA; WhatsApp | K1–K10 consolidados; excepciones de pago/reserva pendientes — EC |
| Envíos | Pedido/logística/estados autorizados | Preparación/asignación/cierre por permiso | Solo trabajo ya habilitado y ubicación asignada | Sí/No; no asignar fuera de permisos | Proveedor logístico | Flujo definido; tracking/QR de logística futuro — SH |
| Alertas / Observaciones | Centro y detalle por permiso | Crear/asignar/escalar/resolver | Observación manual para Administrador, no centro global | Sí/No para envío; multimedia fuera de Firestore | Storage para evidencia; pendiente proveedor | Amarillo/rojo y ciclo definidos; categorías finales pendientes — AL, AIV |
| Proveedores / Reposición | Ficha/compras/tiempos/autorizados | Orden/recepción y reglas configuradas | Sin acceso | Sí/No; modo automático requiere regla explícita previamente configurada | WhatsApp/stock proveedor | Margen 50%, mínimos y físico definidos; fórmula final pendiente — SUP |
| Facturación | Comprobante de venta permitido | Preparar/emitir/reenviar por servicio fiscal existente | Generar comprobante en venta habilitada | Sí/No; CUIT inválido se corrige; caída ARCA no revierte venta | ARCA y WhatsApp; impresora térmica | Emisión/asociación/reintentos definidos; matriz fiscal pendiente — TAX |
| Actividad / Auditoría | Administrador o permiso explícito de revisión | Registro automático; no editar historial arbitrariamente | Sin acceso global | Toda modificación genera auditoría | Ninguna | Resumen/detalle definidos; retención/filtros finales pendientes — AUD |
| Usuarios / Roles | Perfil y permisos confiables | Gestión por Administrador autorizado | Solo su identidad/ubicaciones necesarias | Sí/No + reautenticación manual para roles/permisos; jamás credenciales al LLM | Firebase Auth | Dos actores base definidos; roles futuros no cerrados — D03, AIA |
| Marketing / Redes | Datos autorizados de módulos existentes | Solo herramientas efectivamente disponibles | Sin acceso administrativo | Revisión/aprobación humana; Sí/No para cambio real | Meta/Google/WhatsApp y extensión | Objetivo preliminar; sin documento cerrado L/M específico — D02, D04, GU |
| Configuración IA | Consumo/costos/historial de vendedores autorizados | Cupos, períodos, ampliaciones, retención/políticas | Solo porcentaje restante/próxima renovación y solicitar ampliación | Sí/No; cambios administrativos auditados; configurar acceso | OpenAI/cotización elegida | Cupos/retención definidos; cotización y límites globales pendientes — AIC |
| Olivia | Lectura/navegación/herramientas administrativas permitidas | Únicamente herramientas backend confirmadas | Solo capacidades del Panel Vendedor real | Sí/No; sensibles reautenticación fuera del LLM | OpenAI, audio/realtime | Núcleo operativo definido; detalles no bloqueantes configurables — AIA, AIV, prompt |

## Reglas que deben conservarse

1. Catálogo único: crear producto no agrega automáticamente inventario en todos los puntos. Una ubicación puede sobreescribir el precio base. Desactivar conserva historial.
2. Venta presencial: descuentos fijos primero, porcentuales después; pagos combinados deben sumar el total final. Producto/precio/stock provienen de herramientas actuales, no memoria del chat.
3. Stock digital insuficiente: avisar y permitir la excepción del Panel Vendedor cuando su servicio la habilita; stock negativo de ubicación queda trazable. No extender esta excepción a depósito/transferencia.
4. Anulación: conservar venta anulada, restituir stock y excluir su ingreso efectivo. Edición actualiza efectos derivados y conserva actor.
5. Cliente: teléfono obligatorio y único operativo; nombre/zona opcionales. Consultar teléfono antes de alta. Importación continúa con duplicados y completa solo campos vacíos sin reemplazo implícito.
6. Ubicación/depósito y canal/origen son conceptos diferentes. Venta Rápida registra canal real; un depósito no recibe atribución comercial como canal.
7. Transferencia/recepción: cantidades físicas reales; unidad dañada se descuenta sin ingresarla al destino. Responsables e incidencias quedan asociados.
8. Métricas: bloques horarios inclusivos y calendario operativo; no dividir el día genéricamente por 24 ni el mes por todos sus días. Reglas multisitio/años parciales permanecen pendientes.
9. Ecommerce: compra sin cuenta; teléfono en checkout; stock agregado de Locales/Depósitos con mínimos protegidos; carrito no reserva, checkout sí; referencia inicial 10 minutos configurable; Payway aprobado cierra venta. No contar pendientes/rechazados.
10. Caída fiscal: venta/pago se conservan confirmados; comprobante pendiente y reintentos. CUIT inválido requiere corrección y no se etiqueta como fallo técnico. Impresión térmica manual.
11. Alertas: una alerta por problema escala amarillo→rojo; umbrales por producto/ubicación, iniciales en 0; persiste hasta resolución; toda evolución queda en Actividad.
12. Proveedores: preparación/entrega separadas, referencia de plazo con 50% adicional, mínimos/packs; stock entra por recibido real y aprobado.
13. Finanzas: venta confirmada alimenta ingresos; rentabilidad/caja son distintas; vencimiento normal no dispara discrepancia; resolución manual exige motivo; conciliación posterior cierra alerta preservando actividad.
14. Olivia: no adivinar obligatorios; corregir borrador sin reiniciar; UI/contexto nunca autoriza; resumen con objeto/cantidad/origen/destino/módulos y Sí/No. “No” cancela sin pedir explicación. Navegación permitida no requiere confirmar.
15. Vendedor: ubicaciones asignadas únicamente; una ubicación puede ser contexto predeterminado; múltiples ambiguas requieren elección; hoy únicamente para ventas/cobros, sin histórico de otros usuarios.
16. Cupo: mostrar al vendedor porcentaje y renovación, nunca pesos/dólares ni detalles técnicos de modelos. Avisos 25%, 10% y bloqueo IA al 0%; panel manual sigue disponible. Renovación diaria/semanal/mensual; ampliación solo período vigente.
17. Retención: historial completo 1–12 meses configurable, referencia de guía 30 días; al vencer, eliminar texto identificable y conservar métricas anónimas. No confundir retención conversacional con retención de auditoría, que sigue pendiente.
18. Costos Administrador: estimado previo y real posterior cuando disponible; ARS = USD × dólar oficial vendedor × 1,05. La fuente/frecuencia/fallback no están cerrados; configuración explícita en lugar de una cotización inventada.

## Pendientes no bloqueantes y futuras ideas

| Estado | Tema | Tratamiento implementable |
| --- | --- | --- |
| Pendiente | Fuente y caché de dólar oficial vendedor | Configuración explícita; mostrar ausencia de referencia y no inventar conversión |
| Pendiente | IDs API/modelos/razonamiento reales y disponibilidad de cuenta | Perfiles configurables; validación del servidor/proveedor, sin usar etiquetas funcionales como IDs |
| Pendiente | Duración de contexto/borrador, fallas parciales y deshacer | Contratos extensibles y límites técnicos documentados; no anunciar una regla comercial cerrada |
| Pendiente | “Leído/Entendido” para avisos importantes de vendedor | No introducir acuse obligatorio como requisito cerrado; distinguir pendiente/no leído |
| Pendiente | Catálogo exacto de acciones sensibles y umbrales masivos | Lista explícita mínima ya definida; extender por configuración/revisión |
| Pendiente | Audio: duración, conservación, TTS/lectura independiente y costos | Límites técnicos y no persistencia de audio por defecto; modalidades separadas y misma seguridad |
| Pendiente | Cuentas a pagar, tratamiento fiscal y matching bancario | Reutilizar servicios existentes; no inventar nuevas reglas fiscales/contables |
| Pendiente | Offline: resolución detallada de conflictos | Conservar flujo manual existente y su política; Olivia no simula IA offline |
| Pendiente | Ecommerce: pago tardío, reembolso, stock multifuente, tracking seguro | No cerrar una política nueva desde Olivia |
| Pendiente | Roles futuros/permiso específico IA | Arquitectura extensible con autorización efectiva, sin conceder nuevos roles |
| Futura | IA para sugerir productos/promos al reactivar feria/evento | Recuperar como idea futura, no herramienta obligatoria ni ejecución autónoma |
| Futura | GPS del repartidor, QR logístico y ETA en tiempo real | Depende de proveedor/consentimiento; no anunciar integración disponible |
| Preliminar | Marketing multicanal e inbox | Utilizar únicamente capacidades existentes y APIs autorizadas |

## Contradicciones, evoluciones y decisiones de integración

- **“Separada” IA Vendedor vs núcleo único:** AIV define separación funcional; el prompt actual exige núcleo compartido. Se conserva el alcance distinto mediante capacidades y políticas por rol, sin duplicar arquitectura.
- **Stock negativo en README vs servicio:** README describe “prevención de stock negativo”, pero `sellerService`/`saleStock` permiten saldos negativos de ubicación para reflejar venta física real. Se conserva la regla del servicio y DF; insuficiencia de depósito continúa bloqueada. No imponer un bloqueo global desde Olivia.
- **Permisos de frontend vs reglas genéricas:** `firestore.rules:canModule` tiene menos detalle que el evaluador de permisos de frontend para listas allow/deny y objetos. Olivia debe evaluar perfil confiable y permisos efectivos en servidor para cada herramienta; el modelo no autoriza.
- **IA Dashboard anteriormente futura:** GI y materiales de Panel General la posponen. AIA posterior y la petición actual autorizan implementar Olivia transversal. Esto no convierte análisis proactivo de ubicaciones en requisito cerrado.
- **Nombres de modelos:** “ChatGPT 6 Luna/Sol” son objetivos funcionales; el entorno técnico requiere IDs API. La auditoría oficial del agente principal verificó `gpt-6-luna` (`xhigh` para objetivo extremo de Admin, `medium` Vendedor) y `gpt-6-sol`/`high` para complejo. Disponibilidad de cuenta no probada sin credenciales; configuración centralizable.
- **Cotización:** documentación define factor 1,05 pero deja fuente/actualización pendientes. No consultar una fuente pública arbitraria ni presentar una cotización antigua como actual.
- **Guía vs respuestas:** GU contiene preguntas sobre autorización de escalamiento, historial, lectura en voz alta y más. AIA/AIC consolidan algunos puntos; una pregunta sin respuesta no revoca una definición consolidada. Los números V1–V18 de la síntesis AIV no coinciden en todos los temas con la guía ampliada; referenciar tema/sección además del número.
- **Ecommerce sobre reglas anteriores:** EC del 28/09 reemplaza explícitamente versiones anteriores: reserva comienza en checkout y Payway es proveedor único. TAX del 30/09 cierra parte del pendiente anterior de caída ARCA: mantener venta/pago y reintentar.

## Recuperación de conocimiento

`src/shared/oliviaKnowledge.mjs` guarda fragmentos revisados y breves, con módulo, estado y URL de fuente. La recuperación es lexical, normaliza acentos en español, acota consulta y máximo de resultados, y filtra audiencia antes de rankear. No contiene stocks/precios/clientes/ventas vivos ni intenta autorizar herramientas.

El perfil Vendedor recibe exclusivamente fragmentos de sus operaciones: venta, pagos, clientes dentro de venta, stock/precios de ubicación, observaciones, avisos, cuota porcentual y continuidad manual. No recupera configuración administrativa, finanzas, históricos de otros usuarios ni política de modelos. El rol enviado al recuperador debe proceder del perfil confiable del servidor.

El texto recuperado es **dato documental no confiable**, nunca instrucción del sistema. “Pendiente” y “futura” se devuelven explícitamente. La app necesita consultar herramientas para información mutable y validar permisos independientemente del conocimiento.

## Prioridad de integración y validación

1. Núcleo server-side, sesión/ubicaciones/permisos, registro tipado, consultas limitadas y recuperación selectiva.
2. Dos flujos completos sobre servicios comunes: carga de stock Administrador y venta Vendedor; preparación→confirmación vinculada→ejecución idempotente→auditoría.
3. Correcciones de borrador, error seguro, sesión cambiada, doble confirmación, confirmación expirada, stock insuficiente y rechazo de privilegios/ubicaciones ajenas.
4. Texto, transcripción y voz con mismo conversationId y política; IA caída/offline nunca bloquea operación manual.
5. Configuración de cupos/renovación/ampliación temporal/retención y consumos diferenciados; costos propios en pesos para todos, métricas técnicas solo Administrador.
6. Ampliar módulos únicamente con contratos, permisos, servicios existentes y pruebas. No hacer pasar una recomendación/documentación como una herramienta ejecutada.

## Validación del índice documental

Comando: `node --test tests/olivia-knowledge.test.mjs`. Resultado: 9 pruebas aprobadas, 0 fallidas. Se verificaron recuperación en español con acentos y conjugaciones, exclusión administrativa para Vendedor incluso con módulo manipulado, restricciones de stock/histórico, rol desconocido, metadatos pendiente/futuro/preliminar, límites de consulta/resultados, referencias, copias independientes e inyección de instrucciones en consulta. Estas pruebas verifican el recuperador; los permisos, transacciones y disponibilidad de OpenAI se prueban por separado en el núcleo operativo.

## Ampliación solicitada por el usuario el 4/10/2026

Estas instrucciones directas actualizan las restricciones de la propuesta documental: administradores sin límite de tokens; cupos solo para vendedores; costos propios estimados y anteriores en pesos en la vista común; modo desarrollador exclusivo de administradores; chats propios guardados, listados, paginados y retomables, con contexto reciente acotado. La retención configurada sigue vigente. No habilitan operaciones comerciales sin confirmación ni consulta de chats de otros vendedores.
