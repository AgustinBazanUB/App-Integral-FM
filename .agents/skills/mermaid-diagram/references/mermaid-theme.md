# Tema Mermaid de Flor Mía

Esta paleta forma parte de las fuentes `.mmd` y del visor local. Conservá los tres atributos `fill`, `stroke` y `color` en cada clase. Las categorías se distinguen por texto y color. Los contornos punteados señalan servicios externos y brechas, que también llevan una etiqueta explícita.

| Clase | Color | Uso |
| --- | --- | --- |
| `actor` | `#1E293B` | Actores. |
| `integral` | `#1D4ED8` | App Integral FM. |
| `ecommerce` | `#047857` | E-Commerce. |
| `shared` | `#6D28D9` | Capa transversal. |
| `db` | `#B45309` | Persistencia. |
| `external` | `#475569` | Servicios externos con borde punteado. |
| `debt` | `#B91C1C` | Brecha o flujo incompleto con borde punteado. |

```mermaid
classDef actor fill:#1E293B,stroke:#64748B,color:#FFFFFF,stroke-width:2px
classDef integral fill:#1D4ED8,stroke:#1E40AF,color:#FFFFFF,stroke-width:2px
classDef ecommerce fill:#047857,stroke:#065F46,color:#FFFFFF,stroke-width:2px
classDef shared fill:#6D28D9,stroke:#5B21B6,color:#FFFFFF,stroke-width:2px
classDef db fill:#B45309,stroke:#92400E,color:#FFFFFF,stroke-width:2px
classDef external fill:#475569,stroke:#334155,color:#FFFFFF,stroke-width:2px,stroke-dasharray:5 4
classDef debt fill:#B91C1C,stroke:#7F1D1D,color:#FFFFFF,stroke-width:2px,stroke-dasharray:5 4
```

Beautiful Mermaid usa esta configuración. El gris pizarra permite seguir las flechas sobre el fondo claro.

```json
{ "base": "github-light", "line": "#8793A3", "font": "Arial" }
```
 El fondo se conserva al abrir el SVG sobre una página clara u oscura. En Mermaid Live los nodos mantienen su contraste gracias al color de texto explícito.

Usá `flowchart`, etiquetas simples entre comillas, nombres de subgrafo explícitos y aristas sólidas o punteadas. Para mantener la compatibilidad, evitá directivas de inicialización y HTML en las etiquetas.
