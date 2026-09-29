# Superficies y despliegues de Flor Mía

## Decisión

Flor Mía se mantiene en un solo repositorio, con dos artefactos web independientes:

| Superficie | Build | Publicación | Acceso |
| --- | --- | --- | --- |
| Gestión integral | `npm run build:gestion` | `dist/gestion` | Privado, con Firebase Authentication y permisos por rol |
| E-commerce | `npm run build:ecommerce` | `dist/ecommerce` | Público, sin requerir una sesión administrativa |

El build histórico `npm run build` continúa generando la aplicación unificada en `dist` para no romper los Deploy Previews existentes durante la transición.

## Contrato de rutas

- Gestión: `/`, `/gestion/*` y `/vendedor/*` se resuelven con `ManagementApp` cuando `VITE_APP_SURFACE=gestion`.
- E-commerce: `/`, `/tienda`, `/productos`, `/producto/:slug`, `/nosotros` y `/checkout` se resuelven con `Storefront` cuando `VITE_APP_SURFACE=ecommerce`.
- En el modo unificado, las rutas privadas y públicas conservan el comportamiento anterior.
- `VITE_STOREFRONT_PUBLIC=true` elimina únicamente el gate de preview administrativo del storefront. No concede permisos de Firestore ni publica secretos.
- Cada superficie registra el mismo service worker con un identificador distinto y usa su propio manifest, evitando mezclar rutas precacheadas o identidad PWA.

## Configuración en Netlify

Crear dos sitios conectados al mismo repositorio y asignar configuraciones distintas:

### Sitio de Gestión

- Build command: `npm run build:gestion`
- Publish directory: `dist/gestion`
- Functions directory: `netlify/functions`
- Variables: las `VITE_FIREBASE_*` públicas y todos los secretos server-side requeridos por ARCA, OpenAI y Google Drive.
- Dominio sugerido: `gestion.<dominio-de-flor-mia>`.

### Sitio de E-commerce

- Build command: `npm run build:ecommerce`
- Publish directory: `dist/ecommerce`
- No publicar `netlify/functions` administrativas en este sitio.
- No copiar credenciales de ARCA, OpenAI, Google Drive ni Firebase Admin.
- Variable pública opcional `VITE_MANAGEMENT_URL`: URL absoluta del sitio de Gestión si se desea mostrar ese acceso en el pie. Si se omite, el e-commerce público no muestra el enlace.
- Dominio sugerido: `www.<dominio-de-flor-mia>`.

Ambos sitios necesitan fallback SPA (`/* → /index.html 200`) y las cabeceras de seguridad vigentes. Hasta crear el segundo sitio, el `netlify.toml` raíz conserva el despliegue unificado actual.

## Estado actual honesto

La separación de builds ya está preparada, pero el e-commerce todavía usa el catálogo editorial estático de `src/data/products.js`. El checkout no crea pedidos, no reserva stock y no procesa pagos. No debe anunciarse como tienda transaccional hasta implementar el backend público.

## Contrato para conectar catálogo, stock y ventas

El navegador público nunca debe escribir directamente ventas, movimientos de stock, comprobantes ARCA ni colecciones administrativas. El flujo esperado es:

1. Gestión publica una proyección reducida del catálogo (nombre, slug, descripción, imágenes, precio público, disponibilidad y versión).
2. E-commerce consulta esa proyección pública, no los documentos operativos completos.
3. Al confirmar una compra, e-commerce llama a un endpoint server-side con una clave de idempotencia.
4. El backend vuelve a validar precios y stock, crea `webOrders` y reserva unidades en una transacción.
5. Un webhook de pago autenticado confirma o libera la reserva.
6. Sólo una orden confirmada genera la venta interna y el movimiento definitivo de stock.
7. La facturación ARCA se ejecuta server-side según la política fiscal; el cliente nunca invoca ARCA directamente.

Garantías mínimas:

- una misma confirmación no puede crear dos pedidos ni descontar stock dos veces;
- las reservas vencen y liberan unidades;
- precio y disponibilidad se recalculan en servidor;
- el catálogo público no expone costos, auditoría, proveedores ni datos de clientes;
- Firestore Rules deniega escrituras públicas a stock, ventas y facturación;
- secretos y cuentas de servicio existen sólo en el sitio/backend autorizado.

## Verificación

```bash
npm run build:gestion
npm run build:ecommerce
npm test
```

Prueba manual mínima:

1. Abrir el artefacto de Gestión: debe solicitar autenticación y no mostrar el storefront.
2. Abrir el artefacto de E-commerce en `/`: debe mostrar la portada sin autenticación.
3. Recargar una URL profunda de cada superficie y confirmar que Netlify aplica el fallback SPA.
4. Comprobar que el sitio público no expone funciones administrativas ni variables server-side.

