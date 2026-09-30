# Desarrollo local y traslado de ARCA a otra PC

Esta guía corresponde a la rama que integra Marketing y ARCA. El repositorio
produce dos superficies: Gestión (incluye Marketing y las Netlify Functions de
ARCA) y E-commerce público (sin Functions administrativas). Ver también
[Superficies y despliegues](DEPLOYMENT-SURFACES.md) y
[la integración ARCA](arca-integration.md).

## Qué se puede hacer sin créditos de build/deploy de Netlify

`npm run build`, los tests y `netlify dev` se ejecutan en la PC. `netlify dev`
sirve la app, redirects y Functions en `http://localhost:8888`; no publica un
deploy. Las consultas reales a ARCA y Firestore sí ocurren si se usan sus
controles: trabajar localmente no convierte las operaciones fiscales en una
simulación. El estado de CAE depende de los gates descritos abajo.

Un deploy remoto de Netlify es una operación distinta y puede consumir créditos
según el plan. Mantener **Stopped builds** en los sitios conectados al repositorio
evita los builds automáticos por push. No ejecutar `netlify deploy`,
`netlify deploy --prod` ni `netlify build --context production` durante el ciclo
local. Tampoco hacer merge a la rama que publica automáticamente sin revisar el
estado de los builds. **No confiar en `[skip netlify]` como bloqueo**: un push de
esta integración llegó a crear un Deploy Preview. Comprobar `Stopped builds` en
**ambos** sitios Netlify es el control efectivo.

## Copiar el trabajo a la otra PC

1. Instalar Git, Node.js 20 o superior, Java 21 o superior para el emulador de
   reglas, OpenSSL y Netlify CLI. Verificar `git --version`, `node --version`,
   `npm --version`, `java -version` y `openssl version`.
2. En la PC nueva, actualizar el repositorio desde GitHub. Si hay cambios
   locales, revisarlos y preservarlos antes de cambiar de rama. Usar el nombre
   de la rama integrada `codex/arca-marketing-ecommerce-split`:

   ```bash
   git clone https://github.com/AgustinBazanUB/App-Integral-FM.git App-Integral-FM
   cd App-Integral-FM
   git fetch origin
   git switch --track origin/codex/arca-marketing-ecommerce-split
   npm ci
   npm test
   npm run build:gestion
   npm run build:ecommerce
   ```

   Si la otra PC ya tiene un checkout, usar `git status --short`, guardar
   cualquier cambio local y luego `git fetch origin` + `git switch` a la rama
   integrada. No copiar `node_modules` ni `dist`; `npm ci` los reconstruye.
3. Trasladar por un medio privado los archivos locales necesarios, **fuera del
   repositorio**. Para producción: certificado `.pem`/`.crt`, private key que
   corresponde a ese certificado, archivo con la clave de cifrado del TA, y
   credencial JSON de Firebase Admin. Llevar también el launcher local, que
   contiene rutas y datos del emisor; revisarlo antes de usarlo en la otra PC.
   No subir esos **archivos** a GitHub, a un deploy estático, a un issue ni a un
   chat. Las credenciales de producción que deban usar las Functions se cargan
   como variables secretas de Netlify, limitadas al contexto `production`; no
   copiar `.env` con secretos dentro del proyecto.
4. La clave `ARCA_TA_ENCRYPTION_KEY` **debe ser la misma para el mismo entorno y
   emisor** si se quiere reutilizar el TA ya cifrado en Firestore. No usar la
   clave de homologación en producción. Si la otra PC conserva un certificado
   o una clave TA anterior, comparar cuidadosamente cuál perfil corresponde
   antes de arrancar; no sobrescribir a ciegas.
5. Comprobar que el certificado productivo corresponde a su private key sin
   imprimirlas:

   ```bash
   openssl x509 -noout -modulus -in flor-mia-produccion.pem | openssl sha256
   openssl rsa -noout -modulus -in flor-mia-produccion.key | openssl sha256
   ```

   Los hashes deben coincidir. Comprobar vigencia con
   `openssl x509 -in flor-mia-produccion.pem -noout -dates`.

## Launcher local y controles fiscales

El launcher de producción debe cargar desde archivos externos al repositorio:
`ARCA_CERTIFICATE_PEM`, `ARCA_PRIVATE_KEY_PEM`, `ARCA_TA_ENCRYPTION_KEY`,
`FIREBASE_ADMIN_CLIENT_EMAIL` y `FIREBASE_ADMIN_PRIVATE_KEY`. Ajustar sus rutas
absolutas a la PC nueva; conservar el CUIT, punto de venta productivo, condición
de IVA y datos reales del emisor. Mantener un launcher aparte para homologación,
con su propio certificado, private key y clave TA. El certificado de producción
no debe usarse como certificado de homologación.

Estado seguro para abrir Gestión y revisar Marketing/ARCA sin emitir:

```bash
export ARCA_ENVIRONMENT="production"
export ARCA_ALLOW_CAE_HOMOLOGATION="false"
export ARCA_ALLOW_PRODUCTION_READONLY="false"
export ARCA_ALLOW_PRODUCTION_INVOICE_PREPARE="false"
export ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP="false"
export ARCA_ALLOW_PRODUCTION_CAE="false"
export ARCA_AUTO_AUTHORIZE_PRODUCTION="false"
export ARCA_AUTO_AUTHORIZE_PRODUCTION_SOURCES="admin_quick_sale"
export ARCA_PRODUCTION_CAE_SALE_CODE=""
```

No poner private keys, Token, Sign ni `ARCA_TA_ENCRYPTION_KEY` literal en el
launcher. Leerlos desde los archivos locales y comprobar sólo presencia; evitar
`echo` de las variables. La factura automática exige gates adicionales y puede
emitir un comprobante real: no habilitarla como parte del traslado o de una
prueba de UI. Mantener el launcher de homologación también con
`ARCA_ALLOW_CAE_HOMOLOGATION=false`.

Las Functions de Marketing usan además `FIREBASE_SERVICE_ACCOUNT_JSON` para
acceder a Firestore desde el servidor y `OPENAI_API_KEY` para las funciones de
IA. El launcher de la otra PC debe cargar el JSON desde su archivo privado;
`FIREBASE_ADMIN_CLIENT_EMAIL` y `FIREBASE_ADMIN_PRIVATE_KEY` por sí solos no
alimentan ese módulo de Marketing. La conexión de Google Drive requiere también
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` y
`GOOGLE_TOKEN_ENCRYPTION_KEY`; si no están configuradas, esa función mostrará
que Drive no está disponible. No copiar esos secretos al repositorio.

## Ejecutar y comprobar localmente

Desde el repositorio, tras cargar el launcher seguro:

```bash
npm ci
npm test
npm run build:gestion
npm run build:ecommerce
npx netlify-cli@latest dev --no-open
```

Abrir `http://localhost:8888/gestion/settings`. Verificar que el entorno y los
gates mostrados sean los esperados antes de usar controles fiscales. Las
Functions ARCA y la credencial Firebase Admin se cargan sólo en el proceso
local. El sitio público de E-commerce se puede revisar con
`npm run dev:ecommerce`; allí no se publican las Functions de Gestión.

Para probar reglas de Firestore se necesita Java 21 o superior:

```bash
npx firebase-tools emulators:exec --only firestore --project demo-flor-mia-integral "npm run test:rules"
```

Si el TA compartido no puede descifrarse en la nueva PC, detener las pruebas
autenticadas: revisar que se copió la clave correcta del mismo entorno y emisor.
No generar otra clave para “arreglar” un TA vigente ni repetir una autorización
fiscal. Si se usa Firestore real, las operaciones de venta o facturación local
afectan datos reales aunque la app esté en `localhost`.

## Publicar al final

La gestión y el E-commerce son **dos sitios Netlify**. Un único deploy puede
actualizar uno de ellos; actualizar ambos requiere dos deploys. El sitio de
Gestión actual es [`appintegralflormia`](https://app.netlify.com/projects/appintegralflormia)
y conserva el build unificado `npm run build` en `dist`. Para publicar allí una
sola vez con el artefacto construido localmente, preparar `dist` y las Functions
con el CLI actual. El procedimiento comprobado en esta PC fue:

```bash
npx netlify-cli@latest build --context production
npx netlify-cli@latest deploy --prod --no-build --dir dist \
  --site 8b6e2130-3336-4f04-9ab8-a58dffd96bf7
```

El primer comando **sólo construye localmente** y lee las variables del sitio;
el segundo **sí publica** y puede consumir créditos. Ejecutarlo únicamente al
cerrar una entrega. El CLI actual preparó ocho Functions en el modo moderno de
Netlify. Un intento anterior con CLI 26.1.0 falló antes de publicar por el
límite de variables de 4 KB; no cambiar las Functions ni reducir secretos para
sortear ese error sin revisar primero la versión del CLI. Confirmar antes los
secretos server-side de ARCA/Firebase y, para las operaciones server-side de
Marketing, `FIREBASE_SERVICE_ACCOUNT_JSON` y sus demás variables necesarias.
Confirmar todos los gates fiscales en `false`; verificar login, Marketing y
rutas ARCA después de publicar. Cambiar variables del sitio requiere otro build
y deploy para aplicarlas. La futura separación exclusiva de Gestión usaría
`build:gestion` y `dist/gestion`, pero requiere cambiar la configuración del
sitio de manera coordinada. Para el E-commerce usar `build:ecommerce`, `dist/ecommerce` y
`deploy/ecommerce/functions` vacío; no copiar secretos de ARCA ni Firebase
Admin. La publicación cloud nunca debe depender del launcher local.

Documentación oficial: [Netlify Dev](https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/),
[detener builds](https://docs.netlify.com/build/configure-builds/stop-or-activate-builds/)
y [crear deploys](https://docs.netlify.com/deploy/create-deploys/).
