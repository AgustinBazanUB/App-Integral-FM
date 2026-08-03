# Separación y estrategia de migración

## Entornos independientes

| Uso | Proyecto Firebase | Región | Estado |
| --- | --- | --- | --- |
| FM Stock y Ventas | `fm-stock-y-venta` | `southamerica-east1` | Productivo, sin cambios |
| App Integral FM | `app-integral-fm` | `southamerica-east1` | Independiente y activo |

Ambas bases tienen identificadores, reglas, índices, Authentication y configuración web diferentes. Una escritura de App Integral FM no puede modificar la base utilizada por FM Stock y Ventas.

## Copia inicial del 3 de agosto de 2026

- Se leyó el proyecto `fm-stock-y-venta` sin realizar escrituras.
- Se copiaron 3.749 documentos, distribuidos en 17 rutas de colección y subcolección.
- Se conservaron rutas, IDs, tipos de Firestore y referencias entre documentos, adaptando estas últimas al proyecto nuevo.
- Una segunda lectura comparó la huella de cada documento: 3.749 de origen y 3.749 de destino, sin faltantes ni diferencias.
- Se migraron 12 usuarios de Firebase Authentication conservando UID y contraseña.
- El archivo temporal con hashes de contraseña fue eliminado después de la importación y nunca se agregó a Git.
- La base nueva tiene protección contra borrado habilitada.
- Correo electrónico/contraseña está habilitado y `app-integral-fm.netlify.app` es un dominio autorizado.

## Reglas e índices

Las reglas integrales y la unión de índices antiguos+nuevos están desplegadas únicamente en `app-integral-fm`. No se desplegó ningún cambio sobre `fm-stock-y-venta`.

## Operación mientras conviven ambos sistemas

La copia inicial es una fotografía de los datos, no una sincronización en tiempo real. Mientras FM Stock y Ventas continúe siendo el sistema donde se registran ventas, sus nuevas ventas no aparecerán automáticamente en App Integral FM.

Antes de hacer una segunda importación se debe definir una estrategia unidireccional y sin conflictos. La recomendación es copiar sólo documentos nuevos de `sales` y `stockMovements`, y luego recalcular stock en el destino. No se debe sobrescribir de forma indiscriminada `users`, permisos, configuraciones o documentos modificados desde App Integral FM.

El script `scripts/clone-firestore.mjs` está diseñado para la carga inicial sobre una base vacía: usa la condición `exists: false`, no elimina documentos y se detiene si encuentra datos previos. Esta protección evita sobrescrituras accidentales y no debe retirarse para una sincronización periódica.

## Rollback

El rollback consiste en mantener FM Stock y Ventas operativo y detener escrituras en App Integral FM. Como los proyectos están separados, no es necesario restaurar reglas ni datos del sistema anterior.

## Validaciones realizadas

- Igualdad de conteos y contenido para documentos y subcolecciones.
- Reglas denegadas para usuarios sin módulo o ubicación.
- Vendedor sin capacidad de administrar ubicaciones ni leer finanzas.
- Stock negativo bloqueado.
- Reglas e índices compilados y desplegados en el destino.
- Usuarios migrados y proveedor de correo/contraseña habilitado.
- Dominio productivo de Netlify autorizado.

