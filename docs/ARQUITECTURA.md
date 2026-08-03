# Arquitectura integral

## Capas

1. Presentación pública: componentes y páginas heredados de la web aprobada.
2. Presentación privada: AppShell, design system y módulos bajo `/gestion`.
3. Autenticación y permisos: Firebase Authentication, perfil `users/{uid}`, plantillas de rol y excepciones.
4. Servicios: acceso a Firestore separado de React en `src/gestion/services`.
5. Dominio: pagos, descuentos, ubicaciones, ventas, métricas y botonera sin dependencias de UI.
6. Datos: colecciones compartidas, operaciones críticas con transacciones y resúmenes diarios para métricas.

## Mapa de rutas

| Ruta | Superficie |
| --- | --- |
| `/` | Home pública |
| `/productos` | Catálogo |
| `/producto/:slug` | Producto |
| `/checkout` | Checkout preparado |
| `/gestion` | Panel privado |
| `/gestion/locations` | Ubicaciones |
| `/gestion/quick-sales` | Ventas rápidas |
| `/gestion/loyal-customers` | Clientes fidelizados |
| `/gestion/metrics` | Métricas |
| `/gestion/finance` | Finanzas |
| `/gestion/warehouse` | Depósito |
| `/gestion/ecommerce` | Ecommerce administrativo |
| `/gestion/social` | Redes sociales |
| `/gestion/marketing` | Marketing |
| `/gestion/shipping` | Envíos |
| `/gestion/alerts` | Alertas |
| `/gestion/suppliers` | Proveedores |
| `/gestion/administration` | Usuarios y roles |
| `/gestion/audit` | Auditoría |
| `/gestion/settings` | Configuración |

## Matriz base de permisos

V = ver, O = operar/editar, A = aprobar/administrar.

| Rol | Ubicaciones/Ventas | Clientes | Métricas | Finanzas | Depósito | Ecommerce | Social/Marketing | Envíos | Proveedores |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Administrador general | A | A | A | A | A | A | A | A | A |
| Administrador operativo | A | O | V | — | O | O | O | O | O |
| Encargado de ubicación | A | — | V | — | — | — | — | — | — |
| Vendedor | O | — | — | — | — | — | — | — | — |
| Responsable depósito | V | — | — | — | A | — | — | — | O |
| Responsable marketing | — | V sensible | V | — | — | — | A | — | — |
| Responsable ecommerce | — | V sensible | V | — | — | A | — | O | — |
| Responsable envíos | — | — | — | — | — | — | — | A | — |
| Responsable proveedores | — | — | — | V | O | — | — | — | A |
| Responsable financiero | — | — | V | A | — | — | — | — | — |
| Analista | — | — | V/exportar | — | — | — | — | — | — |

Las plantillas se implementan en `permissions.js`; `permissionAllow`, `permissionDeny` y `permissions` permiten excepciones por usuario. Firestore replica el control: ocultar un botón nunca es la única barrera.

## Flujo transaccional de venta

La confirmación lee contador y stocks, valida ubicación/stock/pago, incrementa el contador, descuenta cada stock, crea movimientos y guarda la venta dentro de una transacción. Un error revierte el conjunto. Factura, envío y registro financiero quedan como estados posteriores hasta validar el esquema integral y sus reglas.

## Optimización Spark

- Consultas limitadas y filtradas por usuario/ubicación.
- Sin listeners globales.
- Ítems históricos embebidos en ventas y pedidos.
- Stock como subcolección por ubicación.
- `dailySummaries` para evitar releer ventas completas.
- Imágenes en Netlify, no Firebase Storage.
- Índices compuestos documentados y paginación prevista.
