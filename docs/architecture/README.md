# Arquitectura visual de Flor Mía

Diseño técnico de la App Integral, su API y el E-Commerce, relevado a partir del código del repositorio.

## Mapas y visor

- [Mapas C4](01-c4-maps.md) · 16 diagramas de contexto, despliegue, módulos internos y tienda.
- [Visor interactivo](visor.html) · Descargá el archivo y abrilo en el navegador para recorrer los mapas sin conexión, con zoom y desplazamiento.

## Manual e inventario

| Si querés revisar… | Abrí… |
| --- | --- |
| Cómo se comunican Gestión, API y tienda | [Contexto y topología](01-c4-maps.md#nivel-2--contenedores-y-topología) |
| Qué hay en cada módulo interno | [Índice de dominios de App y API Integral](01-c4-maps.md#nivel-3a--índice-de-dominios-de-app-y-api-integral) |
| Cómo funciona la tienda | [Vistas, estado y renderizado del E-Commerce](01-c4-maps.md#nivel-3b--e-commerce-vistas-estado-y-renderizado) |
| Qué ocurre al comprar, vender, facturar o despachar | [Manual arc42 y cuatro secuencias operativas](02-arc42-flor-mia.md#5-tiempo-de-ejecución) |
| Dónde están los módulos, handlers y trabajos | [Inventario del sistema](03-system-inventory.md) |
| Cómo se relacionan los documentos de Firestore | [Modelo documental y cinco diagramas ER](03-system-inventory.md#modelo-documental) |

## Decisiones de arquitectura

- [0001 · Estructura del monorepo y stack](../adr/0001-estructura-monorepo-y-stack.md)
- [0002 · Arquitectura API y modelo de datos](../adr/0002-arquitectura-api-y-modelo-de-datos.md)
- [0003 · Integración de App Integral y E-Commerce](../adr/0003-integracion-app-integral-y-ecommerce.md)
- [Plantilla para registrar una decisión](../adr/0000-template.md)
