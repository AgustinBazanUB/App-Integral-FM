# Auditoría de los proyectos de origen

## FM Stock y Ventas

Tecnología: JavaScript ES Modules sin bundler, Firebase 11 desde CDN, Authentication, Firestore, PWA y Netlify. No usa Storage, Functions ni Analytics. El repositorio estaba limpio en `main` al iniciar esta integración.

Funcionalidades comprobadas: administración y vendedores, roles combinados, ubicaciones programadas, productos/categorías, stock por ubicación, ingreso de mercadería, alertas, descuentos múltiples, pagos simples y combinados, ventas, edición/anulación/restauración, movimientos, métricas, CSV, botonera Bluetooth, bajas lógicas y PWA.

Modelo actual:

- `users`, `locations`, `products`, `productCategories`, `discounts`, `sales`, `stockMovements`, `counters`, `settings`.
- `locationStock/{locationId}/items/{productId}` para stock operativo.
- Los ítems, descuentos y pagos se embeben en cada venta para preservar el comprobante histórico.

Código reutilizado directamente: `locations.js`, `payments.js`, `discounts.js`, `metrics.js` y `keyboard.js`. La transacción de venta se migró a Firebase npm conservando contadores, movimientos y actualización atómica de stock. Se agregó una validación explícita de stock no negativo.

Código migrado: autenticación, lectura de perfiles, permisos legacy `admin/seller`, consultas por ubicación y creación de usuarios con una app Firebase secundaria.

Código descartado como interfaz: `admin.js`, `seller.js`, HTML imperativo y `styles.css`. Su lógica acoplada al DOM no era reutilizable en React y su estética no cumple el nuevo JSON visual.

Riesgos detectados:

- Las reglas productivas actuales sólo conocen gran parte del esquema legacy.
- El vendedor legacy usa etiquetas de pago históricas que deben conservarse mientras convivan ambos sistemas.
- Algunas métricas leen hasta cientos de ventas; la plataforma integral debe migrar a resúmenes diarios.
- El proyecto Firebase es compartido con producción, por lo que reglas y datos requieren una migración reversible.

## flor-mia-web-fiel-v3

Tecnología: React 18, Vite 6, router liviano propio, Lucide React, Cormorant Garamond y Manrope. El catálogo y el contenido son módulos JavaScript; carrito y checkout persisten borradores en `localStorage`.

Funcionalidades comprobadas: home editorial, catálogo, producto, buscador tolerante, carrito accesible, checkout de cuatro pasos preparado, responsive, SEO, assets reales optimizados y configuración Netlify.

Código y recursos reutilizados: toda la superficie pública, el catálogo, el manifiesto de assets, las imágenes reales, el carrito, buscador, checkout, router, tests, SEO y estilos aprobados.

Límites actuales: precios y stock permanecen pendientes, el checkout no crea pedidos ni procesa pagos y no existe conexión con Firestore. Se conserva esta honestidad para no simular comercio real.

## Diferencias y decisión

La web aporta la base React/Vite y la experiencia pública; Stock y Ventas aporta el dominio transaccional. La nueva aplicación separa ambas superficies por ruta, comparte Firebase y prepara un catálogo maestro. Los dos repositorios originales y sus sitios Netlify quedan intactos.
