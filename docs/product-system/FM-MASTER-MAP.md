# FM Master Product & Architecture Map — v0.2

## 1. Superficies del producto

Flor Mía se entiende como un sistema con varias superficies, no como una sola pantalla:

- Storefront público.
- Panel Administrador (`/gestion`).
- Panel Vendedor (`/vendedor`).
- Extensión privada Chrome `Flor-Mia-WhatsApp-Sender`.
- WhatsApp Web como sistema externo operado por la extensión.
- Firebase / Firestore como persistencia y control de acceso.
- Netlify / Functions / IA como plataforma de hosting e integraciones backend.

## 2. Módulos de negocio

### Operación comercial

- FM-MOD-01 — Ubicaciones.
- FM-MOD-02 — Productos.
- FM-MOD-03 — Ventas rápidas.
- FM-MOD-04 — Clientes.
- FM-MOD-07 — Depósitos.
- FM-MOD-11 — Envíos.
- FM-MOD-13 — Proveedores.

### Gestión y control

- Panel General.
- FM-MOD-05 — Métricas.
- FM-MOD-06 — Finanzas.
- FM-MOD-12 — Alertas.
- Actividad.
- Administración / Auditoría / Configuración / permisos.

### Growth y canales

- FM-MOD-08 — Ecommerce.
- FM-MOD-09 — Redes Sociales.
- FM-MOD-10 — Marketing.
  - FM-MOD-10-WA — Campañas WhatsApp.
  - FM-MOD-10-META — Meta Ads.

## 3. Relaciones principales

### Producto / inventario / venta

`Producto maestro -> Ubicación o Depósito -> movimiento de stock -> venta -> métricas`

Un producto existe una sola vez en el catálogo maestro. Las ubicaciones y depósitos mantienen inventario asociado a ese producto.

### Cliente / venta

`Teléfono -> cliente -> venta -> historial de consumo`

El teléfono es el identificador operativo principal del cliente. El mismo patrón de selección de cliente debe ser reutilizado por Venta Rápida y Panel Vendedor.

### Depósito / ubicación

`Depósito -> transferencia -> Ubicación`

El depósito no se considera un punto de venta. Su función es recibir, almacenar y transferir mercadería. Una Venta Rápida sí puede usar un depósito como origen físico del stock.

### Redes / CRM

`WhatsApp Inbox -> teléfono -> cliente -> historial de compras -> contexto comercial`

El Inbox no replica WhatsApp completo: prioriza conversaciones pendientes y permite responder con contexto CRM.

### Marketing / extensión

`FM Web App -> extensionBridge -> Chrome Extension -> WhatsApp Web -> eventos -> FM Web App`

La Web App prepara la campaña; la extensión ejecuta la interacción técnica con WhatsApp Web.

## 4. Estados de diseño

- `ACTUAL`: existe en código con interfaz especializada.
- `GENÉRICO`: existe ruta/base de datos pero usa una pantalla genérica.
- `PROPUESTO`: diseño funcional aprobado, todavía no implementado completamente.
- `FUTURO`: idea registrada, todavía no diseñada en detalle.
- `REVISAR`: código y documentación presentan diferencias.

## 5. Convención de IDs

Toda funcionalidad nueva debería recibir un ID permanente. Ejemplos:

- `FM-MOD-01` Ubicaciones.
- `FM-MOD-03-SALE-ORIGIN` Origen de stock en Venta Rápida.
- `FM-MOD-04-CLIENT-MATCH` Resolución de cliente por teléfono.
- `FM-MOD-07-TRANSFER` Transferencia de stock.
- `FM-MOD-09-WA-INBOX` WhatsApp Inbox.

El mismo ID puede aparecer en Figma, FigJam, docs, tests y comentarios de implementación.