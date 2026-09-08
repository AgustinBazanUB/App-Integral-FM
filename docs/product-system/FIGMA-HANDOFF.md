# Figma / FigJam Handoff — FM Product System v0.2

## Archivos

### FigJam — Master Product & Architecture Map

https://www.figma.com/board/m7s3CTQ4mbiFF5fcCwpRP8

Diagramas creados:

1. **FM System Map**
   - Web App.
   - Storefront.
   - Admin Panel.
   - Seller Panel.
   - 13 módulos.
   - Firebase.
   - Netlify/Functions/IA.
   - Chrome Extension.
   - WhatsApp Web.

2. **Stock, ventas y clientes**
   - Producto maestro.
   - Ubicación.
   - Depósito.
   - Transferencias.
   - Venta Rápida.
   - Panel Vendedor.
   - Cliente.
   - Métricas.

3. **CRM, zonas y WhatsApp Inbox**
   - teléfono → cliente;
   - alta/edición;
   - historial;
   - barrio;
   - barrios cercanos;
   - Inbox;
   - segmentación futura.

### Figma Design — Product UI & Design System

https://www.figma.com/design/k5ElHZsMZVwtF3J6KxS61S

Frames creados en el canvas:

- `FM Product System — Master Board`
  - leyenda de estados;
  - índice visual de los 13 módulos;
  - regla de trabajo Diseño → Código.
- `Dashboard — estado actual`.
- `FM-MOD-02 — Productos · estado actual`.
- `FM-MOD-05 — Métricas · estado actual`.
- `FM-MOD-10-WA — Marketing WhatsApp · actual`.
- `FM-MOD-10-META — Meta Ads · actual + roadmap`.
- `FM-MOD-01 — Ubicaciones v0.2`.
- `FM-MOD-03 — Ventas rápidas v0.2`.
- `FM-MOD-04 — Clientes CRM v0.2`.
- `FM-MOD-07 — Depósitos v0.2`.
- `FM-MOD-09-WA — WhatsApp Inbox`.

## Lectura de estados

- `ACTUAL`: reconstrucción conceptual de la pantalla existente a partir del código auditado.
- `PROPUESTO`: comportamiento discutido/aprobado, todavía no necesariamente implementado.
- `GENÉRICO`: existe base de ruta/registro, pero todavía utiliza experiencia genérica.
- `FUTURO`: está dentro del producto objetivo pero requiere diseño posterior.

## Sistema visual

El repositorio ya contiene `docs/FLOR-MIA-DESIGN-SYSTEM.txt` como fuente visual de la superficie privada de gestión.

Dirección obligatoria documentada:

- blanco cálido / crema;
- dorado satinado;
- madera oscura en zonas controladas;
- oliva como apoyo;
- serif editorial para títulos/datos destacados;
- sans funcional para controles/tablas;
- bordes suaves y sombras difusas;
- mobile first y WCAG 2.2 AA.

El diseño detallado posterior debe convertir estos tokens en Variables/Styles/Components de Figma y evitar un dashboard SaaS genérico.

## Limitación de esta sesión

El plan Figma conectado es Starter y alcanzó el límite de llamadas MCP durante la construcción.

Por ese motivo, esta versión deja creado el esqueleto y los principales frames actuales/propuestos, mientras que las pantallas restantes quedan documentadas en GitHub para continuar en la siguiente ventana de disponibilidad de Figma.

Esto no afecta los archivos ya creados.

## Regla para continuar

No redibujar desde cero.

Continuar sobre estos mismos file keys y agregar progresivamente:

- App Shell / Sidebar / Header definitivos;
- componentes y variables del Design System;
- Seller Panel completo;
- Ecommerce/storefront;
- Finanzas;
- Envíos;
- Alertas;
- Proveedores;
- Administración/Auditoría/Configuración;
- estados mobile;
- estados loading/empty/error/disabled;
- links entre frames y fichas de GitHub.