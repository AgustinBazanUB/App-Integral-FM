# Design System Bridge — repositorio → Figma

La fuente visual administrativa existente es:

`docs/FLOR-MIA-DESIGN-SYSTEM.txt`

Este documento resume cómo trasladarla al archivo Figma del Product System sin crear un segundo lenguaje visual.

## Dirección visual

Nombre documentado:

**Flor Mia Natural Rustic Modern Design System**

Objetivo:

- natural refinado;
- rústico contemporáneo;
- premium sobrio;
- editorial cálido;
- administrativo limpio;
- inspiración mendocina sutil.

## Tipografía

La especificación establece:

- **serif editorial** para títulos y valores destacados;
- **sans serif funcional** para navegación, formularios, tablas y datos.

El storefront actual declara:

- `Manrope` como sans principal;
- `Cormorant Garamond` para headings.

Ambas familias están disponibles en el entorno Figma conectado y son las primeras candidatas para formalizar el sistema compartido, sujeto a verificar las decisiones específicas de la superficie administrativa.

## Tokens administrativos principales

### Marca

- Gold Primary — `#B88A2D`
- Gold Strong — `#9B6F18`
- Gold Dark — `#76510F`
- Gold Soft — `#D8B66C`
- Gold Pale — `#F3E8CF`
- Wood Primary — `#4A3422`
- Wood Dark — `#24170D`
- Wood Soft — `#7B624A`
- Olive Secondary — `#6E7C3C`
- Olive Dark — `#4F5E2A`
- Olive Pale — `#EEF2E8`

### Backgrounds / surfaces

- App — `#FBFAF8`
- Main — `#FEFEFD`
- Sidebar — `#FCF9F4`
- Header — `#FFFFFF`
- Subtle — `#F8F4EE`
- Muted — `#F3EEE7`
- Surface Primary — `#FFFFFF`
- Surface Secondary — `#FCFAF7`
- Cream — `#F7F1E8`
- Beige — `#ECE2D3`
- Selected — `#F6ECD5`
- Disabled — `#F1EFEC`

### Text

- Primary — `#2F2924`
- Secondary — `#625B54`
- Muted — `#8A837C`
- Subtle — `#A39C95`
- Inverse — `#FFFDF8`
- Accent / Link — `#8E6418`

### Borders

- Default — `#E8E2DA`
- Subtle — `#F0ECE6`
- Strong — `#D7CFC5`
- Accent — `#C79A3B`
- Focus — `#B88A2D`

## Componentes que Figma debe formalizar

La especificación existente requiere como mínimo:

- AppShell;
- Sidebar;
- Header;
- ModuleNavigation;
- PageHeader;
- HeroBanner;
- StatCard;
- Panel;
- DataTable;
- MobileDataCard;
- FilterBar;
- SearchInput;
- FormField;
- Select / Multiselect / DatePicker;
- Modal / Drawer / Dropdown / Tooltip;
- Toast / Badge / Tabs / Accordion;
- EmptyState / Skeleton / ProgressBar / Pagination;
- ChartContainer;
- PermissionGuard;
- LoadingButton;
- ConfirmationDialog.

## Layout

Desktop:

- sidebar persistente;
- header sticky;
- área principal clara;
- grid de 12 columnas;
- radio principal de panel/card: 14 px;
- separación predominante: 16 px.

Mobile/tablet:

- sidebar → drawer;
- una columna cuando corresponda;
- tablas → tarjetas apiladas;
- targets táctiles >= 44×44;
- filtros en panel/sheet colapsable;
- sin scroll horizontal salvo excepción justificada.

## Regla de migración

Los wireframes creados en la v0.2 son **estructurales**. La siguiente iteración de Figma debe aplicar estos tokens y componentes sin cambiar las decisiones funcionales ya aprobadas.

No debe reemplazarse el lenguaje Flor Mía por Material, Bootstrap o un kit SaaS genérico solo para acelerar la construcción.