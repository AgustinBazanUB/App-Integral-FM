# Workflow de diseño → implementación

Este documento define cómo debe evolucionar FM a partir del Master Map.

## 1. Estado actual

Antes de diseñar una modificación se verifica el código real:

- ruta;
- página/componente;
- servicios;
- dominio;
- persistencia;
- permisos;
- tests;
- integraciones externas.

La pantalla actual se representa en Figma como `ACTUAL`.

## 2. Diseño deseado

Las decisiones de producto aprobadas se representan como `PROPUESTO`.

Una propuesta puede existir sin código. Esto es intencional: Figma es el lugar para definir primero la experiencia que después debe implementarse.

## 3. Functional Spec

Antes de programar una propuesta suficientemente grande, su ficha debe documentar:

- Feature ID.
- Objetivo.
- Actor.
- Precondiciones.
- Entradas.
- Resultado esperado.
- Estados de UI.
- Reglas de negocio.
- Datos que lee/escribe.
- Permisos.
- Integraciones.
- Errores y casos límite.
- Consideraciones de Firestore/costos.
- Desktop/mobile.
- Tests necesarios.
- Links a Figma/FigJam.
- Code Map.

## 4. Implementación

La implementación debe:

1. reutilizar arquitectura existente;
2. evitar servicios o colecciones paralelas;
3. mantener bajo consumo de Firestore;
4. respetar permisos y transacciones;
5. no modificar `main` o producción sin autorización explícita;
6. trabajar primero en rama/Deploy Preview cuando corresponda.

## 5. Testing

Cuando una feature se implementa:

- tests unitarios focalizados;
- typecheck/lint/build según proyecto;
- tests de integración relevantes;
- validación de permisos/Rules cuando cambian datos;
- QA visual desktop/mobile;
- tests pesados en una etapa separada cuando el cambio lo requiera.

## 6. Cierre

Una feature solo cambia a `IMPLEMENTADO / TESTEADO` en el Master Map cuando:

- el código existe;
- los tests acordados pasaron;
- el comportamiento coincide con el diseño aprobado;
- el Code Map está actualizado;
- la documentación funcional está actualizada.

## Estados recomendados

`IDEA → PROPUESTO → DISEÑADO → ESPECIFICADO → IMPLEMENTADO → TESTEADO → PRODUCCIÓN`

`ACTUAL` se usa además para representar lo que existe al momento del relevamiento, aunque luego exista una propuesta nueva que lo reemplace.