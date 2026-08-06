# Flor Mía · Plataforma integral

Aplicación web única para la tienda y la gestión privada de Flor Mía. Integra el diseño y contenido aprobado de `flor-mia-web-fiel-v3` con la lógica comprobada de `FM-stock-y-ventas`, sin modificar ninguno de esos dos sistemas productivos.

- Acceso inicial: <https://app-integral-fm.netlify.app/>
- Gestión: <https://app-integral-fm.netlify.app/gestion>
- Vista de tienda para administradores: <https://app-integral-fm.netlify.app/tienda>
- Repositorio: <https://github.com/AgustinBazanUB/App-Integral-FM>

## Qué incluye

- Acceso inicial privado en `/`, con autenticación persistente y navegación según permisos.
- Superficie de tienda en `/tienda`: home, catálogo, buscador, producto, carrito y checkout preparado; su vista requiere una sesión de administrador.
- Superficie privada en `/gestion`: autenticación real, navegación por permisos y 12 módulos.
- Panel general con un único selector de período, formatos Año/Mes/Semana/Día, calendario adaptativo, filtro multiselección de ubicaciones y métricas sincronizadas.
- Ubicaciones y eventos: hasta cuatro ubicaciones fijadas, acceso rápido a stock y una vista operativa con Productos, Cargar stock, Vendedores y Descuentos.
- Productos por ubicación: creación desde el catálogo maestro, alcance local o global, categorías expandibles, configuración local y selector de imágenes incluidas en el proyecto.
- Stock por ubicación: validación de actividad, movimientos auditados, confirmación de reducciones y valores numéricos con contraste reforzado.
- Vendedores y descuentos: lista de asignados separada de disponibles, avatares e IDs de descuentos globales habilitados por ubicación.
- Catálogo maestro unido dinámicamente al stock local: los productos nuevos aparecen sin duplicarse y con stock cero hasta configurarlos.
- Ventas rápidas: carrito táctil, validación de stock y confirmación atómica en Firestore.
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

El acceso inicial se abre en `http://localhost:5173/`, la gestión en `http://localhost:5173/gestion` y la vista de tienda para administradores en `http://localhost:5173/tienda`.

## Verificar

```bash
npm test
npm run build
```

Las pruebas cubren catálogo, assets, búsqueda, permisos, pagos, descuentos, períodos en hora argentina, métricas sin duplicados, siete días completos, catálogo maestro, prevención de stock negativo, acceso inicial persistente, mejoras operativas de Ubicaciones, selector anual/mensual/semanal/diario, semanas de lunes a domingo y filtros de ubicaciones autorizadas.

Para validar reglas con el emulador (requiere Java 21 o superior):

```bash
npx firebase-tools emulators:exec --only firestore --project demo-flor-mia-integral "npm run test:rules"
```

## Firebase

La configuración web pública se centraliza en `src/gestion/services/firebase.js` y admite reemplazo por variables `VITE_FIREBASE_*`. El ejemplo está en `.env.example`. No se incluyen claves privadas, cuentas de servicio ni credenciales fiscales.

La plataforma usa el proyecto Firebase separado `app-integral-fm`. El sistema anterior continúa usando `fm-stock-y-venta`; sus reglas, índices, configuración y datos no fueron modificados. Las reglas de `firestore.rules` y los índices de `firestore.indexes.json` están desplegados exclusivamente en la base nueva. La separación y el estado de la copia están documentados en `docs/MIGRACION.md`.

## Netlify

`netlify.toml` configura el build Vite, navegación SPA, caché y cabeceras de seguridad. Cada push a la rama principal del repositorio integral puede publicar producción; los Pull Requests generan Deploy Previews para validar los cambios antes del merge.

## Documentación

- [Auditoría de los proyectos](docs/AUDITORIA.md)
- [Arquitectura, rutas y permisos](docs/ARQUITECTURA.md)
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
- [Backlog](docs/BACKLOG.md)
- [Sistema visual original](docs/FLOR-MIA-DESIGN-SYSTEM.txt)
- [Especificación funcional original](docs/ESPECIFICACION-FUNCIONAL.txt)

## Estado honesto de integraciones

La app no procesa pagos online, no emite comprobantes ARCA, no envía mensajes ni automatiza redes. Esas interfaces están preparadas y documentadas; se activarán únicamente al recibir proveedores, credenciales y reglas comerciales reales.
