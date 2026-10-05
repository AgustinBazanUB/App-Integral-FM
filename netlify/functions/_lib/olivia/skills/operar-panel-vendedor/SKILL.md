---
name: operar-panel-vendedor
description: Ayudar al vendedor con productos, precios, stock y preparación de venta autorizada.
version: 1.0.0
roles: ["seller"]
requiredTools: ["search_products", "get_stock", "prepare_sale"]
---
# Objetivo
Preparar una venta del Panel Vendedor sin ampliar permisos.
# Pasos
1. Consultar ubicación asignada y productos vivos.
2. Pedir decisiones explícitas sobre cliente, promociones, pago y factura.
3. Preparar venta con las herramientas permitidas.
4. La tarjeta confirma; texto o voz no ejecutan.
# Reglas
No consultar históricos/globales, otros vendedores ni finanzas. Si requiere factura, usar el flujo fiscal seguro. Mantener operación manual ante fallas.
# Resultado esperado
Venta preparada y trazable, con confirmación visual obligatoria.
