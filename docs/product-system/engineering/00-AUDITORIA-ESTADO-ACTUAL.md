# Auditoría estructural inicial — Flor Mía

Fecha de corte: **2026-09-08**  
Tipo: **auditoría de arquitectura, documentación y estado de producto**  
Estado: **v0.1 — línea base para continuar análisis módulo por módulo**

## 1. Objetivo de esta auditoría

Establecer una línea base confiable antes de continuar diseñando Flor Mía.

Esta auditoría no pretende declarar que cada línea de código fue revisada exhaustivamente. Su finalidad inicial es determinar:

- qué sistemas y repositorios forman Flor Mía;
- qué superficies existen;
- qué módulos están especializados y cuáles son todavía genéricos;
- qué documentación ya existe y puede reutilizarse;
- dónde conviven estados `MAIN`, `PREVIEW` y `PROPUESTO`;
- qué modelos de Ingeniería de Software faltan para poder seguir diseñando con trazabilidad.

## 2. Hallazgo principal

Flor Mía ya no es una sola aplicación web. Es un **sistema de información compuesto**.

La unidad de análisis correcta incluye, como mínimo:

1. Web pública / ecommerce.
2. Panel de Administración.
3. Panel de Vendedor.
4. Firebase Authentication / Firestore / Rules.
5. Netlify y funciones server-side.
6. Chrome Extension `Flor-Mia-WhatsApp-Sender`.
7. WhatsApp Web como sistema externo.
8. Integraciones actuales o previstas: OpenAI, Google Drive, Meta y otras futuras.

Consecuencia: los diagramas globales deben mostrar fronteras y flujos entre subsistemas. No es correcto modelar la extensión como si fuese simplemente un componente visual de React, ni modelar WhatsApp Web como si perteneciera al código de Flor Mía.

## 3. Repositorios auditados

### 3.1 Web App Integral

Repositorio:

`AgustinBazanUB/App-Integral-FM`

La estructura actual contiene, entre otros:

- superficie pública React/Vite;
- `src/gestion/` para la aplicación privada;
- servicios, dominio y permisos;
- módulos de inventario y ubicaciones;
- tests;
- Firestore Rules e índices;
- configuración Firebase;
- configuración Netlify;
- documentación de arquitectura, auditoría, diseño, implementación y módulos.

La documentación existente ya declara una separación de capas de presentación, autenticación/permisos, servicios, dominio y datos. También existe un mapa de rutas administrativas y una matriz base de roles/permisos.

### 3.2 Extensión WhatsApp

Repositorio:

`AgustinBazanUB/Flor-Mia-WhatsApp-Sender`

Es una aplicación/runtime separado basado en Chrome Manifest V3, con arquitectura propia:

- Service Worker;
- CampaignEngine;
- ContactEngine;
- content scripts;
- bridge con la Web App;
- interacción semántica con WhatsApp Web;
- almacenamiento local/IndexedDB;
- compatibilidad y preflight;
- diagnósticos;
- popup;
- suite de tests y documentación técnica.

La extensión posee una separación interna considerablemente más formal que la que se aprecia si sólo se observa la pantalla de Marketing en la Web App.

## 4. Estado documental existente

La Web App ya posee documentación útil que debe reutilizarse:

- `docs/ARQUITECTURA.md`;
- `docs/AUDITORIA.md`;
- `docs/BACKLOG.md`;
- `docs/DECISIONES.md`;
- `docs/ESPECIFICACION-FUNCIONAL.txt`;
- `docs/FIRESTORE-MODEL.md`;
- `docs/FLOR-MIA-DESIGN-SYSTEM.txt`;
- documentación por etapas de Meta Ads;
- documentación de Productos/Stock/Depósitos;
- documentación del contrato con la extensión;
- manuales y documentos de implementación.

Además, la rama `design/fm-master-map-v0.2` agrega una capa de diseño de producto con:

- Master Map;
- estados de módulos;
- decisiones de diseño;
- Code Map;
- superficies;
- integraciones;
- workflow diseño → implementación;
- fichas por módulo;
- vínculo FigJam / Figma / código.

Conclusión: **no conviene reemplazar esta documentación**. Debe organizarse bajo una estructura de Ingeniería de Software y completar los huecos.

## 5. Estado de módulos observado

El Product System actual distingue aproximadamente:

### Especializados / con implementación propia

- Panel General.
- Ubicaciones.
- Productos.
- Ventas Rápidas.
- Clientes.
- Métricas.
- Depósitos.
- Campañas WhatsApp.
- Meta Ads.
- partes del Ecommerce / Storefront.

### Genéricos o todavía incompletos en diseño detallado

- Finanzas.
- Envíos.
- Alertas.
- Proveedores.
- parte de Redes Sociales.
- parte de Ecommerce administrativo.

### Diseño en evolución

- Ubicaciones v0.2.
- Ventas Rápidas v0.2.
- Clientes v0.2.
- Depósitos v0.2.
- WhatsApp Inbox.
- Marketing WhatsApp.
- Meta Ads por etapas.
- Gestión de Envíos.

Este inventario deberá convertirse luego en una matriz requisito ↔ módulo ↔ implementación ↔ test.

## 6. Hallazgo de configuración: no existe un único “estado actual”

Actualmente deben distinguirse al menos tres estados técnicos:

### A. `PROD/MAIN`

Lo incorporado a `main` y/o desplegado a la línea base aprobada.

### B. `PREVIEW`

Trabajo real implementado en ramas/PR pero todavía no fusionado a `main`.

Ejemplos observados en la Web App:

- WhatsApp Inbox + CRM hardening;
- alta segura de clientes y cooldown basado en resultado confirmado;
- etapas superiores de Meta Ads;
- FM Master Product System v0.2.

Ejemplos observados en la extensión:

- Contact Export avanzado;
- agregar contactos por frase;
- resultados individuales de campaña;
- correcciones de transición multimedia → texto;
- integración documental con el FM Master Map.

### C. `PROPUESTO`

Decisiones ya diseñadas o especificadas que no deben confundirse con comportamiento disponible.

Este hallazgo es crítico. Todo documento futuro deberá indicar explícitamente qué versión representa.

## 7. Integración Web App ↔ extensión

La frontera técnica auditada es conceptualmente:

`Web App -> extensionBridge -> web-app-bridge -> Service Worker -> CampaignEngine -> ContactEngine -> WhatsApp Web`

El retorno conceptual es:

`WhatsApp Web -> extensión -> evento/snapshot saneado -> reconciliación Web App -> UI/persistencia autorizada`

Responsabilidades que deben mantenerse separadas:

### Web App

- CRM;
- identidad de cliente;
- configuración de campaña;
- selección de destinatarios;
- UX;
- persistencia de negocio autorizada;
- métricas y relación con otros módulos.

### Extensión

- ejecución técnica sobre WhatsApp Web;
- checkpoints;
- scheduler;
- compatibilidad;
- verificación;
- estado técnico;
- diagnóstico;
- publicación de resultados saneados.

### WhatsApp Web

- sistema externo no controlado por Flor Mía.

No debe trasladarse lógica CRM a la extensión ni selectores/DOM de WhatsApp al repositorio principal.

## 8. Fortalezas detectadas

1. Ya existe separación razonable entre UI, dominio, servicios, permisos y datos en partes importantes de la Web App.
2. La extensión tiene límites arquitectónicos explícitos y fuerte tratamiento de estados, checkpoints y diagnóstico.
3. Existen tests, reglas de Firestore y flujos de Deploy Preview.
4. Ya existe Design System y un trabajo inicial serio de trazabilidad Figma/FigJam ↔ código.
5. El proyecto utiliza ramas/preview para muchos cambios antes de producción.
6. Hay documentación técnica suficiente para no tener que reconstruir el conocimiento desde cero.

## 9. Debilidades / riesgos estructurales detectados

### 9.1 Documentación fragmentada

Hay mucha documentación, pero todavía no existe un expediente único que permita ir desde objetivo de negocio hasta requisito, proceso, dato, diseño, código y prueba.

### 9.2 Línea base difusa

La funcionalidad más nueva se reparte entre múltiples PRs/ramas. Esto aumenta el riesgo de diseñar contra una versión distinta de la que luego se implementa.

### 9.3 Falta de catálogo global de requisitos

Existen especificaciones funcionales y decisiones por módulos, pero falta una nomenclatura global y trazabilidad sistemática de requisitos funcionales/no funcionales.

### 9.4 Falta de modelo global de procesos

Existe mapa de módulos e integraciones, pero falta un Diagrama de Contexto formal y un DFD Nivel 0 que expliquen qué información entra, qué procesos principales la transforman, dónde se almacena y qué sale.

### 9.5 Arquitectura de datos incompleta como artefacto de diseño

Firestore está documentado técnicamente, pero el Product System reconoce que todavía falta una etapa específica de Data Architecture. Debe crearse un DER conceptual/lógico más un Diccionario de Datos que no dependa únicamente de los nombres actuales de colecciones.

### 9.6 Reglas de negocio distribuidas

Hay reglas importantes en servicios, dominio, UI, Firestore Rules y contratos entre repositorios. Falta concentrarlas en un catálogo de Reglas de Negocio y usar Tablas de Decisión donde existan combinaciones complejas.

Ejemplos candidatos:

- venta según origen/stock/permisos/descuentos/pagos;
- creación/importación/deduplicación de clientes;
- estados y permisos de campañas WhatsApp;
- cooldown de clientes;
- transferencias y stock negativo controlado;
- estados de Envíos;
- permisos por rol;
- estados/aprobaciones de Meta Ads.

### 9.7 Modelos UML parciales o ausentes a nivel de sistema

La extensión tiene máquinas de estado y arquitectura técnica, pero el sistema completo no posee todavía un catálogo central de Casos de Uso, modelo de dominio, secuencias e interacciones entre subsistemas.

### 9.8 Riesgo de diseñar por pantalla en vez de por proceso

Algunos módulos futuros pueden terminar diseñándose como una colección de pantallas sin haber definido primero objetivo, actor, flujo, reglas, datos, estados y errores.

## 10. Decisión metodológica

A partir de este corte, cada módulo debe analizarse en dos dimensiones:

### Dimensión de negocio

- objetivo;
- actores;
- requisitos;
- procesos;
- reglas;
- datos;
- excepciones;
- métricas/resultado.

### Dimensión de software

- superficie/UI;
- rutas/componentes;
- dominio;
- servicios;
- persistencia;
- permisos;
- integraciones;
- tests;
- estado MAIN/PREVIEW/PROPUESTO.

Diseñar sólo una de las dos dimensiones se considerará incompleto.

## 11. Primeros artefactos que deben construirse

Orden recomendado:

1. Contexto de organización y sistema.
2. Alcance y objetivos.
3. Stakeholders/actores.
4. Catálogo inicial de requisitos.
5. Diagrama de Contexto.
6. DFD Nivel 0.
7. Diccionario de Datos + DER conceptual.
8. Casos de Uso globales.
9. Priorización de módulos.
10. Análisis profundo módulo por módulo.

Después de esa base pueden desarrollarse DFD hijos, tablas de decisión, estados y secuencias únicamente donde aporten información real.

## 12. Recomendación de prioridad funcional

La siguiente iteración no debería intentar documentar todos los módulos con el mismo detalle.

Prioridad sugerida para consolidar el modelo:

1. Identidad de Producto + Inventario + Ubicaciones + Depósitos.
2. Venta + Cliente + Pagos/Descuentos.
3. WhatsApp Marketing + extensión.
4. WhatsApp Inbox + CRM.
5. Envíos.
6. Ecommerce.
7. Meta Ads.
8. Finanzas / Proveedores / Alertas.

La razón es que los primeros grupos forman los datos y transacciones centrales que luego consumen buena parte de los módulos restantes.

## 13. Criterio para considerar finalizada la auditoría

La auditoría global podrá considerarse estable cuando:

- todos los módulos estén inventariados;
- cada módulo tenga estado MAIN/PREVIEW/PROPUESTO;
- el Diagrama de Contexto y DFD Nivel 0 estén validados;
- exista catálogo inicial de requisitos;
- las entidades de negocio principales estén identificadas;
- las integraciones estén delimitadas;
- las ramas activas relevantes estén mapeadas;
- se haya definido qué documentación es fuente de verdad para cada tipo de decisión.

A partir de ahí, la auditoría deja de ser un relevamiento inicial y se convierte en mantenimiento continuo del expediente.