# Etapa 1 ARCA — checkpoint correctivo local

Fecha: 30/09/2026. Commit auditado inicial: `735478e3be28911978d22257da88e3fe7d1eeee1`; parent: `41f0c2b776fbd2a280c3bddf98adefe1affef5c5`.

## Alcance

Correcciones de los fallos reproducidos, sin features, apertura de emisión, cambios de secretos/gates, push, merge o deploy. El trabajo se hizo en checkout separado y detached. No se debe mover la rama remota para distribuir este checkpoint sin autorización posterior.

## Correcciones

1. Errores remotos: catálogo público de mensajes/códigos estáticos; texto, detalles, códigos y causas arbitrarias no se publican. Incluye fallos SOAP que podrían reflejar Token/Sign.
2. Configuración: PV válido entre 1 y 99999 y validación del cifrado WSAA Base64 de 32 bytes.
3. Clasificación: errores de configuración/certificado/autorización WSAA no se presentan como caídas temporales por su HTTP 5xx.
4. WSAA se comprueba antes de WSFE, por separado y sin retener el TA en el diagnóstico. Los errores de FEParamGetPtosVenta invalidan la comprobación aunque haya un PV en la respuesta.
5. Emisión: el readiness refleja el alcance manual por venta objetivo y el automático por PREPARE+CAE+AUTO+fuentes, sin modificar las comprobaciones del authorizer.
6. UI: PRODUCCIÓN/HOMOLOGACIÓN, NO VERIFICADO después de error, conservación del entorno anterior con aviso de datos anteriores, todos los impedimentos y separación de faltantes/indisponibilidad. Sin entorno conocido no se muestran paneles de homologación.
7. Rules: CAE/numeración/vínculo/estado fiscal del espejo de sales no pueden falsificarse desde el cliente. Se conserva creación normal con pending/not_requested y actualizaciones comerciales que no cambien campos fiscales.

## Evidencia ejecutada

- `node --test tests/arca*.test.mjs`: 94/94 PASS, Node 24 y Node 20. Incluye 13 reproducciones de auditoría ahora aprobadas y siete casos adicionales de readiness.
- `npm run build`: PASS. Advertencia previa de tamaño del chunk LoginPage.
- Emulador Firestore demo con firebase-tools 14.12.0: filtro obligatorio facturas fiscales/caché WSAA 2/2 PASS, locks fiscales 1/1 PASS y espejo fiscal 1/1 PASS.
- Suite Firestore completa: 17/19 PASS. Los dos fallos de venta/anulación por límite de 1000 expresiones se reprodujeron con las rules y tests originales: 16/18 PASS en el baseline. No se corrigieron por ser previos y ajenos a Etapa 1.
- Render original en 1280×900 y 390×844: estados operativo, datos faltantes, indisponibilidad y error completo; también actualización fallida después de éxito, conservando el entorno conocido.
- App completa local con Firebase Auth real y Netlify Functions: certificado, WSAA, WSFE, PV 3 y OAuth/lectura de Firestore correctos. El propio CUIT en Padrón no quedó validado ACTIVO. Faltan condición IVA y datos del emisor para PDF; el readiness informa NO OPERATIVO sin habilitar emisión.
- Configuración pública de homologación comparada con Netlify: entorno, CUIT, PV y cuenta de Firebase coinciden con el lanzador existente. Las claves/certificados se cargaron sólo desde los archivos locales existentes y no se mostraron ni cambiaron.
- GitHub Activity: el último push a feature/arca-integration fue el 29/09/2026 23:36:45 UTC, al parent esperado; sin movimientos al SHA auditado en el período consultado.
- Ambos proyectos Netlify tienen builds detenidos y sus últimos deploys son anteriores al commit auditado. No se creó ningún deploy para verificarlo.

## Repetir la validación

```bash
npm ci
node --test tests/arca*.test.mjs
npm run build
```

Desde Git Bash, con Java disponible:

```bash
npx firebase-tools@14.12.0 emulators:exec --only firestore --project demo-flor-mia-integral 'node --test --test-name-pattern="facturas fiscales|caché WSAA|locks fiscales|espejo fiscal" tests/firestore.rules.mjs'
```

La auditoría usó un runner externo en Windows para evitar la interpretación de `|` y comillas simples por cmd.exe, sin cambiar los tests.

Para la interfaz, usar el lanzador seguro existente de Netlify Dev offline, con las credenciales sólo en memoria. No ejecutar link/deploy, recuperar secretos write-only para publicarlos, ni activar gates. El proxy HTML de Netlify Dev tuvo un fallo de preamble React; la validación se completó sirviendo Vite directamente con proxy local `/.netlify/functions` hacia Netlify Dev. Es un ajuste del entorno temporal, no una modificación de netlify.toml o vite.config.js del producto.

## Límites del checkpoint

- No se ejecutó el commit corregido en cloud; no hay deploy por instrucción del usuario.
- Los secretos write-only de Netlify no se recuperaron ni se compararon byte a byte. La prueba real usa las copias locales existentes; coincide la configuración pública. Esa comparación de bytes no está aprobada ni se presume.
- No se certifica operatividad productiva con un certificado de producción, ni se completan aquí los datos fiscales faltantes. La pantalla productiva se validó con fixtures aislados; el ambiente real disponible es homologación.
- No hay acceso a logs directos de ARCA ni una prueba retrospectiva absoluta de toda emisión externa. La ausencia de CAE durante estas pruebas locales se comprueba con bloqueo de red en tests, stubs de emisión, inspección de rutas y registros locales de invocación sólo de arca-taxpayer.
- Un status fiscal read-only puede renovar tickets y leases de la caché WSAA. No modifica sales/invoices/sequence locks ni solicita FECAESolicitar.
- Las rules corregidas sólo fueron aplicadas al emulador; las rules desplegadas siguen sin cambios.

El cierre debe referirse al código corregido y la validación local descrita. No presentar este checkpoint como aprobación del runtime productivo o como correcciones ya publicadas.
