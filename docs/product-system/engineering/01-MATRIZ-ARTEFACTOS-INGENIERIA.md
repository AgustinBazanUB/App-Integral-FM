# Matriz de artefactos de Ingeniería de Software — Flor Mía

Fecha: **2026-09-08**  
Objetivo: traducir el material de Ingeniería de Software I a entregables concretos y útiles para el diseño vivo de Flor Mía.

## Cómo leer esta matriz

- `EXISTE`: hay un documento/modelo suficientemente cercano y debe reutilizarse.
- `PARCIAL`: existe información distribuida, pero falta convertirla en el artefacto formal.
- `FALTA`: todavía debe construirse.
- `CONTINUO`: artefacto que nunca se “cierra” definitivamente porque evoluciona con el producto.

La prioridad no sigue necesariamente el número del apunte. Sigue dependencias de análisis: primero sistema/alcance/requisitos, luego procesos/datos y luego modelos detallados.

| Fuente / tema | Concepto que aporta | Artefacto Flor Mía | Estado inicial | Prioridad | Acción |
|---|---|---|---|---|---|
| 1 — Organizaciones y Sistemas | organización, sistema, subsistema, entradas/salidas, información | `02-CONTEXTO-ORGANIZACION-Y-SISTEMA.md` | PARCIAL | P0 | definir Flor Mía, organización, subsistemas, ambiente y propósito |
| 2 — Planeamiento / PMBOK / PERT / Gantt | alcance, WBS/EDT, actividades, dependencias, cronograma, control | `40-PLAN-PROYECTO-WBS-PERT-GANTT.md` | PARCIAL | P2 | transformar roadmap/backlog en plan dependiente y controlable |
| 3 — Resolución de problemas | problema, desviación, alternativas, evaluación, control | secciones de problema/objetivo por módulo + decisiones | PARCIAL | P0 | registrar problema actual vs estado deseado antes de diseñar features |
| 3 — Tablas de Decisión | condiciones, acciones, reglas, integridad | `13-TABLAS-DE-DECISION.md` | FALTA | P1 | modelar sólo reglas combinatorias relevantes |
| 4 — Estudio Preliminar | justificación, situación actual, propuesta, objetivos, requerimientos, costo/beneficio | `04-ESTUDIO-PRELIMINAR-Y-FACTIBILIDAD.md` | PARCIAL | P0 | consolidar caso del sistema y beneficios/costos de evolución |
| 5 — Factibilidad | técnica, económica, operativa, cronograma/recursos | mismo expediente de factibilidad + anexos | PARCIAL | P1 | auditar Firebase/Netlify/Chrome/APIs/costos y restricciones |
| 5.2 — Planilla Factibilidad | soporte cuantitativo | hoja de factibilidad/costos | FALTA | P2 | crear cuando se disponga de estimaciones reales |
| 5.3 — Minuta de Reunión | captura de decisiones y acuerdos | `DECISIONES.md` / ADR / minutas | PARCIAL | P2 | mantener decisiones importantes con fecha, motivo e impacto |
| 6 — Análisis de Sistemas / SDLC | problema → requisitos → análisis → diseño → desarrollo → pruebas → implementación | este expediente + workflow | PARCIAL | P0 | usar como ciclo marco de trabajo |
| 7 — Análisis y Diseño Estructurado | modelo ambiental, DFD lógico/físico, CRUD, diccionario de datos | artefactos 20–24 | FALTA/PARCIAL | P0-P1 | construir DC y DFD global antes de DFD hijos |
| 7.2 — Req-List | requisitos catalogados y trazables | `10-CATALOGO-REQUISITOS.md` + `11-MATRIZ-TRAZABILIDAD.md` | FALTA | P0 | crear IDs únicos para RF/RNF/reglas/casos/tests |
| 7.3 — Ejemplos DER | entidades y relaciones | `24-MODELO-DATOS-DER.md` | PARCIAL | P1 | separar modelo conceptual de implementación Firestore |
| 7.4 — Convención DFD | notación y reglas de flujo | estándar de diagramas DFD del expediente | FALTA | P0 | adoptar convención antes de dibujar DC/DFD |
| 8/8.1–8.5 — Análisis y Diseño OO | objetos, clases, responsabilidades, colaboración, UML | artefactos 30–35 | FALTA/PARCIAL | P1 | modelar dominio e interacciones después de requisitos/procesos |
| 8.6 / 8.11 / 8.12 — Casos de Uso | actores y objetivos del usuario | `30-CASOS-DE-USO.md` | FALTA | P1 | crear catálogo global y detalle por feature |
| 8.7 / 8.13 — Clases | estructura del dominio | `31-MODELO-DOMINIO-CLASES.md` | PARCIAL | P1 | representar Cliente, Producto, Venta, Inventario, Campaña, etc. |
| 8.8 / 8.14 — Estados | ciclo de vida de entidades/procesos | `32-DIAGRAMAS-DE-ESTADO.md` | PARCIAL | P1 | reutilizar estados reales de campañas y diseñar Envíos/Meta/etc. |
| 8.9 / 8.15 — Objetos | instancias concretas y relaciones en un momento | `34-DIAGRAMAS-DE-OBJETOS.md` | FALTA | P3 | usar sólo para escenarios que lo justifiquen |
| 8.10 / 8.16 — Secuencia | interacción temporal entre actores/componentes | `33-DIAGRAMAS-DE-SECUENCIA.md` | FALTA/PARCIAL | P1 | priorizar Venta, WhatsApp, CRM, stock transfer y shipping |

## Artefactos que ya existen y no deben duplicarse

### Arquitectura y código

- `docs/ARQUITECTURA.md`
- `docs/FIRESTORE-MODEL.md`
- `docs/product-system/CODE-MAP.md`
- `docs/product-system/INTEGRATIONS.md`
- `docs/product-system/SURFACES.md`

Estos documentos se enlazan desde los nuevos modelos. Sólo se reemplazan si una auditoría demuestra que su propósito cambió.

### Diseño de producto

- `FM-MASTER-MAP.md`
- `MODULE-STATUS.md`
- `DESIGN-DECISIONS-v0.2.md`
- fichas `FM-MOD-*`
- FigJam Master Map
- Figma Product UI & Design System

El expediente de Ingeniería explica **qué y por qué**; Figma/FigJam muestran visualmente el sistema y la experiencia.

### Extensión WhatsApp

En `Flor-Mia-WhatsApp-Sender` ya existen:

- `docs/ARCHITECTURE.md`
- `docs/WEB-APP-PROTOCOL.md`
- `docs/ACCEPTANCE-TESTS.md`
- `docs/DIAGNOSTICS.md`
- `docs/PRIVACY-SECURITY.md`
- `docs/RECOVERY-MATRIX.md`
- `docs/RELEASE-CHECKLIST.md`

No se deben reescribir. El expediente global debe referenciarlos y modelar la extensión como subsistema.

## Artefactos globales vs artefactos por módulo

### Globales

Deben existir una sola vez para Flor Mía:

- contexto organizacional;
- alcance global;
- Diagrama de Contexto;
- DFD Nivel 0;
- actores/stakeholders globales;
- arquitectura de sistemas e integraciones;
- modelo conceptual de datos global;
- glosario/diccionario maestro;
- catálogo maestro de requisitos;
- matriz de trazabilidad.

### Por módulo o dominio

Se crean únicamente cuando el global no alcanza:

- DFD hijos;
- requisitos detallados;
- tablas de decisión;
- casos de uso;
- estados;
- secuencias;
- reglas de datos;
- criterios de aceptación.

Ejemplo:

`DFD Nivel 0 -> P3 Gestionar Ventas -> DFD hijo Ventas -> UC Registrar Venta -> RN de stock/pagos/descuentos -> secuencia -> servicios/código -> tests`

## Primer orden de construcción

### P0 — Base obligatoria

1. `02-CONTEXTO-ORGANIZACION-Y-SISTEMA.md`
2. `03-ALCANCE-Y-OBJETIVOS.md`
3. `05-STAKEHOLDERS-Y-ACTORES.md`
4. `10-CATALOGO-REQUISITOS.md` v0.1
5. `20-DIAGRAMA-CONTEXTO.md`
6. `21-DFD-NIVEL-0.md`

### P1 — Comprensión del dominio

7. `14-GLOSARIO-Y-DICCIONARIO-DE-DATOS.md`
8. `24-MODELO-DATOS-DER.md`
9. `30-CASOS-DE-USO.md`
10. `13-TABLAS-DE-DECISION.md`
11. `31-MODELO-DOMINIO-CLASES.md`
12. `32-DIAGRAMAS-DE-ESTADO.md`
13. `33-DIAGRAMAS-DE-SECUENCIA.md`

### P2 — Planificación y gobierno

14. `04-ESTUDIO-PRELIMINAR-Y-FACTIBILIDAD.md`
15. `40-PLAN-PROYECTO-WBS-PERT-GANTT.md`
16. `41-RIESGOS-Y-DEPENDENCIAS.md`
17. `42-ESTRATEGIA-DE-PRUEBAS.md`
18. `44-DECISIONES-DE-ARQUITECTURA.md`
19. `45-CONTROL-DE-CAMBIOS.md`

La factibilidad aparece metodológicamente temprano en la teoría, pero Flor Mía ya existe y está operativa. Por eso se puede documentar en paralelo sin bloquear la construcción inmediata del mapa de sistema/requisitos.

## Reglas para no burocratizar el proyecto

1. Un artefacto debe responder una pregunta concreta del diseño.
2. No duplicar contenido técnico ya fiable: enlazarlo.
3. No crear diagramas UML sólo porque existen en el temario.
4. Diagramar comportamiento complejo antes de programarlo.
5. Actualizar modelos cuando cambia una regla de negocio importante.
6. Separar siempre estado `MAIN`, `PREVIEW` y `PROPUESTO`.
7. Todo requisito importante debe terminar enlazado a pruebas o criterio de aceptación.
8. Las decisiones críticas deben conservar el motivo, no sólo el resultado.

## Resultado esperado

Cuando el expediente madure, Flor Mía tendrá dos mapas complementarios:

### Product Map

Responde:

- qué módulos existen;
- qué ve el usuario;
- cómo se relacionan las experiencias;
- qué está actual/propuesto.

### Engineering Map

Responde:

- qué problema resuelve el sistema;
- cuáles son sus límites;
- qué actores y sistemas externos existen;
- qué requisitos gobiernan cada función;
- cómo fluyen y se almacenan los datos;
- qué reglas deciden el comportamiento;
- cómo interactúan dominios/componentes;
- qué código satisface cada requisito;
- qué prueba demuestra que funciona.

Ambos deben mantenerse conectados mediante IDs estables.