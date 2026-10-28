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

La app web `Flor Mia Deploy Preview` ya está registrada en el proyecto de pruebas. Configurá estas variables de build con alcance **Deploy Previews** en Netlify. Son datos públicos de configuración del SDK web; no contienen credenciales administrativas y deben crearse como variables normales, no como secretos:

| Variable | Valor |
| --- | --- |
| `VITE_PREVIEW_FIREBASE_API_KEY` | La clave web de la app `Flor Mia Deploy Preview` |
| `VITE_PREVIEW_FIREBASE_AUTH_DOMAIN` | `app-integral-fm-pruebas.firebaseapp.com` |
| `VITE_PREVIEW_FIREBASE_PROJECT_ID` | `app-integral-fm-pruebas` |
| `VITE_PREVIEW_FIREBASE_STORAGE_BUCKET` | `app-integral-fm-pruebas.firebasestorage.app` |
| `VITE_PREVIEW_FIREBASE_MESSAGING_SENDER_ID` | `545036860675` |
| `VITE_PREVIEW_FIREBASE_APP_ID` | `1:545036860675:web:c76e458afc8f8f706f7d36` |

Configurá también las siguientes variables con alcance **Functions** y contexto **Deploy Previews**. `FIREBASE_SERVICE_ACCOUNT_JSON` debe contener el JSON de la cuenta `netlify-deploy-preview-staging@app-integral-fm-pruebas.iam.gserviceaccount.com`; guardalo como secreto de Netlify, nunca en Git ni en una variable `VITE_*`. Esa cuenta tiene el rol `Cloud Datastore User` solamente en el proyecto de pruebas. `FIREBASE_WEB_API_KEY` es la clave web del proyecto de pruebas y permite que las Functions validen las sesiones de Firebase Auth.

| Variable | Valor |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `app-integral-fm-pruebas` |
| `FIREBASE_WEB_API_KEY` | La clave web de la app `Flor Mia Deploy Preview` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON privado de la cuenta de servicio exclusiva de staging |

El backend acepta el JSON de servicio de staging y rechaza credenciales cuyo proyecto no coincida. No reutilices la clave privada productiva ni crees ventas desde la preview hasta terminar la conexión y confirmar que el proyecto activo sea `app-integral-fm-pruebas`.

La consola del proyecto está en <https://console.firebase.google.com/project/app-integral-fm-pruebas/overview>.

## Producción y despliegue automático

El proyecto de producción `app-integral-fm` usa el plan Spark. Su archivo `firestore.indexes.json` mantiene los mismos índices compuestos y desactiva las políticas TTL de `shipmentAccess.expiresAt` y `shippingRateLimits.expiresAt`. La lógica de expiración sigue aplicándose, pero los documentos vencidos no se borran automáticamente. TTL administrado requiere facturación; no activar Blaze ni TTL sin aprobación.

El workflow `Deploy Firestore — main` verifica las reglas en emulador y despliega las reglas e índices de `main`. La cuenta del secreto `FIREBASE_SERVICE_ACCOUNT_APP_INTEGRAL_FM` necesita permisos para reglas y para administrar índices (`roles/datastore.indexAdmin`). No imprimir ni guardar el JSON de la cuenta en el repositorio.
