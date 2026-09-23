# Migración de productos, stock e imágenes desde FM-stock-y-ventas

## Objetivo

Esta rama copia el catálogo operativo y el stock del proyecto Firebase anterior `fm-stock-y-venta` hacia `app-integral-fm`, sin borrar datos exclusivos de la aplicación nueva.

## Reglas aplicadas

- Los productos existentes se emparejan por ID legado, ID del producto/código y nombre.
- Los productos que faltan se crean.
- El código histórico se conserva en `productCode` y, por compatibilidad, también en `abbreviation`.
- En la interfaz ese dato pasa a llamarse **ID del producto**.
- Las rutas `/assets/products/*` se reescriben a `/images/legacy-products/*`.
- Las imágenes del repositorio anterior se copian físicamente a la rama mediante GitHub Actions.
- El stock de una ubicación del sistema anterior cuyo nombre/tipo contenga “Depósito” se importa a `warehouses` + `warehouseStock`, no a `locations`.
- El resto se importa/mapea como ubicación de venta y su stock se escribe en `locationStock`.
- Las cantidades se establecen con el valor exacto de `currentStock`; no se suman.
- La ejecución es repetible: una nueva corrida vuelve a sincronizar contra la fuente y no duplica productos por nombre/código.

## Seguridad y trazabilidad

La migración no elimina productos, ubicaciones ni depósitos exclusivos de la aplicación nueva. Registra `legacySourceProductId`, `legacySourceLocationId`, un documento en `inventoryMigrations` y movimientos `legacy_migration_snapshot`.

La rama genera Deploy Preview de Netlify; no requiere merge para visualizar los cambios de interfaz.

## Credenciales

La escritura en `app-integral-fm` usa el service account ya previsto por los workflows del repositorio.

Para leer `fm-stock-y-venta` el workflow intenta, en este orden:

1. un service account legado en GitHub Secrets; o
2. email/contraseña de un administrador legado guardados en GitHub Secrets.

Si ninguna credencial de origen existe, el workflow no inventa stock: sincroniza imágenes, ejecuta tests/build y deja el estado `MIGRATION_SKIPPED_NO_SOURCE_AUTH` en el resumen de Actions.
