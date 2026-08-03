# Flor Mía · Plataforma integral

Aplicación web única para la tienda pública y la gestión privada de Flor Mía. Integra el diseño y contenido aprobado de `flor-mia-web-fiel-v3` con la lógica comprobada de `FM-stock-y-ventas`, sin modificar ninguno de esos dos sistemas productivos.

- Producción: <https://app-integral-fm.netlify.app/>
- Gestión: <https://app-integral-fm.netlify.app/gestion>
- Repositorio: <https://github.com/AgustinBazanUB/App-Integral-FM>

## Qué incluye

- Superficie pública en `/`: home, catálogo, buscador, producto, carrito y checkout preparado.
- Superficie privada en `/gestion`: autenticación real, navegación por permisos y 12 módulos.
- Ubicaciones: locales/ferias, estado operativo y stock por ubicación.
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

La tienda se abre en `http://localhost:5173/` y la gestión en `http://localhost:5173/gestion`.

## Verificar

```bash
npm test
npm run build
```

Las pruebas cubren catálogo, assets, búsqueda, permisos, pagos, descuentos, actividad de ubicaciones y prevención de stock negativo.

## Firebase

La configuración web pública se centraliza en `src/gestion/services/firebase.js` y admite reemplazo por variables `VITE_FIREBASE_*`. El ejemplo está en `.env.example`. No se incluyen claves privadas, cuentas de servicio ni credenciales fiscales.

La plataforma usa el proyecto Firebase separado `app-integral-fm`. El sistema anterior continúa usando `fm-stock-y-venta`; sus reglas, índices, configuración y datos no fueron modificados. Las reglas de `firestore.rules` y los índices de `firestore.indexes.json` están desplegados exclusivamente en la base nueva. La separación y el estado de la copia están documentados en `docs/MIGRACION.md`.

## Netlify

`netlify.toml` configura el build Vite, navegación SPA, caché y cabeceras de seguridad. Cada push a la rama principal del repositorio integral puede publicar producción; las ramas generan Preview Deploys.

## Documentación

- [Auditoría de los proyectos](docs/AUDITORIA.md)
- [Arquitectura, rutas y permisos](docs/ARQUITECTURA.md)
- [Modelo de datos Firestore](docs/FIRESTORE-MODEL.md)
- [Separación y estrategia de migración](docs/MIGRACION.md)
- [Manual de administrador](docs/MANUAL-ADMINISTRADOR.md)
- [Manual de vendedores](docs/MANUAL-VENDEDORES.md)
- [Datos y credenciales pendientes](docs/PENDIENTES.md)
- [Decisiones técnicas](docs/DECISIONES.md)
- [Backlog](docs/BACKLOG.md)
- [Sistema visual original](docs/FLOR-MIA-DESIGN-SYSTEM.txt)
- [Especificación funcional original](docs/ESPECIFICACION-FUNCIONAL.txt)

## Estado honesto de integraciones

La app no procesa pagos online, no emite comprobantes ARCA, no envía mensajes ni automatiza redes. Esas interfaces están preparadas y documentadas; se activarán únicamente al recibir proveedores, credenciales y reglas comerciales reales.

