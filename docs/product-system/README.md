# FM Product System

Este directorio documenta el diseño vivo de la aplicación integral de Flor Mía.

## Objetivo

Mantener sincronizadas cuatro capas:

1. **FigJam** — mapa maestro de producto, sistemas y relaciones.
2. **Figma** — pantallas, estados y diseño de interfaz.
3. **Docs** — especificación funcional y decisiones de producto.
4. **src/** — implementación real y referencias al código.

La regla de trabajo es:

`estado actual -> diseño deseado -> especificación -> implementación -> tests -> actualización del mapa`

## Artefactos visuales

- FigJam: https://www.figma.com/board/m7s3CTQ4mbiFF5fcCwpRP8
- Figma Design: https://www.figma.com/design/k5ElHZsMZVwtF3J6KxS61S

## Documentos

- `FM-MASTER-MAP.md`: arquitectura funcional general.
- `MODULE-STATUS.md`: estado real de cada módulo.
- `DESIGN-DECISIONS-v0.2.md`: decisiones tomadas durante la sesión de diseño.
- `CODE-MAP.md`: rutas de código principales.
- `modules/`: fichas por módulo.

## Fuente de verdad

Cuando exista conflicto:

- El **código** indica qué está implementado hoy.
- Los **docs de producto** indican qué comportamiento está aprobado como objetivo.
- Figma/FigJam representan visualmente ambos estados y deben distinguir `ACTUAL` de `PROPUESTO`.

No debe considerarse implementada una funcionalidad por el solo hecho de estar dibujada en Figma.