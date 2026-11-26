# ADR 0002 · Arquitectura API y modelo documental

## Estado

Vigente (Inferido del código actual).

## Contexto

Gestión consulta y modifica recursos con Firebase SDK. Facturación, checkout, envíos, fusiones, Olivia y proveedores externos tienen operaciones de confianza que ejecutan del lado servidor. El modelo se observa en reglas, índices, planes de escritura y servicios.

## Decisión

Usar un proyecto Firebase por entorno y un modelo Firestore de colecciones, subcolecciones, snapshots y enlaces por ID. Aplicar reglas e identidad para acceso SDK y usar Netlify Functions con guards para contratos de servidor. Los adaptadores REST de servidor autentican con cuenta de servicio y usan transacciones, escrituras agrupadas y precondiciones según operación.

Evidencia en [reglas](../../firestore.rules), [índices](../../firestore.indexes.json), [SDK web](../../src/gestion/services/firebase.js), [guard HTTP](../../netlify/functions/_lib/firebaseAuth.mjs), [REST administrativo](../../netlify/functions/_lib/firestoreAdminRest.mjs), [planes operativos](../../src/shared/operationalWritePlans.mjs) y [servicio del vendedor](../../src/gestion/services/sellerService.js).

## Consecuencias

- El cliente puede mantener lecturas operativas bajo reglas y determinadas escrituras transaccionales.
- Los handlers serverless comprueban el perfil y el alcance de acciones porque el acceso REST con credenciales de servicio opera con permisos de servidor.
- Las invariantes de venta y stock requieren coordinación entre rutas SDK y REST. Las pruebas de reglas y los contratos Node verifican capas distintas.
- Producción y previews tienen destinos Firebase y políticas separadas. El [procedimiento de pruebas](../FIREBASE-PRUEBAS.md) y las [reglas del repositorio](../../AGENTS.md) gobiernan el uso de datos.
