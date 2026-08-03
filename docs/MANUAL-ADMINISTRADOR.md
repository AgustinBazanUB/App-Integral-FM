# Manual de administrador

## Primer acceso

1. Ingresar en `/gestion` con una cuenta existente de FM Stock y Ventas; las 12 cuentas y sus UID fueron migrados.
2. Confirmar que el perfil clonado `users/{uid}` tenga `active: true` y el rol esperado.
3. Si se necesita una cuenta nueva, crearla desde el módulo Usuarios de App Integral FM.

## Orden recomendado

1. Revisar Configuración y el proyecto Firebase indicado.
2. Abrir **Ubicaciones y eventos** y crear el punto operativo con nombre, tipo, prefijo, regla de DNI y fechas si corresponde.
3. Abrir la ubicación: en **Productos** aparecerá automáticamente el catálogo maestro; “Sin configurar” significa stock local cero, no un producto duplicado.
4. En **Cargar stock**, elegir entre stock inicial, agregar mercadería o ajustar inventario. Las reducciones requieren confirmación y toda operación deja movimientos auditables.
5. En **Vendedores**, asignar cuentas existentes. En **Descuentos**, habilitar únicamente definiciones maestras vigentes.
6. Probar una Venta Rápida controlada y comprobar venta, stock, movimiento y actividad.
7. Revisar el panel mensual y el análisis ampliado antes de habilitar la operación habitual.

## Usuarios

“Nuevo usuario” crea la cuenta con una app Firebase secundaria y no cierra la sesión del administrador. La contraseña temporal no se guarda. Desactivar aplica una baja lógica al perfil; no elimina Authentication ni el historial.

## Seguridad

Las reglas integrales sólo deben publicarse en `app-integral-fm`; nunca seleccionar `fm-stock-y-venta` al desplegarlas. No cargar claves privadas, credenciales fiscales ni tokens de proveedores en formularios o Firestore. Ante una diferencia de stock, detener ventas en App Integral FM y revisar `stockMovements` antes de ajustar.

