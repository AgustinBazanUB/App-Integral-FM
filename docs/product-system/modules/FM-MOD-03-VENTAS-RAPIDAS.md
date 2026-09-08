# FM-MOD-03 — Ventas rápidas

## Estado

- Código: especializado.
- Entry point: `/gestion/quick-sales`.
- UI actual: `src/gestion/pages/QuickSalesPage.jsx`.
- Diseño objetivo: **PROPUESTO v0.2**.

## Objetivo

Registrar ventas ocasionales o administrativas con la misma integridad que una venta del Panel Vendedor, sin obligar a que el stock provenga únicamente de una ubicación de venta.

## Experiencia objetivo

La pantalla debe priorizar velocidad:

1. catálogo de productos disponibles;
2. selección de cantidades;
3. cliente;
4. descuentos;
5. forma de pago;
6. origen de stock;
7. confirmación.

El orden visual puede optimizarse durante el diseño detallado, pero estos elementos deben pertenecer al mismo flujo.

## Origen de stock

`FM-MOD-03-SALE-ORIGIN`

Toda Venta Rápida debe registrar un origen físico explícito.

Tipos previstos:

- ubicación;
- depósito.

Ejemplo:

`Venta rápida -> Depósito Mi casa -> 2 botellones -> descuento de inventario del depósito`

### Regla de métricas

No crear una categoría contable paralela de “ventas de afuera”.

La operación sigue siendo una venta y debe:

- sumar en facturación;
- sumar en métricas generales;
- poder filtrarse por origen;
- poder distinguir tipo de origen si el análisis lo necesita.

## Cliente

`FM-MOD-04-CLIENT-MATCH`

El teléfono debe resolverse contra la base central de Clientes.

Si existe:

- mostrar `Cliente encontrado`;
- nombre;
- zona;
- seleccionar/vincular con mínima interacción.

Si no existe:

- permitir alta rápida;
- no bloquear innecesariamente la venta.

La venta confirmada debe quedar asociada al cliente para alimentar su historial de consumo.

## Paridad con Panel Vendedor

El Panel Vendedor debe reutilizar la misma lógica/componente de identificación del cliente.

La regla de deduplicación y selección no debe cambiar según la superficie desde la que se vende.

## Integridad

La implementación futura deberá resolver correctamente:

- stock insuficiente;
- transacción de venta + inventario;
- origen depósito vs ubicación;
- permisos de lectura/escritura;
- edición/anulación si la venta rápida participa de esos flujos;
- compatibilidad con métricas existentes.

## No objetivo

No convertir Venta Rápida en un segundo sistema de ventas independiente. Debe converger con el mismo dominio de ventas de FM.