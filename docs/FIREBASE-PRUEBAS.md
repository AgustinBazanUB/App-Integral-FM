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

Este cambio crea y protege la base remota, pero no conecta todavía el Deploy Preview ni las Functions a ella. La configuración web de Netlify sigue apuntando a producción, y las Functions validan el proyecto productivo de forma explícita. No uses ese preview para hacer escrituras de prueba hasta separar también la configuración cliente y las credenciales/validación del backend. Esa conexión requiere registrar una aplicación web en el proyecto de pruebas y configurar una cuenta de servicio de staging con acceso limitado a ese proyecto; no reutilices la credencial privada de producción.

La consola del proyecto está en <https://console.firebase.google.com/project/app-integral-fm-pruebas/overview>.
