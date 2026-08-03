# Manual de administrador

## Primer acceso

1. Activar Email/Password en Firebase Authentication.
2. Crear el primer usuario desde Firebase Console.
3. Crear `users/{uid}` con `name`, `email`, `role: "admin"`, `active: true` y `allowedLocationIds: []`.
4. Ingresar en `/gestion`.

## Orden recomendado

1. Revisar Configuración y el proyecto Firebase indicado.
2. Crear ubicaciones con nombre, tipo, prefijo y regla de DNI.
3. Confirmar productos y stock desde el sistema legacy durante la migración.
4. Crear usuarios y asignar rol/ubicaciones.
5. Probar una venta controlada y comprobar venta, stock y movimiento.
6. Revisar módulos nuevos sólo después de validar/publicar reglas v2.

## Usuarios

“Nuevo usuario” crea la cuenta con una app Firebase secundaria y no cierra la sesión del administrador. La contraseña temporal no se guarda. Desactivar aplica una baja lógica al perfil; no elimina Authentication ni el historial.

## Seguridad

No publicar reglas directamente sin seguir `MIGRACION.md`. No cargar claves privadas, credenciales fiscales ni tokens de proveedores en formularios o Firestore. Ante una diferencia de stock, detener ventas y revisar `stockMovements` antes de ajustar.
