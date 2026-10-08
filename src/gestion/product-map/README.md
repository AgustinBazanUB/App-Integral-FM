# Product Map — referencia adyacente al código

Este directorio es **documentación adyacente a `src/`**. No se importa desde la aplicación y no altera el runtime.

Su objetivo es ofrecer a diseñadores, ChatGPT/Codex y desarrolladores un punto estable desde el cual relacionar los IDs del FM Master Map con el código real.

- `moduleRegistry.json`: índice de módulos y entry points principales.

## Regla

No crear aquí una segunda implementación de servicios, dominio, permisos o datos.

Las implementaciones reales siguen viviendo en sus carpetas actuales (`pages`, `services`, `customers`, `marketing`, `modules`, etc.). Este directorio únicamente las referencia para mantener trazabilidad Diseño ↔ Código.