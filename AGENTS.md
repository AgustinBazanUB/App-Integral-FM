# App Integral FM — Reglas del proyecto

Aplicación React 18 + Vite + Firebase (Auth + Firestore). Un solo frontend con
tres superficies: acceso inicial `/`, Panel Administrador `/gestion`, Panel
Vendedor `/vendedor` y tienda `/tienda`.

## Diseño

- **Cualquier trabajo de UI/frontend debe seguir la guía de diseño**: invocar el
  skill `flor-mia-design` antes de crear o modificar componentes, estilos o
  pantallas.
- Fuente de verdad visual: `docs/FLOR-MIA-DESIGN-SYSTEM.txt` (superficies
  privadas/admin) y `docs/flor-mia-web-design-spec-productos-mendocinos-v2.json`
  (tienda pública).
- Reutilizar tokens de `src/styles/tokens.css` / `src/styles/theme.css` y
  componentes de `src/design-system/`; no hardcodear valores de diseño.

## Comandos

- Dev server: `npm run dev` (Vite, http://localhost:5173, hot reload)
- Tests: `npm test`
- Tests de reglas Firestore: `npm run test:rules` (requiere emulador, Java 21+)
- Build: `npm run build`

## Convenciones

- Node 20+. Router propio en `src/router.jsx` (no react-router).
- Firebase config en `src/gestion/services/firebase.js` con fallbacks públicos;
  override por variables `VITE_FIREBASE_*`.
- Idioma del proyecto: español (es-AR) para UI, docs y comentarios.
