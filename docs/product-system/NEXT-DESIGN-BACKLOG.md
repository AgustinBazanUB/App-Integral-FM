# Siguiente backlog de diseño

Este backlog continúa la v0.2 sin rehacer lo ya creado.

## Prioridad A — completar el esqueleto visual

1. **App Shell administrativo**
   - Sidebar.
   - Header.
   - navegación mobile/drawer.
   - estados por permisos.

2. **Design System real en Figma**
   - Variables a partir de `FLOR-MIA-DESIGN-SYSTEM.txt`.
   - tipografía serif editorial + sans funcional.
   - Button.
   - Input/Search/Select.
   - Badge.
   - Panel.
   - Card.
   - DataTable/MobileDataCard.
   - Modal/Drawer/Dropdown.
   - Toast/Empty/Skeleton.

3. **Seller Panel**
   - reconstruir pantalla actual;
   - diseñar selector compartido de cliente por teléfono;
   - documentar paridad con Venta Rápida.

4. **Storefront**
   - Home.
   - Catálogo.
   - Producto.
   - Cart Drawer.
   - Checkout.
   - separar claramente sistema visual público de administración.

## Prioridad B — módulos pendientes de diseño específico

5. Finanzas.
6. Envíos.
7. Alertas.
8. Proveedores.
9. Ecommerce administrativo.
10. Redes Sociales más allá del primer WhatsApp Inbox.
11. Administración / Auditoría / Configuración.

## Prioridad C — profundizar módulos v0.2

12. Ubicaciones
   - estados de tarjetas;
   - inactivas;
   - detalle interno;
   - productos/stock/vendedores/descuentos/ventas;
   - mobile.

13. Venta Rápida
   - flujo completo;
   - búsqueda/filtrado de productos;
   - selección de cliente;
   - origen de stock;
   - error de stock;
   - confirmación;
   - recibo;
   - mobile.

14. Clientes
   - detalle CRM;
   - historial;
   - métricas de consumo;
   - zonas;
   - barrios cercanos;
   - importación;
   - creación/edición.

15. Depósitos
   - lista de depósitos;
   - detalle;
   - ingreso;
   - transferencia;
   - negativo con confirmación;
   - revisión de diferencias;
   - historial.

16. WhatsApp Inbox
   - estados no leído/prioridad;
   - cliente existente/nuevo;
   - edición inline;
   - conversación no elegible;
   - grupos/canales;
   - convivencia con campañas activas;
   - mobile.

## Prioridad D — arquitectura visual

17. Firestore/Data Map.
18. Permisos/Roles Map.
19. Netlify/Functions/IA Map.
20. Meta Ads end-to-end.
21. Chrome Extension deep map.
22. Matriz de integraciones entre módulos.

## Definición de terminado por módulo

Un módulo se considera diseñado cuando tiene, como mínimo:

- landing desktop;
- landing mobile;
- flujos principales;
- empty/loading/error/disabled;
- permisos relevantes;
- operaciones destructivas confirmadas;
- entidades/datos principales;
- relaciones con otros módulos;
- functional spec;
- Code Map;
- tests a implementar;
- estado `ACTUAL` y `PROPUESTO` claramente diferenciados.

## Nota operativa

El archivo Figma ya fue creado y contiene el Master Board + varias pantallas. La continuación debe ocurrir sobre el mismo archivo, no en un Figma nuevo.