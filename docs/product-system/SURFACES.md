# FM Product Surfaces

Flor Mía no debe diseñarse como si fuese una sola interfaz. El Product System separa superficies con objetivos y actores diferentes.

## 1. Storefront público

Entry component: `src/Storefront.jsx`.

Rutas auditadas:

- `/tienda` → Home.
- `/productos` → Catálogo.
- `/producto/:slug` → Detalle de producto.
- `/nosotros` → Nosotros.
- `/checkout` → Checkout.
- Cart Drawer global.
- Header/Footer/Announcement Bar globales.

Sistema visual público:

- se conserva el diseño ecommerce aprobado del proyecto;
- no debe mezclarse mecánicamente con la UI administrativa aunque compartan marca.

## 2. Panel Administrador

Entry principal: `/gestion`.

Responsabilidades:

- Dashboard;
- módulos de negocio;
- gestión de inventario;
- CRM;
- métricas;
- marketing;
- administración/auditoría/configuración según permisos.

Sistema visual privado:

`docs/FLOR-MIA-DESIGN-SYSTEM.txt`.

## 3. Panel Vendedor

Entry principal: `/vendedor`.

UI real: `src/gestion/seller/SellerPanel.jsx`.

Responsabilidades principales auditadas:

- ubicación de venta;
- catálogo/stock disponible;
- carrito;
- descuentos;
- medios de pago, incluido +2 pagos cuando está permitido;
- cliente;
- ventas del día;
- pendientes/offline y sincronización;
- edición/anulación según permisos.

Decisión v0.2:

el selector de cliente por teléfono debe converger con el que se diseñe para Venta Rápida.

## 4. Chrome Extension

Repositorio independiente:

`AgustinBazanUB/Flor-Mia-WhatsApp-Sender`

No es una pantalla dentro del Admin Panel. Es otro runtime/aplicación con su propia persistencia local, Service Worker, popup y content scripts.

## 5. WhatsApp Web

Sistema externo utilizado por la extensión.

Debe mostrarse en diagramas como dependencia externa, no como parte del frontend React de FM.

## 6. Firebase / Firestore

Infraestructura transversal de autenticación/persistencia/reglas.

Debe diseñarse en un mapa de datos independiente del mapa de pantallas.

## 7. Netlify / Functions / IA

Infraestructura transversal para hosting, Deploy Preview y funciones server-side/integraciones.

Meta Ads y otras funciones de IA deben explicitar qué trabajo ocurre en frontend, qué ocurre server-side y qué proveedor externo interviene.

## Regla de Figma

Cada superficie debe tener una sección claramente diferenciada en el archivo de diseño.

No mezclar en una misma biblioteca de pantallas:

- Storefront público;
- Admin App;
- Seller App;
- Extension UI;

sin etiquetar la superficie correspondiente.