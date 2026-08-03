# Estrategia de migración

## Principio

Los repositorios y sitios actuales continúan productivos hasta que la plataforma integral supere pruebas de autenticación, reglas, ventas, stock, concurrencia, responsive y despliegue. No hay iframes ni duplicación deliberada de ventas o stock.

## Etapas

1. Inventario y backup exportable de Firestore; registrar reglas e índices actuales.
2. Crear usuarios piloto y permisos sin alterar roles legacy.
3. Ejecutar la plataforma contra emuladores con una copia anonimizada de estructura.
4. Validar lectura compatible de `users`, `locations`, `products`, `locationStock`, `sales` y `stockMovements`.
5. Probar ventas concurrentes, falta de stock, corte de red, anulación y restauración.
6. Publicar reglas integrales en una ventana controlada y ejecutar smoke tests del sistema legacy y el integral.
7. Activar Ubicaciones para un grupo piloto; mantener el sitio anterior disponible como rollback.
8. Habilitar colecciones nuevas módulo por módulo.
9. Conectar catálogo público a Firestore sólo después de cargar precios, stock y reglas comerciales reales.
10. Retirar el sistema anterior únicamente con aceptación y exportación final.

## Rollback

Restaurar reglas e índices versionados, volver el tráfico al sitio anterior y detener escrituras integrales nuevas. Las colecciones nuevas son aditivas; no cambian IDs legacy ni eliminan documentos existentes.

## Validaciones obligatorias

- Regla denegada para usuario sin módulo/ubicación.
- Vendedor sin capacidad de crear ubicaciones o leer finanzas.
- Stock nunca negativo bajo dos ventas simultáneas.
- Anulación con devolución completa y movimiento.
- DNI y contacto no visibles sin permiso sensible.
- Navegación mobile sin scroll horizontal.
- Preview Deploy de Netlify antes de producción.
