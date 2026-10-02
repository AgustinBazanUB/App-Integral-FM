# Ecommerce — Etapa 6: pago simulado local + preparación fiscal segura

## Alcance

Esta etapa agrega un flujo temporal **exclusivamente local** para validar:

`Checkout → Payment simulation → Order confirmado → Sale → Invoice Ecommerce → motor fiscal ARCA (plan/dry-run)`

No integra Payway todavía y no habilita CAE productivo.

## Feature flag

```env
ECOMMERCE_SIMULATED_PAYMENT_ENABLED=false
```

Reglas:

- es un flag **server-side**;
- no usar `VITE_`;
- sólo puede activarse en un archivo local ignorado por Git;
- además del flag, el backend exige runtime local (`CONTEXT=dev`, `NETLIFY_DEV=true` o `NETLIFY_LOCAL=true`);
- `production`, `deploy-preview` y `branch-deploy` quedan rechazados aunque el flag sea `true`.

## Seguridad

La simulación usa `/.netlify/functions/ecommerce-simulated-payment`.

El endpoint:

1. exige Firebase Auth;
2. exige `requireFirebaseAdmin`;
3. vuelve a comprobar el flag server-side;
4. nunca toma un estado de pago confiable desde el navegador;
5. usa una referencia determinística;
6. no importa ni llama `FECAESolicitar`.

El checkout público sólo puede crear `Payment.status=pending`.

## Payment contract

`paymentContract.mjs` define una normalización común:

- simulation + approved → `paymentProvider=simulation`, `paymentStatus=simulated_approved`;
- payway + approved → `paymentProvider=payway`, `paymentStatus=approved`.

Los dos estados no se consideran equivalentes.

## Idempotencia

La clave estable es `requestId`, persistida también como `idempotencyKey`.

IDs determinísticos:

- `ecommerce_order_<requestId>`;
- `ecommerce_payment_<requestId>`;
- `ecommerce_sale_<requestId>`;
- movimientos de stock determinísticos por request/producto;
- invoice ARCA determinística por environment/source/sale.

El checkout persiste además un fingerprint del contenido. Reutilizar la misma clave con un checkout distinto produce `ecommerce-idempotency-conflict`.

La confirmación de pago usa escrituras atómicas con precondiciones Firestore. Retry, doble click y carreras convergen al mismo Order/Payment/Sale.

## Revalidación antes de Sale

Antes de confirmar una venta se vuelven a consultar:

- ubicación Ecommerce;
- productos;
- precio autoritativo;
- IVA;
- stock.

Si el snapshot comercial ya no coincide con el Order se bloquea con `ecommerce-order-commercial-drift`. Si no alcanza stock, no se crea Sale.

## Invoice Ecommerce

`fiscalService.mjs` verifica nuevamente:

- Order Ecommerce válido;
- Payment asociado;
- Sale activa;
- misma idempotency key;
- relación Order/Payment/Sale;
- total consistente;
- `simulation + simulated_approved` o, a futuro, `payway + approved`.

`invoicePersistence.mjs` también incorpora el gate Ecommerce.

La allowlist de autoautorización productiva **no cambia**: por default sigue siendo `admin_quick_sale`.

## Receiver

Sin CUIT:

- Consumidor Final;
- condición IVA 5;
- documento 99 / 0;
- anonymousConsumerFinal=true.

Con CUIT:

- se valida CUIT;
- se reutilizan Padrón ARCA + inferencia de condición IVA;
- en producción la consulta requiere `ARCA_ALLOW_PRODUCTION_TAXPAYER_LOOKUP=true`.

## Transporte fiscal

Durante Etapa 6 el flujo Ecommerce usa directamente `buildAuthorizationPlan`.

Resultado:

- invoice persistida;
- fiscal plan calculado;
- `transport=blocked`;
- `caeRequested=false`.

No se persiste CAE ficticio. Un mock de autorización sólo puede inyectarse con `NODE_ENV=test`.

## Firestore

Las reglas existentes ya bloquean escrituras browser en:

- orders;
- payments;
- invoices;
- sales Ecommerce.

Por lo tanto el navegador no puede modificar paymentStatus, CAE, numeración, invoice link ni campos fiscales.

## UI local

Cuando existe una sesión Admin y el backend informa capability local activa, Checkout muestra:

> Este checkout no procesa un pago real.
> La acción simulará un pago aprobado.
> La factura fiscal puede ser real si la emisión productiva está habilitada.

También permite CUIT opcional. Sin capability backend el control no aparece.

## Verificación esperada

Sin publicar:

```bash
npm ci
npm run test:ecommerce
# Firestore Emulator / rules tests
npm run test:rules
npm run build
git diff --check
ECOMMERCE_SIMULATED_PAYMENT_ENABLED=true npx netlify dev
```

La prueba local debe validar Order → Payment → Sale → Invoice con motor fiscal en dry-run/mock y CAE=0.

## Payway pendiente

La futura integración debe verificar la firma/webhook de Payway y llamar al mismo servicio de confirmación con:

```text
provider=payway
status=approved
reference=<id confiable del proveedor>
```

Nunca debe reutilizar `simulated_approved`.

## Prueba fiscal productiva futura

No forma parte de esta implementación. Antes de tocar `ARCA_ALLOW_PRODUCTION_CAE=true` o equivalente se debe mostrar venta, importe, source=ecommerce, tipo estimado, explicar que el pago fue simulado y que la factura sí será real, y pedir autorización explícita.
