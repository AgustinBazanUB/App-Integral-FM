# Firebase de pruebas

El entorno remoto aislado para desarrollo es el proyecto Firebase `app-integral-fm-pruebas` (alias de CLI `staging`). Su Cloud Firestore `(default)` está en `southamerica-east1` (São Paulo), igual que producción. El proyecto conserva el plan Spark y la base comienza vacía: no se copiaron ventas, clientes, usuarios ni inventario reales.

## Reglas e índices

Las reglas se despliegan desde el mismo `firestore.rules` que usa producción. Los 36 índices compuestos también coinciden con `firestore.indexes.json`. En la configuración de staging, las dos políticas TTL (`shipmentAccess.expiresAt` y `shippingRateLimits.expiresAt`) están apagadas; Cloud Firestore requiere facturación Blaze para borrar documentos por TTL. Se mantiene la exclusión de índices sobre esos campos. Por eso, los registros temporales vencidos en staging no se eliminan automáticamente.

Para publicar cambios de reglas e índices en staging:

```powershell
npx firebase-tools deploy --only firestore --project staging --config firebase.staging.json
```

`staging` es un alias explícito en `.firebaserc`; `default` sigue siendo `app-integral-fm` (producción). Verificá el destino del proyecto antes de ejecutar cualquier despliegue. No uses `--project default` para probar.

## Conexión de la aplicación

El backend ahora permite únicamente los proyectos conocidos de producción o staging, exige que el proyecto cliente y servidor coincidan, y verifica que la cuenta de servicio pertenezca al proyecto elegido. La aplicación también se niega a iniciar con una configuración de staging incompleta o mezclada con los valores conocidos de producción.

El Deploy Preview todavía no está conectado: sus variables de Firebase siguen apuntando a producción. Para activarlo hay que registrar una app web en el proyecto de pruebas y cargar su configuración `VITE_FIREBASE_*`, además de guardar una cuenta de servicio exclusiva de staging como secreto limitado al contexto Deploy Preview en Netlify. No reutilices la clave privada productiva ni crees ventas desde la preview hasta terminar esa conexión.

La consola del proyecto está en <https://console.firebase.google.com/project/app-integral-fm-pruebas/overview>.
