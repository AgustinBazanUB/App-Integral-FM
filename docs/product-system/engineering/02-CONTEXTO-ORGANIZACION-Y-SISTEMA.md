# Contexto, Organización y Sistema — Flor Mía

Fecha: **2026-09-08**  
Estado: **v0.1 — base para alcance, actores y Diagrama de Contexto**

## 1. Propósito del documento

Definir Flor Mía desde la perspectiva de Ingeniería de Software antes de describir pantallas o detalles de implementación.

Este documento responde:

- cuál es la organización que utiliza el sistema;
- cuál es el propósito del sistema;
- qué subsistemas forman Flor Mía;
- qué elementos pertenecen al ambiente externo;
- qué datos/información entran y salen;
- qué procesos organizacionales busca soportar;
- dónde se encuentra hoy la frontera entre operación manual y automatizada.

## 2. Organización bajo estudio

**Flor Mía** es una organización comercial que necesita coordinar, desde un único ecosistema de información, procesos de operación, venta, inventario, clientes, logística, ecommerce, marketing, administración y control.

Las funciones representadas actualmente o previstas en el software incluyen:

- catálogo de productos;
- ubicaciones/puntos operativos;
- depósitos e inventario;
- movimientos y transferencias de stock;
- ventas;
- vendedores;
- clientes/CRM;
- pagos y descuentos;
- métricas;
- ecommerce;
- envíos;
- marketing por WhatsApp;
- atención/conversaciones de WhatsApp;
- Meta Ads;
- proveedores;
- finanzas;
- alertas;
- usuarios, roles, permisos y auditoría.

## 3. Problema organizacional general

A medida que Flor Mía incorpora nuevos canales y procesos, la información deja de pertenecer a una sola pantalla o tarea.

Ejemplos:

- una venta modifica stock y luego alimenta métricas y el historial del cliente;
- un cliente puede ser utilizado por ventas, marketing, ecommerce, envíos y WhatsApp;
- un producto puede existir en catálogo, múltiples ubicaciones, depósitos, ecommerce y campañas;
- una campaña de WhatsApp se diseña en la Web App pero técnicamente se ejecuta mediante otra aplicación: la extensión Chrome;
- un envío relaciona cliente, dirección, venta/pedido, productos y estado logístico;
- Meta Ads combina datos internos, IA y proveedores externos.

El problema de diseño no es únicamente “crear pantallas”. Es mantener **identidad, reglas, trazabilidad y consistencia de información entre procesos relacionados**.

## 4. Objetivo general del sistema de información

El sistema Flor Mía debe permitir que la organización registre, procese, consulte y relacione información operativa y de gestión utilizando fuentes de verdad coherentes, evitando duplicaciones innecesarias y permitiendo que diferentes módulos colaboren sobre las mismas entidades de negocio.

Objetivos generales preliminares:

1. centralizar la identidad de productos, clientes y demás entidades maestras;
2. preservar integridad de stock y trazabilidad de movimientos;
3. registrar ventas y sus efectos de manera consistente;
4. permitir operación diferenciada según rol y superficie;
5. integrar canales externos sin trasladar sus particularidades técnicas al dominio central;
6. generar información útil para control, métricas y toma de decisiones;
7. reducir tareas manuales repetitivas cuando su automatización sea segura;
8. mantener auditabilidad y capacidad de recuperación ante errores;
9. permitir evolución modular sin crear arquitecturas paralelas para cada nueva función.

Estos objetivos deberán recibir IDs `FM-OBJ-*` en el documento de alcance/requisitos.

## 5. Definición del sistema

Para este expediente se define **Sistema Integral Flor Mía** como:

> Conjunto coordinado de aplicaciones, servicios, datos, reglas e integraciones que reciben información de usuarios y sistemas externos, la procesan de acuerdo con las reglas de negocio de Flor Mía, mantienen el estado necesario para operar y producen acciones e información para los distintos actores de la organización.

La definición es deliberadamente más amplia que “Web App Integral”, porque parte del comportamiento depende de runtimes separados.

## 6. Suprasistema, sistema y subsistemas

### 6.1 Suprasistema

La organización **Flor Mía** y su operación comercial completa.

El software no representa toda la organización: existen actividades humanas, decisiones, movimientos físicos y relaciones con terceros que continúan fuera del sistema informático.

### 6.2 Sistema

**Sistema Integral Flor Mía**.

### 6.3 Subsistemas principales

#### FM-SUB-01 — Storefront / Ecommerce público

Responsable de la experiencia pública de navegación de productos, carrito/checkout y futuras operaciones ecommerce completas.

#### FM-SUB-02 — Aplicación de Gestión / Administrador

Responsable de administración, operación transversal, configuración y módulos de negocio bajo `/gestion`.

#### FM-SUB-03 — Aplicación de Vendedor

Superficie especializada para venta operativa, inventario disponible, carrito, pagos, descuentos, clientes y operaciones permitidas al vendedor.

#### FM-SUB-04 — Núcleo de Datos y Autorización

Firebase Authentication + Firestore + Rules y servicios relacionados que sostienen identidad, persistencia, permisos e integridad de operaciones.

#### FM-SUB-05 — Backend / Integraciones Server-Side

Netlify Functions y servicios backend utilizados para operaciones que no deben ejecutarse completamente en el navegador, incluyendo integraciones con proveedores externos e IA.

#### FM-SUB-06 — Flor Mía WhatsApp Sender

Extensión Chrome independiente responsable de la ejecución técnica y segura de funciones autorizadas sobre WhatsApp Web.

#### FM-SUB-07 — Capa de Diseño y Conocimiento del Producto

FigJam, Figma, documentación funcional/arquitectónica y este expediente. No participa del runtime productivo, pero mantiene el conocimiento necesario para diseñar y evolucionar el sistema.

## 7. Sistemas externos

Los siguientes elementos se consideran **externos a Flor Mía** aunque exista una integración con ellos:

### EXT-01 — WhatsApp Web

Plataforma externa utilizada por la extensión. Su interfaz/DOM no pertenece al sistema y puede cambiar independientemente.

### EXT-02 — OpenAI

Proveedor externo de capacidades de IA utilizado desde integraciones controladas/server-side cuando corresponde.

### EXT-03 — Google Drive

Proveedor externo para almacenamiento/gestión de activos en flujos que lo utilizan.

### EXT-04 — Meta

Proveedor externo relacionado con Meta Ads y futuras operaciones sobre Marketing API/Insights.

### EXT-05 — Infraestructura/proveedores futuros

ARCA, medios de pago, logística, mensajería u otros servicios se incorporarán como entidades/sistemas externos cuando su integración sea diseñada.

## 8. Actores humanos preliminares

La arquitectura actual contempla o sugiere, como mínimo:

- Administrador general.
- Administrador operativo.
- Encargado de ubicación.
- Vendedor.
- Responsable de depósito.
- Responsable de marketing.
- Responsable ecommerce.
- Responsable de envíos.
- Responsable de proveedores.
- Responsable financiero.
- Analista.
- Cliente/usuario ecommerce.

La lista definitiva y sus objetivos se documentarán en `05-STAKEHOLDERS-Y-ACTORES.md`.

## 9. Entradas principales del sistema

A nivel conceptual, el sistema recibe información como:

### Datos maestros

- productos;
- categorías;
- clientes;
- ubicaciones;
- depósitos;
- usuarios/roles;
- proveedores;
- configuraciones.

### Datos transaccionales

- ventas;
- productos/cantidades de una operación;
- pagos;
- descuentos;
- movimientos de stock;
- transferencias;
- pedidos;
- envíos;
- cambios de estado.

### Datos de canales/integraciones

- destinatarios de campañas;
- contenido de campañas;
- resultados técnicos de la extensión;
- contexto de marketing;
- assets;
- resultados de servicios externos;
- información ecommerce.

### Acciones de usuario

- crear;
- consultar;
- modificar;
- aprobar;
- anular;
- transferir;
- vender;
- importar/exportar;
- iniciar/pausar/reanudar/detener procesos;
- configurar.

## 10. Salidas principales

El sistema produce, entre otras:

- confirmaciones de operaciones;
- stock actualizado;
- comprobantes/registros de venta;
- historial de movimientos;
- estados de clientes;
- estados de campañas;
- métricas e indicadores;
- alertas;
- reportes;
- pedidos/envíos y sus estados;
- acciones técnicas solicitadas a sistemas externos;
- información para toma de decisiones;
- trazas/auditoría autorizadas.

## 11. Datos vs información

En este diseño se utilizará la distinción:

- **Dato:** valor almacenado o recibido de manera aislada.
- **Información:** resultado de interpretar/procesar datos dentro de un contexto útil.

Ejemplos Flor Mía:

- `15` es un dato; `Stock disponible de Producto X = 15 unidades` es información.
- un teléfono normalizado es un dato; `Cliente existente, disponible para campaña y con última compra hace 30 días` es información derivada.
- una venta individual es un conjunto de datos transaccionales; `facturación mensual por ubicación` es información de gestión.

Esta diferencia será importante al definir DFD, Diccionario de Datos y métricas.

## 12. Clasificación funcional preliminar del sistema de información

Flor Mía combina distintos niveles de sistema de información:

### Procesamiento transaccional

El núcleo de ventas, stock, movimientos, transferencias y operaciones similares funciona como un sistema de procesamiento de transacciones: registra hechos operativos que deben mantener consistencia.

### Información administrativa

Dashboard, métricas, actividad y reportes convierten transacciones en información para seguimiento y gestión.

### Soporte a decisiones

Métricas avanzadas, análisis de marketing y funciones de IA pueden asistir decisiones, sin reemplazar necesariamente la aprobación humana.

Esta clasificación es conceptual. No implica separar físicamente la aplicación en tres productos.

## 13. Frontera funcional: qué está adentro y qué está afuera

### Dentro del Sistema Integral Flor Mía

- reglas propias de negocio;
- identidad y relaciones de las entidades internas;
- permisos internos;
- experiencia de usuario propia;
- persistencia propia;
- contratos internos entre sus aplicaciones;
- validaciones propias;
- auditoría propia;
- decisiones sobre cuándo y cómo llamar a integraciones.

### Fuera del sistema

- reglas internas de WhatsApp/Meta/Google/OpenAI;
- DOM de WhatsApp Web;
- disponibilidad de proveedores externos;
- procesamiento interno de APIs externas;
- movimiento físico real de mercadería;
- decisiones humanas no automatizadas;
- acciones de terceros que no sean observables mediante un contrato disponible.

El sistema puede **registrar o reaccionar** ante estos hechos sin convertirse en su propietario.

## 14. Procesos organizacionales de alto nivel

Lista inicial para derivar el DFD Nivel 0:

- P1 — Administrar productos y datos maestros.
- P2 — Gestionar inventario y movimientos.
- P3 — Gestionar ventas.
- P4 — Gestionar clientes y CRM.
- P5 — Gestionar ecommerce/pedidos.
- P6 — Gestionar envíos.
- P7 — Gestionar marketing y canales.
- P8 — Gestionar métricas, control y alertas.
- P9 — Gestionar proveedores/finanzas.
- P10 — Administrar usuarios, permisos y configuración.

La lista es provisional. El DFD Nivel 0 deberá limitar/agrupar procesos para mantener un modelo comprensible y, si es necesario, descomponerlos en diagramas hijos.

## 15. Almacenes conceptuales preliminares

Antes de hablar de colecciones Firestore específicas, se reconocen almacenes conceptuales como:

- D1 — Productos.
- D2 — Clientes.
- D3 — Ubicaciones.
- D4 — Depósitos.
- D5 — Inventario/Stock.
- D6 — Ventas.
- D7 — Movimientos de Stock.
- D8 — Usuarios/Roles/Permisos.
- D9 — Campañas/Marketing.
- D10 — Pedidos/Ecommerce.
- D11 — Envíos.
- D12 — Proveedores.
- D13 — Finanzas.
- D14 — Auditoría/Actividad.
- D15 — Configuración.

Esta lista representa el dominio lógico y no debe forzar una colección física uno-a-uno.

## 16. Procesos manuales vs automatizados

Uno de los objetivos del análisis será marcar, para cada proceso:

- `MANUAL`: realizado fuera del software;
- `ASISTIDO`: el software prepara/guía pero una persona completa la acción;
- `AUTOMATIZADO`: el sistema ejecuta la operación según reglas;
- `EXTERNO`: la operación ocurre en un proveedor externo;
- `HÍBRIDO`: combina los anteriores.

Ejemplos preliminares:

- movimiento físico de una caja: manual;
- registro del movimiento de stock: automatizado/asistido según flujo;
- campaña WhatsApp: híbrida, porque Flor Mía configura y controla mientras la extensión ejecuta técnicamente sobre WhatsApp Web;
- creación de estrategia Meta Ads con IA: asistida, porque existen etapas de aprobación humana;
- preparación física de un envío: manual con estado digital asociado.

## 17. Restricciones arquitectónicas conocidas

- Firestore debe mantenerse con consumo controlado.
- No duplicar datos/colecciones sin necesidad de dominio.
- Operaciones críticas de stock/ventas requieren integridad fuerte.
- Permisos de UI no reemplazan Firestore Rules.
- La extensión debe mantener separación respecto del CRM.
- WhatsApp Web es una dependencia externa inestable.
- secretos/API keys no deben residir en frontend.
- cambios relevantes se prueban primero fuera de `main/producción` cuando corresponda.
- el sistema debe conservar trazabilidad suficiente para diagnosticar errores sin exponer información innecesaria.

## 18. Preguntas que quedan abiertas para las próximas etapas

Este documento no intenta resolver todavía:

- alcance exacto de cada módulo futuro;
- todos los requisitos funcionales y no funcionales;
- relaciones definitivas del modelo de datos;
- procesos definitivos del DFD;
- casos de uso completos;
- criterios económicos de factibilidad;
- priorización temporal del roadmap.

Esas respuestas se incorporarán en los artefactos siguientes.

## 19. Resultado de esta etapa

A partir de esta definición, Flor Mía debe modelarse como un **sistema compuesto con múltiples subsistemas y sistemas externos**, compartiendo entidades y reglas de negocio.

El próximo resultado lógico es construir:

1. `03-ALCANCE-Y-OBJETIVOS.md`;
2. `05-STAKEHOLDERS-Y-ACTORES.md`;
3. `10-CATALOGO-REQUISITOS.md` v0.1;
4. `20-DIAGRAMA-CONTEXTO.md`.

Esos cuatro artefactos permitirán pasar de una descripción verbal del sistema a un modelo verificable y trazable.