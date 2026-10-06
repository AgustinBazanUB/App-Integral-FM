# Flor Mía · Plataforma integral

Repositorio único para la tienda y la gestión integral de Flor Mía, con builds independientes para publicar cada superficie en un sitio distinto. Integra el diseño y contenido aprobado de `flor-mia-web-fiel-v3` con la lógica comprobada de `FM-stock-y-ventas`, sin modificar esos sistemas productivos anteriores.

- Acceso inicial: <https://appintegralflormia.netlify.app/>
- Gestión: <https://appintegralflormia.netlify.app/gestion>
- Panel Vendedor: <https://appintegralflormia.netlify.app/vendedor>
- Vista de tienda para administradores: <https://appintegralflormia.netlify.app/tienda>
- Repositorio: <https://github.com/AgustinBazanUB/App-Integral-FM>

## Qué incluye

- Acceso inicial privado en `/`, con autenticación persistente y navegación según rol y permisos.
- Superficie de tienda en `/tienda`: home, catálogo, buscador, producto, carrito y checkout preparado; su vista requiere una sesión de administrador.
- Panel Administrador en `/gestion`: autenticación real, navegación por permisos y 12 módulos.
- Panel Vendedor en `/vendedor`: acceso automático para vendedores puros y cambio de panel para administradores sin cerrar sesión.
- Panel Vendedor conectado a las ubicaciones reales: productos por categoría, stock local, precios, descuentos habilitados, carrito, botonera Bluetooth y ventas del día.
- Pagos simples y `+2 pagos`, con validación exacta de importes enteros y al menos dos medios.
- Ventas pendientes en IndexedDB, sincronización idempotente, estados de error y reserva local de unidades en el dispositivo.
- Alta, edición y anulación de ventas mediante transacciones que actualizan venta, stock, movimientos y auditoría.
- Panel general con un único selector de período, formatos Año/Mes/Semana/Día, calendario adaptativo, filtro multiselección de ubicaciones y métricas sincronizadas.
- Ubicaciones y eventos: hasta cuatro ubicaciones fijadas, acceso rápido a stock y una vista operativa con Productos, Cargar stock, Vendedores y Descuentos.
- Productos por ubicación: creación desde el catálogo maestro, alcance local o global, categorías expandibles, configuración local y selector de imágenes incluidas en el proyecto.
- Stock por ubicación: validación de actividad, movimientos auditados, confirmación de reducciones y valores numéricos con contraste reforzado.
- Vendedores y descuentos: lista de asignados separada de disponibles, avatares e IDs de descuentos globales habilitados por ubicación.
- Catálogo maestro unido dinámicamente al stock local: los productos nuevos aparecen sin duplicarse y con stock cero hasta configurarlos.
- Usuarios: creación en Firebase Authentication con una app secundaria, roles, ubicaciones y baja lógica.
- Design system Flor Mía: tokens CSS, componentes compartidos, responsive y WCAG 2.2 AA.
- PWA instalable, SPA de Netlify, cabeceras de seguridad, caché y CI.
- Firebase independiente para App Integral FM, con datos y usuarios clonados desde el sistema anterior.
- Reglas e índices integrales desplegados únicamente en la base nueva.

## Requisitos

- Node.js 20 o superior.
- Un usuario existente en Firebase Authentication con documento `users/{uid}` activo.
- Para publicar reglas: Firebase CLI y validación previa en emuladores.

## Ejecutar

```bash
npm install
npm run dev
```

Builds separados:

```bash
npm run dev:gestion
npm run dev:ecommerce
npm run build:gestion
npm run build:ecommerce
```

El acceso inicial se abre en `http://localhost:5173/`, la gestión en `http://localhost:5173/gestion`, el Panel Vendedor en `http://localhost:5173/vendedor` y la vista de tienda para administradores en `http://localhost:5173/tienda`.

## Verificar

```bash
npm test
npm run build
```

Las pruebas cubren catálogo, assets, búsqueda, permisos, pagos, descuentos, períodos en hora argentina, métricas sin duplicados, siete días completos, catálogo maestro, control del stock negativo permitido en ubicaciones y bloqueo en depósitos, acceso inicial persistente, mejoras de Ubicaciones, filtros del Panel General, acceso por rol al Panel Vendedor, ubicaciones efectivas, carrito, botonera, pagos múltiples, offline, idempotencia, transacciones de venta, edición, anulación y responsive.

Para validar reglas con el emulador (requiere Java 21 o superior):

```bash
npx firebase-tools emulators:exec --only firestore --project demo-flor-mia-integral "npm run test:rules"
```

## Firebase

La configuración web pública se centraliza en `src/gestion/services/firebase.js` y admite reemplazo por variables `VITE_FIREBASE_*`. El ejemplo está en `.env.example`. No se incluyen claves privadas, cuentas de servicio ni credenciales fiscales.

La plataforma usa el proyecto Firebase separado `app-integral-fm`. El sistema anterior continúa usando `fm-stock-y-venta`; sus reglas, índices, configuración y datos no fueron modificados. Las reglas de `firestore.rules` y los índices de `firestore.indexes.json` están desplegados exclusivamente en la base nueva. La separación y el estado de la copia están documentados en `docs/MIGRACION.md`.

## Netlify

`netlify.toml` conserva el despliegue unificado durante la transición. El [preview separado de E-commerce](https://flor-mia-ecommerce-preview.netlify.app/) usa el build público; su configuración, verificación y límites están en [Superficies y despliegues](docs/DEPLOYMENT-SURFACES.md). Gestión sigue en el sitio existente hasta completar su migración. Durante el desarrollo local de ARCA, los builds automáticos de Netlify deben permanecer detenidos; las pruebas se hacen con Netlify Dev en la PC.

## Documentación

- [Auditoría de los proyectos](docs/AUDITORIA.md)
- [Arquitectura, rutas y permisos](docs/ARQUITECTURA.md)
- [Superficies, despliegues y contrato e-commerce](docs/DEPLOYMENT-SURFACES.md)
- [Desarrollo local y traslado de ARCA a otra PC](docs/DESARROLLO-LOCAL-Y-TRASLADO-ARCA.md)
- [Integración ARCA](docs/arca-integration.md)
- [Modelo de datos Firestore](docs/FIRESTORE-MODEL.md)
- [Separación y estrategia de migración](docs/MIGRACION.md)
- [Manual de administrador](docs/MANUAL-ADMINISTRADOR.md)
- [Manual de vendedores](docs/MANUAL-VENDEDORES.md)
- [Datos y credenciales pendientes](docs/PENDIENTES.md)
- [Decisiones técnicas](docs/DECISIONES.md)
- [Correcciones del panel y Ubicaciones](docs/CORRECCIONES-PANEL-UBICACIONES.md)
- [Versión 1.1 · Envío 1: acceso inicial y sesión](docs/versions/V1.1-LOGIN-INICIAL.md)
- [Versión 1.1 · Envío 2: mejoras de Ubicaciones](docs/versions/V1.1-MEJORAS-UBICACIONES.md)
- [Versión 1.1 · Envío 3: filtros del Panel General](docs/versions/V1.1-FILTROS-PANEL-GENERAL.md)
- [Versión 1.1 · Envío 4: Panel Vendedor](docs/versions/V1.1-PANEL-VENDEDOR.md)
- [Backlog](docs/BACKLOG.md)
- [Sistema visual original](docs/FLOR-MIA-DESIGN-SYSTEM.txt)
- [Especificación funcional original](docs/ESPECIFICACION-FUNCIONAL.txt)

## Estado honesto de integraciones

El E-commerce público aún no procesa pagos ni crea pedidos. Gestión incorpora la integración ARCA server-side para preparar, autorizar y verificar comprobantes fiscales cuando las credenciales y los gates del entorno están configurados. Las pruebas locales ya incluyeron comprobantes reales; un deploy cloud requiere configurar sus propios secretos y mantener los gates de emisión deshabilitados hasta validarlo. El recibo del Panel Vendedor es interno y no reemplaza un comprobante fiscal.

## Olivia · Asistente de Flor Mía

Integración de texto, dictado y voz para Administrador y Vendedor, con permisos verificados por backend, propuestas con confirmación visual, venta básica y carga de stock. [Arquitectura, configuración, despliegue y validación](docs/OLIVIA.md). [Auditoría de la Solución Propuesta](docs/OLIVIA-FUNCTIONAL-AUDIT.md).
