# FM-MOD-07 — Depósitos

## Estado

- Código: especializado.
- Entry point: `/gestion/warehouse`.
- UI actual: `src/gestion/pages/WarehousePage.jsx`.
- Servicio: `src/gestion/services/inventoryService.js`.
- Dominio: `src/modules/inventory/domain/inventory.js`.
- Diseño objetivo: **PROPUESTO v0.2**.

## Objetivo

Representar lugares físicos donde Flor Mía guarda mercadería antes de moverla a puntos de venta o utilizarla como origen excepcional de una Venta Rápida.

## Responsabilidad

Un depósito:

- recibe mercadería;
- conserva cantidades;
- registra movimientos;
- transfiere stock.

Un depósito **no** define precio de venta como responsabilidad propia y no se comporta como ubicación comercial.

## Acciones núcleo

### 1. Ingresar stock

Permite sumar mercadería física al depósito y registrar el movimiento.

### 2. Transferir stock

`FM-MOD-07-TRANSFER`

Debe solicitar:

- origen;
- destino;
- producto(s);
- cantidad(es);
- nota/observación opcional;
- confirmación.

Destino principal esperado: una ubicación de venta.

## Stock negativo controlado

Problema real contemplado:

el stock físico puede existir aunque el sistema no haya recibido un ingreso previo correctamente.

Ejemplo:

- stock lógico: 18;
- cantidad física que se transfiere: 20;
- stock lógico resultante: -2.

Diseño v0.2:

1. detectar que la transferencia supera el stock lógico;
2. mostrar advertencia explícita;
3. explicar el saldo que quedará;
4. permitir continuar solo mediante confirmación consciente si el perfil tiene permiso;
5. registrar la transferencia;
6. crear/mostrar una condición de revisión de inventario.

La posibilidad de quedar negativo no debe ocultar errores ni borrar trazabilidad.

## Auditoría

Toda transferencia debe poder reconstruirse con:

- usuario;
- fecha/hora;
- origen;
- destino;
- producto;
- cantidad;
- saldo relacionado;
- nota si existe.

## Relación con Venta Rápida

Un depósito puede ser origen de stock para una Venta Rápida.

Esto no convierte al depósito en ubicación de venta: la venta es la operación comercial y el depósito solamente es su origen físico de inventario.

## Pendiente técnico antes de implementar negativos

La implementación debe auditar con cuidado:

- reglas actuales de Firestore;
- transacciones;
- invariantes existentes que prohíban stock negativo;
- alertas/reconciliación;
- impacto en transferencias simultáneas;
- tests de regresión de inventario.

No relajar integridad de stock de manera global solo para implementar este caso.