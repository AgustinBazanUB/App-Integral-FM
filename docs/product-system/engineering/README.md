# Flor Mía — Expediente de Ingeniería de Software

Estado: **BASE DE DISEÑO / NO PRODUCCIÓN**  
Fecha de inicio: **2026-09-08**

## Objetivo

Este directorio agrega una capa formal de Ingeniería de Software al `FM Product System` existente.

No reemplaza Figma, FigJam, los documentos funcionales ni el código. Los ordena dentro de un proceso de análisis y diseño que permita responder, para cualquier funcionalidad de Flor Mía:

1. ¿Qué problema u objetivo resuelve?
2. ¿Quién interviene?
3. ¿Cuál es el límite del sistema?
4. ¿Qué información entra y sale?
5. ¿Qué proceso transforma esa información?
6. ¿Qué datos se almacenan?
7. ¿Qué reglas de negocio deciden el comportamiento?
8. ¿Qué objetos/dominios participan?
9. ¿Cómo interactúan los componentes y sistemas?
10. ¿Qué está implementado, qué está en preview y qué es sólo diseño?
11. ¿Cómo se verifica que la implementación satisface el requisito?

## Sistema bajo estudio

Flor Mía se considera un **sistema de información compuesto**, no una única aplicación React.

Superficies/subsistemas principales:

- Web pública / Storefront.
- Panel Administrador.
- Panel Vendedor.
- Chrome Extension `Flor-Mia-WhatsApp-Sender`.
- Firebase Authentication / Firestore.
- Netlify / Functions / integraciones server-side.
- Proveedores y sistemas externos: WhatsApp Web, OpenAI, Google Drive, Meta y futuras integraciones.

## Regla de verdad

Para evitar mezclar estados se usarán cuatro etiquetas obligatorias:

- `PROD/MAIN`: implementado en la línea base productiva o rama principal aprobada.
- `PREVIEW`: implementado en una rama/PR todavía no incorporado a la línea base.
- `PROPUESTO`: comportamiento o diseño aprobado/documentado pero todavía no implementado.
- `IDEA`: intención registrada que todavía necesita análisis y diseño.

Un mockup, un documento o una rama no convierten por sí solos una funcionalidad en producción.

## Relación con el FM Product System existente

Se conserva el flujo ya definido:

`estado actual -> diseño deseado -> especificación -> implementación -> tests -> actualización del mapa`

La capa de Ingeniería agrega antes y alrededor de ese flujo:

`problema/objetivo -> alcance -> requerimientos -> análisis -> modelos -> diseño -> especificación -> implementación -> pruebas -> evaluación`

## Fuentes metodológicas

Este expediente toma como guía el material de Ingeniería de Software I agregado al proyecto, especialmente:

- Organizaciones y Sistemas.
- Planeamiento / PMBOK / PERT / Gantt.
- Resolución de problemas y Tablas de Decisión.
- Estudio Preliminar y Análisis Económico-Financiero.
- Factibilidad de proyectos informáticos.
- Análisis de Sistemas / SDLC.
- Análisis y Diseño Estructurado: DFD, CRUD y Diccionario de Datos.
- Análisis y Diseño Orientado a Objetos / UML.
- Diagramas de Casos de Uso, Clases, Estados, Objetos y Secuencia.

La teoría funciona como **estructura de trabajo**, no como obligación de producir diagramas redundantes sin valor. Cada artefacto debe ayudar a entender, diseñar, implementar o verificar Flor Mía.

## Entregables previstos

### Etapa A — Entender el sistema y fijar la línea base

- `00-AUDITORIA-ESTADO-ACTUAL.md`
- `01-MATRIZ-ARTEFACTOS-INGENIERIA.md`
- `02-CONTEXTO-ORGANIZACION-Y-SISTEMA.md`
- `03-ALCANCE-Y-OBJETIVOS.md`
- `04-ESTUDIO-PRELIMINAR-Y-FACTIBILIDAD.md`
- `05-STAKEHOLDERS-Y-ACTORES.md`

### Etapa B — Requisitos y reglas

- `10-CATALOGO-REQUISITOS.md`
- `11-MATRIZ-TRAZABILIDAD.md`
- `12-REQUISITOS-NO-FUNCIONALES.md`
- `13-TABLAS-DE-DECISION.md`
- `14-GLOSARIO-Y-DICCIONARIO-DE-DATOS.md`

### Etapa C — Análisis estructurado

- `20-DIAGRAMA-CONTEXTO.md`
- `21-DFD-NIVEL-0.md`
- `22-DFD-POR-DOMINIO.md`
- `23-MATRIZ-CRUD.md`
- `24-MODELO-DATOS-DER.md`

### Etapa D — Análisis y diseño orientado a objetos

- `30-CASOS-DE-USO.md`
- `31-MODELO-DOMINIO-CLASES.md`
- `32-DIAGRAMAS-DE-ESTADO.md`
- `33-DIAGRAMAS-DE-SECUENCIA.md`
- `34-DIAGRAMAS-DE-OBJETOS.md`
- `35-COMPONENTES-Y-DESPLIEGUE.md`

### Etapa E — Plan, calidad y evolución

- `40-PLAN-PROYECTO-WBS-PERT-GANTT.md`
- `41-RIESGOS-Y-DEPENDENCIAS.md`
- `42-ESTRATEGIA-DE-PRUEBAS.md`
- `43-MATRIZ-ACEPTACION.md`
- `44-DECISIONES-DE-ARQUITECTURA.md`
- `45-CONTROL-DE-CAMBIOS.md`

## Granularidad

Los documentos globales describen Flor Mía como sistema. Cuando una sección crece demasiado, se descompone por módulo utilizando los IDs permanentes del FM Master Map (`FM-MOD-xx`).

Ejemplo:

- el Diagrama de Contexto es global;
- el DFD Nivel 0 es global;
- los DFD hijos pueden existir por Ventas, Inventario, CRM, Marketing, Envíos, etc.;
- los casos de uso y secuencias se catalogan por Feature ID;
- las tablas de decisión se crean sólo donde existen reglas combinatorias reales.

## Trazabilidad obligatoria

Toda feature relevante debe poder recorrer esta cadena:

`Objetivo -> Requisito -> Actor/Caso de Uso -> Proceso/Regla -> Datos -> Diseño/Figma -> Código -> Test -> Estado de entrega`

Los IDs de requisito y feature deben permanecer estables aunque cambie el texto descriptivo.

Convención inicial:

- `FM-OBJ-xxx` — objetivo.
- `FM-RF-xxx` — requisito funcional.
- `FM-RNF-xxx` — requisito no funcional.
- `FM-RN-xxx` — regla de negocio.
- `FM-UC-xxx` — caso de uso.
- `FM-DATA-xxx` — estructura/entidad de datos.
- `FM-INT-xxx` — integración.
- `FM-TEST-xxx` — criterio/prueba de aceptación.

## Relación con código y ramas

El expediente debe auditar siempre:

- `main` como línea base;
- PRs/ramas activas que cambian funcionalidad;
- `docs/product-system/` como diseño de producto;
- `Flor-Mia-WhatsApp-Sender` como subsistema separado;
- configuración y reglas cuando la funcionalidad depende de Firebase/Netlify.

No se debe modificar código productivo para hacer coincidir los diagramas. Si el modelo descubre una inconsistencia, se registra primero como finding y luego se diseña una corrección separada.

## Orden de trabajo recomendado

No completar todos los diagramas de una vez. El orden es iterativo:

1. fijar contexto, alcance y línea base;
2. construir catálogo inicial de requisitos;
3. dibujar Diagrama de Contexto y DFD Nivel 0;
4. elegir un módulo prioritario;
5. completar requisitos, reglas, datos, casos de uso y secuencias de ese módulo;
6. comparar diseño contra código;
7. implementar en rama/preview;
8. validar y actualizar trazabilidad;
9. pasar al siguiente módulo.

Este método permite seguir desarrollando Flor Mía mientras el expediente madura, sin exigir congelar el producto ni reconstruir documentación ya existente.