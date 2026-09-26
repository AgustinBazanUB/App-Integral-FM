# Punto de continuidad — integración ARCA

## Checkout

- Repositorio: `AgustinBazanUB/App-Integral-FM`
- Rama de trabajo: `feature/arca-integration`
- Etiqueta de checkpoint: `arca-handoff-2026-09-25`
- Runtime de Functions configurado en Netlify: Node 20
- Los cambios de este checkpoint son código y documentación. No se hizo deploy ni se emitió un CAE.

En otra computadora, después de que el checkpoint esté publicado en GitHub:

```bash
git clone https://github.com/AgustinBazanUB/App-Integral-FM.git
cd App-Integral-FM
git fetch origin tag arca-handoff-2026-09-25
git switch -c codex/arca-handoff refs/tags/arca-handoff-2026-09-25
npm ci
npm run build
node --test tests/arca-domain.test.mjs
```

## Estado de la integración

- `arca-taxpayer` conserva el diagnóstico independiente de WSFE, punto de venta, Padrón, OAuth de Firebase y lectura de Firestore. La lectura usa el documento de diagnóstico con un ID válido de Firestore.
- `arca-invoice` autentica al usuario, comprueba que la venta activa tenga una solicitud explícita y guarda una intención pendiente para `seller_sale` o `admin_quick_sale`.
- El ID de la factura es determinístico por origen. Los reintentos recuperan el mismo documento `invoices/{invoiceId}`; una creación duplicada concurrente usa el conflicto de Firestore para leer el documento ya creado.
- La intención guarda una instantánea de importes e ítems en `status: pending`. No llama a WSAA/WSFE, no asigna numeración y no solicita CAE. El checkout todavía no crea pedidos confirmados y no está habilitado como origen fiscal.
- La UI de Venta rápida y el Panel Vendedor invocan la Function después de registrar la venta. Si falla el guardado, muestran el error y permiten reintentar sin registrar otra venta. La sincronización de ventas offline también reintenta la persistencia.

## Diagnóstico observado

En la última ejecución autenticada después de actualizar la rama, WSFE, Padrón, Firebase Admin OAuth y la lectura server-side de Firestore respondieron correctamente. La consulta de puntos de venta de ARCA devolvió HTTP 502. Para repetir el diagnóstico desde la UI hay que iniciar sesión en la app local y abrir **Configuración → Diagnóstico ARCA**.

## Continuar el desarrollo

Antes de habilitar autorización fiscal, todavía hay que definir y validar los datos fiscales de productos y receptores, el tipo de comprobante, las transiciones de estado, el tratamiento de ventas editadas/anuladas y la coordinación de numeración. La siguiente etapa debe mantener la idempotencia por origen y recuperar el comprobante con la consulta de ARCA antes de cualquier reintento incierto.

El backend de datos usa el proyecto Firebase `app-integral-fm`, incluso cuando la app corre localmente. La Function de persistencia escribe en Firestore cuando recibe una solicitud real de venta; no se debe usar una venta real como prueba técnica sin planificar previamente ese efecto.

## Secretos y entorno local

Para probar Netlify Functions con ARCA y Firebase en otra PC, configurar de manera local y segura las variables `ARCA_ENVIRONMENT`, `ARCA_ISSUER_CUIT`, `ARCA_POINT_OF_SALE`, `ARCA_CERTIFICATE_PEM`, `ARCA_PRIVATE_KEY_PEM`, `FIREBASE_ADMIN_CLIENT_EMAIL` y `FIREBASE_ADMIN_PRIVATE_KEY`. Los certificados, claves, JSON de cuenta de servicio, valores de variables y archivos `.env` permanecen fuera de GitHub. No usar prefijos `VITE_` para secretos.

Con las dependencias instaladas, Netlify Dev puede iniciarse localmente con la CLI sin vincular el checkout a un sitio ni crear un deploy:

```powershell
npm exec --yes --package=netlify-cli@27.10.0 -- netlify dev --offline
```

Las credenciales deben inyectarse en el proceso local con un mecanismo seguro; no pegarlas en el repositorio, en un issue ni en el chat. La compilación y las pruebas de dominio no necesitan certificados ni cuenta de servicio.

## Verificación de este checkpoint

```bash
git diff --check
npm run build
node --test tests/arca-domain.test.mjs
```

La prueba de dominio reportó 18 casos aprobados. No hay tests específicos de persistencia en este checkpoint.
