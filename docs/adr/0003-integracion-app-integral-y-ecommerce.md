# ADR 0003 · Integración entre App Integral y E-Commerce

## Estado

Vigente (Inferido del código actual).

## Contexto

La tienda combina datos editoriales versionados con productos, precio y existencia comercial del maestro. Los pedidos tienen que quedar visibles en Gestión y una confirmación posterior puede generar los hechos de venta y fiscalidad.

## Decisión

Exponer catálogo y checkout como Netlify Functions del mismo origen. El servidor usa la ubicación comercial seleccionada y revalida artículos, precio y disponibilidad contra Firestore. La creación idempotente guarda orden y pago pendiente. La simulación administrativa local confirma el pago antes de preparar el comprobante fiscal.

Evidencia en [cliente HTTP](../../src/services/ecommerceService.js), [catálogo](../../src/context/CommerceCatalogContext.jsx), [servicio comercial](../../netlify/functions/_lib/ecommerce/commerceService.mjs), [pago](../../netlify/functions/_lib/ecommerce/paymentService.mjs), [preparación fiscal](../../netlify/functions/_lib/ecommerce/fiscalService.mjs) y [listado de Gestión](../../src/gestion/pages/GenericModulePage.jsx).

## Consecuencias

- Maestro, saldos de local, pedido, pago y venta comparten Firestore. El checkout público conserva estado pendiente y el stock cambia en la transición aprobada.
- El sitio aislado necesita resolver los mismos contratos HTTP. Su configuración versionada entrega la SPA con Functions propias vacías.
- **[INCOMPLETO]** Payway se reconoce en el contrato de estados y la entrega pública a domicilio está pendiente. El flujo habilitado de confirmación es local, con administrador y flag.
- La confirmación comercial y la preparación fiscal son fases diferentes. El [manual arc42](../architecture/02-arc42-flor-mia.md#51-compra-e-commerce-y-efecto-operativo) documenta las dos.
