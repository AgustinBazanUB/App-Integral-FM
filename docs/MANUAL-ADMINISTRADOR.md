# Manual de administrador

## Primer acceso

1. Ingresar en `/gestion` con una cuenta existente de FM Stock y Ventas; las 12 cuentas y sus UID fueron migrados.
2. Confirmar que el perfil clonado `users/{uid}` tenga `active: true` y el rol esperado.
3. Si se necesita una cuenta nueva, crearla desde el módulo Usuarios de App Integral FM.

## Orden recomendado

1. Revisar Configuración y el proyecto Firebase indicado.
2. Crear ubicaciones con nombre, tipo, prefijo y regla de DNI.
3. Confirmar productos y stock de la copia inicial antes de registrar operaciones nuevas.
4. Crear usuarios y asignar rol/ubicaciones.
5. Probar una venta controlada y comprobar venta, stock y movimiento.
6. Revisar los módulos nuevos y asignar permisos explícitos cuando corresponda.

## Usuarios

“Nuevo usuario” crea la cuenta con una app Firebase secundaria y no cierra la sesión del administrador. La contraseña temporal no se guarda. Desactivar aplica una baja lógica al perfil; no elimina Authentication ni el historial.

## Seguridad

Las reglas integrales sólo deben publicarse en `app-integral-fm`; nunca seleccionar `fm-stock-y-venta` al desplegarlas. No cargar claves privadas, credenciales fiscales ni tokens de proveedores en formularios o Firestore. Ante una diferencia de stock, detener ventas en App Integral FM y revisar `stockMovements` antes de ajustar.

