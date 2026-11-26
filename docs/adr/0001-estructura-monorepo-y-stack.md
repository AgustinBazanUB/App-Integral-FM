# ADR 0001 · Estructura del monorepo y stack

## Estado

Vigente (Inferido del código actual).

## Contexto

Flor Mía reúne una aplicación interna, una tienda web y el backend de ambas superficies. [package.json](../../package.json) declara un paquete npm con React 18, Vite 6, Firebase y comandos de build separados. [vite.config.js](../../vite.config.js) vincula el alias de superficie con el modo de compilación.

## Decisión

Mantener ambas superficies y las Netlify Functions en el mismo repositorio. El modo principal sirve una SPA unificada con entradas perezosas. Los modos gestión y ecommerce generan salidas separadas. Las vistas comparten el router, activos y contratos ES modules, y las Functions importan lógica de `src/shared/`.

Evidencia en [entrada](../../src/main.jsx), [superficies](../../src/surfaces), [código compartido](../../src/shared) y [configuración principal de Netlify](../../netlify.toml).

## Consecuencias

- El repositorio permite revisar juntos contratos, consumidores y cambios de build.
- Los límites de producto dependen de alias, router, portería, rutas y configuración de sitio. El paquete npm es común.
- El sitio aislado de tienda declara un directorio de Functions vacío. Su topología debe revisarse junto con el cliente HTTP.
- Los [mapas C4](../architecture/01-c4-maps.md) registran los tres modos y sus conexiones.
