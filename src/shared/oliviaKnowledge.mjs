/**
 * Reviewed, bounded knowledge from Flor Mía's proposed solution.
 * Documentary data only: live business values and authorization come from tools.
 * Callers must derive role from a trusted server-side profile.
 */
export const OLIVIA_KNOWLEDGE_VERSION = "2026-10-04.1";

const SOURCE = Object.freeze({
  index: "https://drive.google.com/file/d/1tcV1cAQedA3DasAxb1cclkcjqKEECpll/view?usp=drivesdk",
  situation: "https://drive.google.com/file/d/1Yhs3cgsZffvGjKLCwWlx2jBzoGMJcWo_/view?usp=drivesdk",
  objectives: "https://drive.google.com/file/d/168G47-aCon0ec54ahqHoWIo1sorUzKNY/view?usp=drivesdk",
  actors: "https://drive.google.com/file/d/1lRYeJ06YWWNkps1atDyArY-yBslX8ZL5/view?usp=drivesdk",
  boundary: "https://drive.google.com/file/d/1IhjKT9XoEwjnV9VWqPWO2ALxb4-FWyVV/view?usp=drivesdk",
  products: "https://drive.google.com/file/d/1TT2CBwml1vuP-LTUvojKOboLwwt_QgmN/view?usp=drivesdk",
  operations: "https://drive.google.com/file/d/1kbOtCZQIEhGt8NSYPkgj7JKNVbBxbihR/view?usp=drivesdk",
  crm: "https://drive.google.com/file/d/1V7o_dkOc1mHnIolE3g0U3X1jjhB8TYZz/view?usp=drivesdk",
  finance: "https://drive.google.com/file/d/10CXmW-OjeN5lE-ojVVPJte88qmIOKSdG/view?usp=drivesdk",
  ecommerce: "https://drive.google.com/file/d/1KEU9m82zisBsRqH-RoDTC0gU-PnPEfgz/view?usp=drivesdk",
  shipping: "https://drive.google.com/file/d/1WSAw3VGp4nd_ZZ-ZMqvEtTtdbMrhklqN/view?usp=drivesdk",
  alerts: "https://drive.google.com/file/d/1M8ck5Vf_IQFmStSHNkCe6B4NDUjfX9d6/view?usp=drivesdk",
  suppliers: "https://drive.google.com/file/d/1Vw9rJ881O5BV9S5XTq8GpOrV1uOxmMtp/view?usp=drivesdk",
  invoices: "https://drive.google.com/file/d/1_zSA9-4uAQlBnqyEhR1T-Icl8lZV-WQX/view?usp=drivesdk",
  activity: "https://drive.google.com/file/d/1FXs0wdv1SOSVINw6FRK-F8eDsIem_FR1/view?usp=drivesdk",
  admin: "https://docs.google.com/document/d/1Vr_hSAvQ13VQerFBwpkHeG3QYi8eJghU47FT-k5P1Mk/edit?usp=drivesdk",
  seller: "https://docs.google.com/document/d/1OqRmESCs5Z0lEM2DyeQvjaSez6dYsKk6bHAOGasRN2Q/edit?usp=drivesdk",
  config: "https://docs.google.com/document/d/1lKt4_vMaFIiKnqw25QAXty45dd_EvunTSBSzniKgYh4/edit?usp=drivesdk",
});

function entry(id, module, title, text, source, status = "defined", audience = "admin", keywords = "") {
  return Object.freeze({ id, module, title, text, sourceUrl: SOURCE[source], status, audience, keywords });
}

// Seller knowledge is deliberately authored independently from administrative
// chunks. Never expose full documents or administrator chunks by module name.
const ENTRIES = Object.freeze([
  entry("documentation-states", "business", "Estados de la documentación",
    "Flor Mía distingue producción/main, preview, propuesto/diseñado e idea/pendiente. Una solución documentada no demuestra implementación en producción. Las preguntas de relevamiento no son decisiones cerradas; los documentos preliminares pueden contener reglas expresamente consolidadas.",
    "index", "defined", "admin", "documentacion requisito definido preliminar pendiente futuro"),
  entry("business-purpose", "business", "Procesos integrados de Flor Mía",
    "Flor Mía centraliza operación, administración, ventas, stock, clientes, logística, control y análisis. El objetivo es reutilizar información cargada una vez y reducir planillas, anotaciones y memoria. El estudio de situación actual describe problemas organizacionales y no representa por sí mismo el código disponible.",
    "situation", "preliminary", "admin", "objetivo negocio excel situacion"),
  entry("business-relations", "business", "Relaciones entre módulos",
    "Una venta confirmada alimenta stock, cliente e historial, métricas, finanzas y actividad según corresponda. Una ubicación tiene stock y realiza ventas; un depósito almacena mercadería. Dashboard resume el negocio y Métricas permite análisis detallado.",
    "objectives", "defined", "admin", "integracion sistema modulos venta"),
  entry("roles-boundary", "users", "Administrador y Vendedor",
    "Administrador tiene acceso funcional amplio, sujeto a reglas de negocio e integridad. Vendedor utiliza un panel simplificado y ubicaciones habilitadas; no accede a finanzas, stock global, depósitos, marketing, proveedores, usuarios ni auditoría administrativa. Futuros roles requieren permisos explícitos.",
    "actors", "defined", "admin", "roles permisos usuario administrador vendedor"),
  entry("external-boundary", "business", "Servicios externos y responsabilidad",
    "Clientes y proveedores no operan el panel administrativo. ARCA emite comprobantes; POS presencial procesa cobros fuera de Flor Mía; Meta/Google ejecutan publicidad; WhatsApp es el canal externo y su extensión actúa como puente. Flor Mía conserva información, seguimiento y trazabilidad.",
    "boundary", "defined", "admin", "externo frontera pos meta whatsapp arca"),
  entry("product-master", "products", "Catálogo maestro de productos",
    "Cada producto se crea una sola vez con nombre, presentación/variante, categoría, precio base, descripción, imagen, acceso rápido y estado. Crear producto no incorpora stock a todos los puntos: cada ubicación o depósito selecciona su surtido desde el catálogo global.",
    "products", "defined", "admin", "producto crear catalogo variante presentacion categoria"),
  entry("product-price", "products", "Precio base y precio por ubicación",
    "El precio base del producto es referencia inicial. Una ubicación puede configurar su propio precio superior o inferior. Ventas, stock, Ecommerce, métricas, proveedores, marketing e IA reutilizan el mismo producto. Los umbrales de stock se configuran por producto y ubicación, no solo globalmente.",
    "products", "defined", "admin", "precio producto ubicacion umbral"),
  entry("product-deactivation", "products", "Desactivar y eliminar productos",
    "Desactivar un producto conserva información e historial y permite volver a comercializarlo. La eliminación definitiva se contempla, pero sus reglas de integridad para ventas, stock, métricas y auditoría siguen pendientes. No asumir que se puede borrar historial asociado.",
    "products", "pending", "admin", "desactivar eliminar borrar producto historial"),
  entry("location-operation", "locations", "Ubicaciones, vendedores y calendario",
    "Una ubicación es un punto de venta: Local, Feria o Evento. Tiene productos, stock, vendedores asignados, precios y descuentos, ventas y calendario operativo. Puede tener varios vendedores simultáneamente. El calendario de atención alimenta promedios de Métricas; ventas fuera de horario pueden extender la ventana efectiva sin cambiar el calendario base.",
    "products", "defined", "admin", "ubicacion local feria evento vendedor horario calendario"),
  entry("location-archive", "locations", "Pausar o dar de baja una ubicación",
    "Una ubicación inactiva o pausada conserva información e historial y puede reactivarse. Dar de baja se reserva al Administrador y exige reautenticación manual. La recuperación aproximada de 30 días y la eliminación definitiva requieren diseño técnico que preserve historial, métricas y trazabilidad.",
    "products", "pending", "admin", "ubicacion pausa baja eliminar recuperar reautenticacion"),
  entry("location-ai-future", "locations", "Análisis de ubicaciones con IA: idea futura",
    "IDEA FUTURA, no requisito cerrado: al reactivar una feria o evento, un asistente podría resumir historial y sugerir productos, promociones o acciones comerciales. No se considera una funcionalidad obligatoria ni una autorización para ejecutarla automáticamente.",
    "products", "future", "admin", "inteligencia analisis recomendar sugerir feria evento reactivar"),
  entry("quick-sale-channel", "quick-sales", "Venta Rápida: canal y origen físico",
    "Venta Rápida registra manualmente ventas de WhatsApp, Instagram, llamadas u otros canales no automatizados. Separa canal comercial real del lugar físico desde donde sale el stock: ubicación o depósito. Venta Rápida y depósito no son canales. El Administrador puede editar el precio inicial; la venta alimenta stock, cliente, finanzas y métricas del canal real.",
    "operations", "defined", "admin", "venta rapida canal whatsapp instagram deposito precio"),
  entry("warehouse-stock", "warehouse", "Depósitos y unidades de inventario",
    "Depósito almacena productos y cantidades, sin ser punto de venta presencial. Permite agregar productos, ingresar stock, transferir y consultar historial según permisos. El stock se conserva en unidades individuales; contenedores/cajas son referencia adicional de conteo. La regla exacta para cajas parciales o conteo manual está pendiente.",
    "operations", "defined", "admin", "deposito almacen inventario unidad contenedor caja"),
  entry("stock-load", "stock", "Cargas y ajustes de stock",
    "Administrador o usuario expresamente autorizado puede cargar o ajustar inventario. Debe identificar producto, cantidad y ubicación o depósito destino. Vendedor no puede aumentar stock por su cuenta. Toda modificación conserva fecha/hora y responsable; el requisito de observación obligatoria para ciertas clases de ajuste sigue pendiente.",
    "operations", "defined", "admin", "stock cargar sumar agregar ajustar unidades destino"),
  entry("transfer-reception", "transfers", "Transferencias y recepción física",
    "Se permiten transferencias depósito↔ubicación, depósito↔depósito y ubicación↔ubicación, incluso a ubicaciones inactivas para preparar eventos. Seleccionar origen, destino, productos, cantidades y responsables. El receptor verifica físicamente lo recibido; confirmar actualiza ambos inventarios. Cantidad real prevalece; daños/pérdidas se registran sin incorporarlos al destino. Estados exactos están pendientes.",
    "operations", "defined", "admin", "transferencia stock deposito ubicacion trasladar enviar recibir origen destino diferencia dano"),
  entry("customer-master", "customers", "Clientes: teléfono único y datos opcionales",
    "Teléfono obligatorio es identificador operativo único; nombre y zona son opcionales y pueden completarse luego. Buscar primero por teléfono: si existe, asociar ese cliente; no crear duplicado. Ventas asociadas alimentan historial y última compra. CRM es base maestra; WhatsApp reutiliza identidad y contexto comercial.",
    "crm", "defined", "admin", "cliente telefono duplicado nombre zona historial crm"),
  entry("customer-import", "customers", "Importar clientes desde Excel",
    "Importación con teléfono, zona y nombre: duplicados no detienen todo el archivo. Crear nuevos, informar duplicados y completar solo campos vacíos existentes. Reemplazar un dato no vacío requiere acción explícita. El reporte final y precedencia entre datos diferentes están pendientes.",
    "crm", "defined", "admin", "importar excel cliente duplicado telefono sobrescribir"),
  entry("loyalty-pending", "customers", "Fidelización configurable",
    "Fidelización considera frecuencia, período y categorías de compra mediante parámetros configurables. La cantidad exacta de compras, ventana temporal y condiciones para estado Fidelizado siguen pendientes. No convertir un umbral arbitrario en una regla cerrada.",
    "crm", "pending", "admin", "fidelizacion fidelizado frecuencia segmento compras"),
  entry("dashboard-summary", "dashboard", "Panel General y alertas",
    "Dashboard es la pantalla inicial administrativa, con resumen ejecutivo, filtros diario/mensual, ventas, facturación, ticket promedio, ritmo y formas de pago. Alertas rojas aparecen antes que amarillas y abren el contexto afectado. Acciones rápidas: Venta Rápida y cargar stock en ubicación activa. Métricas conserva análisis detallado.",
    "crm", "defined", "admin", "dashboard panel general resumen campana alertas pagos"),
  entry("metrics-hours", "metrics", "Promedio diario por hora",
    "No dividir facturación diaria por 24. Usar bloques horarios inclusivos de primera a última venta cuando no hay horario fijo; con horario fijo, mantener como mínimo apertura/cierre programados y extender por ventas posteriores. El promedio agregado de ubicaciones con horarios distintos y un día sin ventas sin horario fijo sigue pendiente.",
    "crm", "defined", "admin", "metrica promedio hora diario horario facturacion"),
  entry("metrics-calendar", "metrics", "Promedios por día y mes",
    "Promedio mensual por día usa días habilitados para venta, no todos los días calendario. Feriados argentinos se excluyen por defecto; una venta en feriado lo vuelve activo. Ferias/eventos usan fechas configuradas. Vista anual divide por 12; tratamiento de años parciales y rangos personalizados está pendiente.",
    "crm", "defined", "admin", "metrica promedio mensual anual dia mes feriado calendario"),
  entry("finance-income", "finance", "Ingresos, gastos y resultado estimado",
    "Ventas confirmadas alimentan Finanzas automáticamente; correcciones/anulaciones ajustan importes sin borrar trazabilidad. Gastos externos se cargan manualmente: fijo, variable o extraordinario, general o por ubicación, con devengamiento, vencimiento y pago cuando corresponde. Diferenciar margen/resultado estimado de movimiento efectivo de caja. Parámetros de impuestos/comisiones son configurables.",
    "finance", "defined", "admin", "finanzas ingreso gasto costo margen impuesto comision resultado"),
  entry("finance-reconciliation", "finance", "Conciliación bancaria y discrepancias",
    "Cobros electrónicos se contrastan con cuenta bancaria exclusiva; efectivo tiene circuito separado. Mientras la acreditación está dentro del plazo normal configurable, no generar discrepancia. Plazo vencido sin acreditación o importe diferente genera alerta. Conciliación posterior cierra alerta y conserva Actividad. Resolver manualmente exige motivo. Integración bancaria y matching exacto están pendientes.",
    "finance", "defined", "admin", "banco conciliacion discrepancia acreditacion plazo resolver motivo"),
  entry("finance-budget", "finance", "Presupuestos y flujo proyectado",
    "Administrador puede definir presupuestos mensuales por categoría y alertas configurables. Caja real usa cobros/pagos efectivos; proyección usa vencimientos, acreditaciones y calendario de eventos. Estimar eventos por historial comparable cuando existe y permitir ajuste manual. Cuentas a pagar, tratamiento fiscal y criterios estadísticos detallados permanecen pendientes.",
    "finance", "defined", "admin", "presupuesto flujo caja proyectado evento vencimiento"),
  entry("ecommerce-guest", "ecommerce", "Compra online sin cuenta",
    "Navegar y comprar no requiere cuenta ni inicio de sesión. Datos se solicitan al iniciar checkout: nombre, teléfono obligatorio, envío o retiro; dirección si envío y zona incluso en retiro. Buscar/asociar CRM por teléfono. Mostrar resumen antes de pagar. Catálogo maestro, promociones, selector de intensidad y complementos comerciales configurables ayudan a elegir.",
    "ecommerce", "defined", "admin", "ecommerce checkout cuenta registro cliente carrito"),
  entry("ecommerce-stock", "ecommerce", "Disponibilidad online y reserva",
    "Stock online agrega fuentes elegibles de Locales y Depósitos respetando mínimos protegidos por producto/fuente. Carrito no reserva stock; iniciar checkout sí. Referencia inicial: 10 minutos; al vencer sin pago, liberar reserva. Pago aprobado transforma reserva en compromiso. Prioridad multifuente, duración definitiva y pago tardío siguen pendientes.",
    "ecommerce", "defined", "admin", "ecommerce stock reserva carrito checkout minimo protegido"),
  entry("ecommerce-payment", "ecommerce", "Payway y automatizaciones del pedido",
    "Payway es el único proveedor online previsto. Solo pago aprobado/confirmado cierra venta; pendiente, rechazado o abandonado no cuenta como venta efectiva. Pago aprobado alimenta CRM, Ventas/Finanzas, factura ARCA y confirmación por WhatsApp; si hay entrega crea Envíos automáticamente. Pedido abierto y envío representan la misma orden; entrega lo mueve al historial.",
    "ecommerce", "defined", "admin", "payway pago aprobado pedido factura envio ecommerce"),
  entry("ecommerce-assistant", "ecommerce", "Asistencia comercial pública",
    "Asistente comercial se orienta a productos, variedades, intensidad, presentaciones, usos y promociones vigentes de Flor Mía. Puede recomendar y ofrecer Agregar al carrito, usando conocimiento aprobado sin inventar catálogo ni condiciones. Arquitectura de chat humano/IA, límites de costo, proveedor y notificación móvil permanecen pendientes.",
    "ecommerce", "preliminary", "admin", "asistente comercial aceite variedad intensidad recomendar carrito chat"),
  entry("shipping-flow", "shipping", "Preparación y estados del envío",
    "Pedidos con entrega confirmados en Ecommerce generan trabajo en Envíos. Flujo común: pendiente de asignación, preparando pedido, pedido listo; directo sigue al domicilio y tercerizado puede pasar por repositorio. Asignación debe respetar permisos/ubicaciones; único vendedor habilitado puede ser responsable predeterminado si es inequívoco. Confirmar entrega finaliza pedido.",
    "shipping", "defined", "admin", "envio pedido preparar asignar reparto repositorio entregado"),
  entry("shipping-future", "shipping", "QR logístico y seguimiento en tiempo real",
    "FUTURO: QR de etiqueta podría informar fases logísticas; geolocalización del repartidor y ETA dependen de proveedor, mecanismo técnico y consentimiento. Hoy el diseño contempla estados simples para cliente. Umbrales de retiro/demora son configurables; ejemplos de pedidos o días no son valores definitivos.",
    "shipping", "future", "admin", "qr tracking geolocalizacion gps tiempo real repartidor demora"),
  entry("alerts-lifecycle", "alerts", "Alertas amarillas, rojas y notificaciones",
    "Centro con campanita distingue alertas que requieren acción de avisos informativos. Cada producto/ubicación tiene umbrales amarillo/rojo, inicialmente 0 hasta configuración. Un mismo problema conserva una alerta que escala, sin duplicar amarillo y rojo. Permanece abierta hasta resolución; creación, escalamiento, asignación y cierre se auditan.",
    "alerts", "defined", "admin", "alerta amarillo rojo notificacion campanita umbral resolver"),
  entry("alerts-pending", "alerts", "Evidencia y categorías de alertas",
    "Observaciones pueden adjuntar fotos/video desde teléfono. Multimedia pesada no debe almacenarse en Firestore. Proveedor de almacenamiento, taxonomía final de categorías, reglas automáticas de otros módulos, permisos finos y experiencia exacta del popup siguen pendientes.",
    "alerts", "pending", "admin", "multimedia evidencia foto video storage categoria popup"),
  entry("supplier-orders", "suppliers", "Proveedores, mínimos y plazos",
    "Ficha con datos comerciales, productos globales asociados, compras y precios históricos. Varios proveedores por producto; mostrar por defecto último comprado. Separar preparación y entrega, conservar tiempos reales y planificar inicialmente con 50% adicional de margen. Orden incluye productos/cantidades/precios/total, mínimos y plazos; sugerencia respeta mínimos o packs.",
    "suppliers", "defined", "admin", "proveedor orden compra minimo pack plazo preparacion entrega"),
  entry("supplier-receive", "suppliers", "Reposición y recepción real",
    "Administrador configura reposición automática o con aprobación por producto/proveedor. Modo manual prepara necesidad y permite Lo gestiono manualmente sin enviar pedido. Consultar disponibilidad y alternativa; sin proveedor disponible, alertar. Recepción compara esperado y físico: stock aumenta solo por recibido real, revisado y aprobado. Fórmula final y selección exacta están pendientes.",
    "suppliers", "defined", "admin", "reposicion automatica manual recibir discrepancia proveedor disponibilidad"),
  entry("invoice-persistence", "invoicing", "Facturas asociadas a ventas",
    "Facturación puede iniciarse desde Venta Rápida/Panel Vendedor; Ecommerce factura tras pago confirmado. CUIT es clave para datos fiscales y debe validarse antes de emitir. Comprobante queda asociado a venta, con número, fecha, importe, estado, CAE/vencimiento y representación descargable. Matriz fiscal concreta requiere validación de integración ARCA.",
    "invoices", "defined", "admin", "factura arca cuit cae fiscal comprobante"),
  entry("invoice-failure", "invoicing", "Caída ARCA, WhatsApp e impresión",
    "CUIT inválido se informa para corregir; no es fallo técnico. Si ARCA no responde, conservar venta y pago confirmados, factura pendiente y reintentos automáticos. WhatsApp entrega PDF; impresión presencial es manual con botón Imprimir factura y plantilla térmica angosta. Reintentos/rechazos detallados y ancho/modelo de impresora siguen pendientes.",
    "invoices", "defined", "admin", "arca falla error factura imprimir impresora termica whatsapp"),
  entry("activity-record", "activity", "Centro de Actividad y Auditoría",
    "Actividad registra operaciones relevantes con fecha/hora, usuario, módulo y tipo de acción. Resumen permite abrir detalle con variables afectadas y enlace a entidad. Acceso para Administrador o permiso explícito de revisión; no Vendedor común. Toda modificación por IA registra origen Asistente IA, resultado y datos afectados. Retención, filtros finales y before/after universal están pendientes.",
    "activity", "defined", "admin", "actividad auditoria historial origen variables usuario resultado"),
  entry("admin-action", "assistant", "Contexto, preparación y confirmación",
    "Asistente administrativo consulta, explica, navega y prepara acciones de Flor Mía. Usa contexto de pantalla para ahorrar pasos, sin tratarlo como autorización. No adivina obligatorios; acepta correcciones sin reiniciar. Antes de escribir muestra acción, módulos afectados y datos críticos con Sí/No; No descarta. Solo resultado real del backend permite decir que se ejecutó.",
    "admin", "defined", "admin", "contexto pantalla preparar confirmar resumen correccion accion"),
  entry("admin-sensitive", "assistant", "Acciones sensibles y reautenticación",
    "Eliminar ubicación, crear/modificar roles o permisos y cambios críticos requieren reautenticación manual del Administrador. Asistente puede preparar/navegar, pero no escribir, leer, guardar ni reutilizar credenciales. Confirmación normal no reemplaza esta verificación. Navegar sin cambiar datos no exige confirmar, siempre sujeto a permisos.",
    "admin", "defined", "admin", "sensible reautenticacion credencial contrasena permiso rol eliminar"),
  entry("ai-profiles", "ai-config", "Política funcional de modelos",
    "Definición objetivo: Administrador usa perfil económico con razonamiento extremo y perfil más capaz para tareas complejas, volviendo al base después. Vendedor conserva perfil económico con razonamiento medio. Las etiquetas funcionales de modelos no son IDs API; deben mapearse a identificadores/niveles realmente disponibles mediante configuración técnica validada.",
    "config", "defined", "admin", "modelo razonamiento perfil escalamiento api luna sol"),
  entry("ai-currency", "ai-config", "Estimación económica administrativa",
    "Administrador puede ver modelo/razonamiento, consumo estimado, costo previo y real posterior cuando disponible. Regla definida: ARS = costo USD × (dólar oficial vendedor × 1,05). Fuente de cotización, frecuencia/caché/fallback, presupuesto global y costos detallados de audio están pendientes; no inventar referencia.",
    "config", "pending", "admin", "costo dinero ars usd pesos dolar cotizacion cambio presupuesto"),
  entry("ai-quota-admin", "ai-config", "Cupos, períodos y ampliaciones",
    "Administrador configura cupo por vendedor y renovación diaria, semanal o mensual. Nuevo período restaura cupo base; ampliación temporal solo vale en período vigente. Cambio permanente requiere editar base. Administrador puede revisar consumo real, tipos de acciones, solicitudes y evolución; vendedor recibe exclusivamente porcentaje restante y próxima renovación.",
    "config", "defined", "admin", "cupo cuota renovar periodo ampliacion consumo"),
  entry("ai-retention-admin", "ai-config", "Historial y retención de conversaciones",
    "Administrador supervisa conversaciones de vendedores durante retención configurable de 1 a 12 meses. Al vencer, eliminar contenido completo identificable y conservar solo resumen estadístico anónimo. Supervisión ayuda a investigar fallos y capacitar. Esta retención no define automáticamente plazo de Auditoría, que sigue pendiente.",
    "config", "defined", "admin", "historial conversacion retencion anonimo meses supervisar"),
  entry("marketing-preliminary", "marketing", "Marketing e integraciones comerciales",
    "Flor Mía busca asistir campañas de WhatsApp, Meta Ads y Google Ads con segmentación CRM, estrategia y contenido. Servicios externos ejecutan publicidad/comunicación; el usuario conserva revisión y aprobación final. APIs, permisos y conexión de extensión condicionan capacidades. No inferir herramientas disponibles a partir de un objetivo documental.",
    "boundary", "preliminary", "admin", "marketing campana meta google ads whatsapp contenido"),
  entry("seller-sale", "sales", "Venta conversacional en Panel Vendedor",
    "Identificar producto y cantidad, consultar promociones aplicables y si corresponde usarlas, preguntar medio de pago, necesidad de factura y asociación de cliente. Pedir solo datos faltantes, mostrar resumen y confirmar Sí/No antes de registrar por el mismo flujo del Panel Vendedor. Correcciones de cantidades o variedades actualizan la venta en curso sin empezar de cero.",
    "seller", "defined", "seller", "venta vender anotar botella producto cantidad promocion factura cliente corregir"),
  entry("seller-discounts-payments", "sales", "Descuentos y pagos combinados",
    "Agregar al menos un producto antes de aplicar descuentos habilitados. Descuentos fijos se aplican primero y porcentuales después. Puede combinar medios de pago si el panel lo permite; los importes deben sumar el total final. Medios previstos: crédito, débito, alias/transferencia y efectivo.",
    "operations", "defined", "seller", "venta pago efectivo debito credito alias descuento porcentaje combinado"),
  entry("seller-stock", "stock", "Stock y precios de la ubicación",
    "Puede consultar stock actual, precios disponibles y promociones vigentes únicamente en ubicaciones asignadas. No puede cargar ni aumentar stock por su cuenta. Datos actuales se consultan al sistema; no se infieren del historial del chat. Si stock digital es insuficiente, advertir diferencia y pedir Sí/No para continuar solo si el Panel Vendedor permite esa excepción.",
    "seller", "defined", "seller", "stock precio disponible existencias insuficiente negativo promocion ubicacion"),
  entry("seller-location", "locations", "Ubicaciones permitidas",
    "Operar únicamente en ubicaciones asignadas. Si hay una, puede usarse como contexto; si hay varias y la instrucción es ambigua, preguntar cuál. Una ubicación no autorizada queda bloqueada. Puede ofrecer solicitar acceso al Administrador mediante observación; solicitar no concede permiso.",
    "seller", "defined", "seller", "ubicacion permiso acceso asignada elegir local feria"),
  entry("seller-customer", "customers", "Cliente durante la venta",
    "Buscar primero por teléfono, identificador obligatorio del cliente. Si existe, asociarlo a la venta y completar nombre/zona vacíos cuando corresponde. Si no existe, preparar alta con teléfono; nombre y zona son opcionales. No crear duplicados ni acceder a datos fuera del alcance de su panel.",
    "operations", "defined", "seller", "cliente telefono duplicado asociar crear nombre zona"),
  entry("seller-today", "sales", "Consultas de la jornada actual",
    "Puede consultar ventas del día actual, total vendido/cobrado hoy y desglose por medios de pago permitidos. No puede consultar semana/mes anterior, comparaciones históricas, producto más vendido del mes ni métricas globales u otros vendedores. Solo información expuesta por su Panel Vendedor.",
    "seller", "defined", "seller", "hoy jornada dia ventas total cobros historial ayer semana mes"),
  entry("seller-cancel", "sales", "Editar o anular ventas",
    "Si el Panel Vendedor lo habilita, puede corregir una venta o anularla con confirmación. Edición actualiza importes y stock; anulación conserva operación con estado Anulada, restituye stock y excluye el ingreso efectivo. La actividad conserva usuario y motivo/observación cuando corresponde. Nunca borrar la venta para ocultar trazabilidad.",
    "operations", "defined", "seller", "anular cancelar editar venta stock devolver corregir"),
  entry("seller-observation", "observations", "Observaciones para el Administrador",
    "Puede preparar observación por diferencia de stock, mantenimiento, insumos, incidente, permiso, cliente o problema técnico. Se estructura con categoría, urgencia, gravedad y factor temporal sugeridos. Confirmar envío al Administrador correspondiente. Una solicitud de acceso nunca cambia permisos automáticamente.",
    "seller", "defined", "seller", "observacion aviso alerta mantenimiento insumo incidente urgencia gravedad"),
  entry("seller-notice-pending", "notices", "Avisos importantes pendientes de leer",
    "Puede mostrar indicaciones del Administrador y distinguir avisos no leídos. Está PENDIENTE decidir si basta mostrar el aviso o si debe tocar Leído/Entendido para confirmar recepción. No presentar el acuse explícito como una regla ya cerrada.",
    "seller", "pending", "seller", "aviso indicacion leido entendido notificacion"),
  entry("seller-quota", "assistant", "Disponibilidad del Asistente",
    "Mostrar solo porcentaje disponible y próxima renovación. Avisos de referencia al 25% y 10%; al 0% no acepta consultas/acciones nuevas y puede solicitar ampliación al Administrador. La ampliación es temporal para período vigente. El Panel Vendedor y sus funciones manuales siguen operativos aunque se agote el cupo.",
    "seller", "defined", "seller", "cupo cuota porcentaje disponible renovar ampliacion agotado consumo"),
  entry("seller-manual-continuity", "assistant", "Texto, dictado, voz y continuidad manual",
    "Texto, dictado transcripto y conversación por voz comparten contexto y permisos del Panel Vendedor. Si falta información, preguntar; si no comprende tras varios intentos o falla técnicamente, detener automatización, informar y ofrecer carga manual. Se puede preparar observación técnica para el Administrador. Ventas manuales mantienen operación offline y sincronización del panel existente.",
    "seller", "defined", "seller", "audio voz dictado transcripcion error falla offline manual ayuda"),
]);

const SELLER_MODULES = new Set(["sales", "stock", "locations", "customers", "observations", "notices", "assistant"]);
const MAX_RESULTS = 4;
const MAX_QUERY_LENGTH = 1000;
const STOP_WORDS = new Set(("a al algo ante como con cual cuando cuanto de del donde el ella en entre es esta este esto hay la las lo los me mi no o para por que quiero se si sin su sus te tengo un una unas unos y yo olivia asistente ia hacer puedo necesito porfa favor").split(" "));
const WORD_ALIASES = Object.freeze({
  venta: "venta", ventas: "venta", vender: "venta", vendi: "venta", anotar: "venta", anotame: "venta",
  productos: "producto", producto: "producto", botellas: "botella",
  clientes: "cliente", cliente: "cliente", crm: "cliente",
  telefono: "telefono", telefonos: "telefono",
  depositos: "deposito", deposito: "deposito", almacen: "deposito", almacenes: "deposito", warehouse: "deposito",
  inventario: "stock", existencias: "stock", stock: "stock",
  transferir: "transferencia", transfiero: "transferencia", traslado: "transferencia", transferencias: "transferencia",
  descuentos: "descuento", promocion: "promocion", promociones: "promocion", promo: "promocion",
  precios: "precio", precio: "precio", cantidades: "cantidad", unidades: "unidad",
  facturas: "factura", facturar: "factura", facturacion: "factura", comprobantes: "factura", comprobante: "factura",
  pagos: "pago", pagar: "pago", cobros: "cobro",
  alertas: "alerta", avisos: "aviso", observaciones: "observacion", notificaciones: "notificacion",
  permisos: "permiso", roles: "rol", ubicaciones: "ubicacion",
  renovar: "renovacion", renueva: "renovacion", renovaciones: "renovacion",
  quota: "cupo", cuota: "cupo", cuotas: "cupo",
  transcribir: "transcripcion", transcripto: "transcripcion",
  cancelar: "anular", cancelo: "anular", anulo: "anular", anulacion: "anular", anulada: "anular",
  cargame: "cargar", cargale: "cargar", carga: "cargar", sumale: "cargar",
  proveedores: "proveedor", envio: "envio", envios: "envio",
  metrica: "metrica", metricas: "metrica", modelos: "modelo",
  hora: "hora", horas: "hora", mensual: "mes", meses: "mes",
  historico: "historial", historicas: "historial", historicos: "historial",
});
const MODULE_ALIASES = Object.freeze({
  products: "products", productos: "products",
  locations: "locations", ubicaciones: "locations",
  sales: "sales", ventas: "sales", seller: "sales", "seller-panel": "sales",
  "quick-sales": "quick-sales", "venta-rapida": "quick-sales",
  stock: "stock", inventory: "stock",
  warehouse: "warehouse", warehouses: "warehouse", depositos: "warehouse",
  transfers: "transfers", transferencias: "transfers",
  customers: "customers", clientes: "customers", "loyal-customers": "customers",
  dashboard: "dashboard", metrics: "metrics", metricas: "metrics",
  finance: "finance", finanzas: "finance",
  ecommerce: "ecommerce", shipping: "shipping", envios: "shipping",
  alerts: "alerts", alertas: "alerts", suppliers: "suppliers", proveedores: "suppliers",
  invoicing: "invoicing", arca: "invoicing", facturacion: "invoicing",
  activity: "activity", audit: "activity", auditoria: "activity",
  users: "users", usuarios: "users",
  marketing: "marketing", "ai-config": "ai-config", assistant: "assistant",
  observations: "observations", notices: "notices", business: "business",
});

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
function terms(value) {
  return [...new Set((normalize(value).match(/[a-z0-9]+/g) || [])
    .filter(word => word.length > 1 && !STOP_WORDS.has(word))
    .map(word => Object.hasOwn(WORD_ALIASES, word) ? WORD_ALIASES[word] : word))];
}
const SEARCH_ENTRIES = ENTRIES.map((item, index) => ({
  item, index,
  titleTerms: new Set(terms(item.title + " " + item.keywords)),
  bodyTerms: new Set(terms(item.text)),
}));

/**
 * Select up to four small source-grounded fragments; never return live data.
 * Module is a ranking hint, not a permission grant. Unknown roles return nothing.
 */
export function retrieveOliviaKnowledge(query, { role = "seller", module = "", limit = 4 } = {}) {
  const normalizedRole = normalize(role).trim();
  const isAdmin = ["admin", "administrator", "administrador"].includes(normalizedRole);
  const isSeller = ["seller", "vendedor"].includes(normalizedRole);
  if (!isAdmin && !isSeller) return [];
  const queryTerms = terms(String(query ?? "").slice(0, MAX_QUERY_LENGTH)).slice(0, 32);
  const moduleKey = normalize(module).trim();
  const contextModule = Object.hasOwn(MODULE_ALIASES, moduleKey) ? MODULE_ALIASES[moduleKey] : "";
  const numericLimit = Number(limit);
  const resultLimit = Number.isFinite(numericLimit)
    ? Math.max(0, Math.min(MAX_RESULTS, Math.floor(numericLimit)))
    : MAX_RESULTS;
  if (!resultLimit) return [];
  const results = [];
  for (const indexed of SEARCH_ENTRIES) {
    const { item } = indexed;
    if (isSeller && (item.audience !== "seller" || !SELLER_MODULES.has(item.module))) continue;
    let matchedTerms = 0;
    let score = 0;
    for (const term of queryTerms) {
      if (indexed.titleTerms.has(term)) { score += 4; matchedTerms += 1; }
      else if (indexed.bodyTerms.has(term)) { score += 1; matchedTerms += 1; }
    }
    if (queryTerms.length && !matchedTerms) continue;
    if (!queryTerms.length && (!contextModule || item.module !== contextModule)) continue;
    if (item.module === contextModule) score += 2;
    results.push({ ...indexed, score });
  }
  results.sort((a, b) => b.score - a.score || a.index - b.index);
  return results.slice(0, resultLimit).map(({ item }) => ({
    id: item.id, module: item.module, title: item.title, text: item.text,
    sourceUrl: item.sourceUrl, status: item.status,
  }));
}
