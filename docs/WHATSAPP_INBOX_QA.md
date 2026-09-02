# WhatsApp Inbox — QA y hardening (Prompt Maestro 2)

Fecha: 2026-09-02

Ramas de trabajo seguras:

- Web App: `fix/whatsapp-inbox-hardening`
- Extensión: `fix/whatsapp-inbox-hardening`

No se trabajó sobre `main`, no se hizo merge y no se realizó deploy productivo.

## Convención de estados

- **PASS**: validado automáticamente o por inspección determinística suficiente.
- **FAIL**: validación ejecutada y fallida.
- **PARTIAL**: la parte automatizable pasó, pero falta una comprobación real de navegador/WhatsApp.
- **NOT TESTED**: no ejecutado.
- **BLOCKED**: requiere una capacidad/sesión externa no disponible en este entorno.

## Problemas importantes corregidos

### 1. TypeScript de extensión

**PROBLEMA**: el workflow de Prompt 1 fallaba en typecheck con siete errores.

**CAUSA**: cinco errores provenían de inferir `crypto.randomUUID()` con un tipo template-literal UUID más estrecho que `string`; después se intentaban asignar IDs de request válidos representados como `string`. Dos errores adicionales provenían de acceder a `rows[index]` sin demostrar a TypeScript que el elemento existía.

**SOLUCIÓN**: se tipó explícitamente el identificador como `string` en el límite adecuado y se protegió el acceso potencialmente `undefined`. No se usaron `any`, `as any`, `@ts-ignore`, `@ts-expect-error` ni relajación de `strict`.

**RIESGO**: bajo. La corrección alinea tipos con el contrato real y no altera el protocolo.

**VALIDACIÓN**: typecheck, lint, tests, build y validate-build de extensión PASS.

### 2. Duplicado técnico de SEND_TEXT

**PROBLEMA**: una misma operación técnica podía volver a llegar después de reinyección/reintento o wake-up de Manifest V3.

**CAUSA**: los guards de listeners evitaban buena parte del problema, pero no existía idempotencia persistente de la operación SEND_TEXT.

**SOLUCIÓN**: el service worker del Inbox conserva un cache acotado de resultados por `requestId` y un mapa in-flight. El mismo `requestId` + mismo payload reutiliza el resultado; el mismo `requestId` con payload diferente se rechaza; dos `requestId` distintos con texto idéntico siguen siendo dos envíos intencionales válidos.

**RIESGO**: evita el doble click técnico sin deduplicar por texto.

**VALIDACIÓN**: tests Inbox de extensión PASS.

### 3. Concurrencia con campañas/exportación

**PROBLEMA**: Inbox, campañas, Contact Export y extracción pueden manipular la UI de WhatsApp Web y competir por la conversación activa.

**CAUSA**: Prompt 1 aisló protocolos, pero no arbitraba todas las operaciones que cambian de chat.

**SOLUCIÓN**: `inbox-service-worker.ts` consulta estados ya existentes de campaña, Contact Export y Add Contacts. `GET_CHATS` puede mantenerse como lectura cuando es seguro, pero abrir conversación/leer conversación mediante navegación y enviar quedan bloqueados durante estados incompatibles. Campañas en `received` y `ready` también reservan estas operaciones para cerrar la ventana prepare→start.

**RIESGO**: se privilegia bloquear temporalmente el Inbox antes que enviar a un destinatario incorrecto.

**VALIDACIÓN**: tests de coordinación y suite completa de la extensión PASS. Convivencia visual real en Chrome: PARTIAL/BLOCKED.

### 4. Identidad de chat y reordenamiento

**PROBLEMA**: una identidad derivada de posición, preview o contenido mutable puede apuntar a otra fila cuando WhatsApp reordena chats.

**SOLUCIÓN**: prioridad `structured id/JID` → teléfono individual → nombre como último fallback. Nunca se usa el índice DOM como identidad. Se expone `identityConfidence` para no ocultar la calidad del fallback.

**VALIDACIÓN**: tests de adapter/reordenamiento PASS; validación contra DOM vivo: PARTIAL.

### 5. Draft preexistente

**PROBLEMA**: un envío desde Inbox no debe borrar, concatenar ni enviar un draft ya escrito en WhatsApp Web.

**SOLUCIÓN**: si el composer contiene contenido incompatible, se bloquea con `COMPOSER_HAS_DRAFT`. No se destruye el texto existente.

**VALIDACIÓN**: tests adapter PASS; prueba manual con WhatsApp Web real: BLOCKED.

### 6. Estado de envío ambiguo

**PROBLEMA**: refresh/desconexión después del click puede impedir saber si WhatsApp aceptó el mensaje.

**SOLUCIÓN**: si hubo intento de click pero no confirmación suficiente, se devuelve `SEND_STATUS_UNKNOWN` en lugar de declarar `sent`. Ese resultado también participa de la idempotencia para evitar un retry ciego de la misma operación.

**VALIDACIÓN**: tests PASS; refresh real durante envío: BLOCKED.

### 7. N+1 de Clientes

**PROBLEMA**: la pantalla podía resolver hasta un cliente por lectura directa para cada chat visible.

**SOLUCIÓN**: se calculan los IDs determinísticos de cliente y se consultan por lotes de hasta 30 usando `documentId() in [...]`, con cache de sesión. Para 80 teléfonos válidos no cacheados el diseño baja de hasta 80 lookups a aproximadamente 3 queries.

**VALIDACIÓN**: tests de Web App PASS y build PASS.

### 8. Alta concurrente del mismo cliente

**PROBLEMA**: un patrón “buscar y luego crear” puede perder una carrera contra otra importación/usuario.

**SOLUCIÓN**: `createCustomerFromAdminIfMissing` usa el ID determinístico por teléfono y `runTransaction` para comprobar/crear atómicamente sin sobreescribir una alta concurrente existente.

**VALIDACIÓN**: tests estáticos/focalizados PASS. Emulador multiusuario específico: NOT TESTED.

### 9. Orígenes de Deploy Preview

**PROBLEMA**: el manifest 0.9.6 heredado declaraba `https://*.netlify.app/*` y luego reducía por `include_globs`/runtime. Aunque el runtime era estricto, la declaración base era más amplia de lo necesario.

**SOLUCIÓN**: se quitó el wildcard general. Producción y localhost conservan orígenes exactos. Un preview sólo puede añadirse al build si el hostname cumple exactamente `deploy-preview-N--appintegralflormia.netlify.app` o `deploy-preview-N--app-integral-fm.netlify.app`.

**VALIDACIÓN**: tests de seguridad + build + validate-build de extensión PASS.

## Estrategia definitiva de etiquetas

Se mantienen conceptos separados:

1. **Zonas/segmentación CRM**: pertenecen a Clientes y son persistentes. Inbox utiliza los mismos servicios y catálogo de zonas.
2. **Etiquetas de WhatsApp Business**: pertenecen a WhatsApp y la extensión 0.9.6 puede detectarlas para Contact Export mediante una navegación específica de la UI de etiquetas.
3. **Tags CRM**: el dominio actual de Clientes no posee un modelo persistente equivalente a las etiquetas de WhatsApp.

Por lo tanto:

- no se crea una colección paralela de tags;
- no se escribe `customer.tags` inventado;
- no se sincronizan automáticamente etiquetas de WhatsApp a zona/CRM;
- el Inbox puede mostrar etiquetas de WhatsApp cuando estén disponibles de forma segura, pero la edición por chat queda fuera de este hardening porque la única estrategia existente recorre/manipula la UI de Labels y sería riesgoso hacerla competir con campaña/export/inbox;
- si se desea segmentación por tags CRM en el futuro, debe crearse primero un modelo de dominio/servicio en Clientes y luego definir un mapeo explícito y opt-in con WhatsApp.

## Matriz de QA

| Caso | Estado | Evidencia / alcance |
|---|---|---|
| Extension TypeScript | PASS | workflow final de extensión |
| Extension lint completo | PASS | workflow final de extensión |
| Extension Inbox tests | PASS | Vitest focalizado |
| Suite completa extensión | PASS | incluye regresiones existentes |
| Extension build | PASS | workflow |
| validate-build | PASS | paquete generado validado |
| Web App TypeScript | NOT TESTED | proyecto JS/JSX: no existe script/typecheck TS |
| Web App lint | NOT TESTED | package.json no define lint |
| Web App Inbox tests | PASS | node:test focalizado |
| Web App WhatsApp regressions | PASS | suite WhatsApp |
| Web App Clientes regressions | PASS | customer tests |
| Web App Meta Ads regressions | PASS | tests existentes |
| Web App build | PASS | Vite build en CI |
| npm test completo Web App | EN PROGRESO | main ya heredaba tests estáticos rojos; se están saneando sin reintroducir arquitectura obsoleta |
| lista de chats | PARTIAL | adapter/tests PASS; DOM vivo requiere Chrome |
| no leídos multi-dígito / 99+ | PASS | parser y tests |
| abrir conversación | PARTIAL | identidad/adapter testeados; DOM vivo pendiente |
| leer mensajes | PARTIAL | adapter/tests; DOM vivo pendiente |
| enviar texto | PARTIAL | lógica, draft, confirmación e idempotencia testeadas; envío real no ejecutado |
| dos “Hola” intencionales | PASS | IDs de operación diferentes no se deduplican por texto |
| mismo SEND_TEXT técnico repetido | PASS | requestId idempotente |
| draft preexistente | PASS/PARTIAL | protección automatizada PASS; prueba real BLOCKED |
| reordenamiento de chats | PASS/PARTIAL | identidad estable testeada; DOM vivo pendiente |
| teléfono no visible | PASS | no se inventa teléfono; CRM queda no relacionado |
| grupo | PASS | detectado y excluido de CRM/send Inbox |
| canal/comunidad | PASS/PARTIAL | clasificación por IDs/heurísticas testeada; variantes DOM reales pendientes |
| chats archivados | PARTIAL | sólo se procesan filas disponibles; no se fuerza navegación frágil al archivo |
| MV3 reinjection | PASS/PARTIAL | guards + idempotencia testeados; suspensión real de Chrome pendiente |
| service worker restart | PASS/PARTIAL | cache/idempotencia persistente; ciclo real Chrome pendiente |
| refresh WhatsApp durante envío | PARTIAL/BLOCKED | estado UNKNOWN diseñado; escenario real requiere navegador |
| selector faltante | PASS | falla con error estructurado, no envío silencioso |
| teléfono AR extremo | PASS | variantes centralizadas en customerDomain |
| teléfono extranjero | PASS | política existente del CRM conservada |
| cliente existente | PASS | lookup determinístico/batch |
| cliente nuevo | PASS | servicio existente + transacción if-missing |
| duplicado concurrente | PASS/PARTIAL | transacción implementada; emulador concurrente no ejecutado |
| zona existente | PASS | servicios reales de Clientes |
| sin zona | PASS | filtro local y estado explícito |
| zona personalizada | PASS | se usa catálogo/campos del CRM, sin lista hardcodeada Inbox |
| etiquetas | PARTIAL | estrategia definida; edición WhatsApp per-chat no implementada |
| permisos ruta/lectura | PASS | routing + permisos existentes |
| permisos responder | PASS | exige Social create/edit |
| permisos modificar CRM | PASS | exige permisos loyal-customers existentes |
| payload vacío/whitespace/enorme | PASS | validación de protocolo/adapter |
| action desconocida | PASS | whitelist de protocolo |
| requestId manipulado/repetido | PASS | validación + idempotencia |
| origen web no autorizado | PASS | origin exacto + runtime validation |
| XSS por mensajes | PASS | React text rendering; sin dangerouslySetInnerHTML/innerHTML |
| 100/500/1000 clientes | PARTIAL | se eliminó N+1 y el Inbox limita el payload de chats; benchmark browser real no ejecutado |
| Firestore bajo consumo | PASS/PARTIAL | sin historial de mensajes/listeners/polling; batch CRM implementado |
| desktop | PARTIAL | CSS/estructura validada estáticamente; browser visual pendiente |
| tablet | PARTIAL | breakpoint <=1180 validado estáticamente |
| móvil | PARTIAL | navegación progresiva <=760 validada estáticamente |
| campaña + Inbox | PASS/PARTIAL | arbitraje automatizado PASS; sesión real pendiente |
| Contact Export + Inbox | PASS/PARTIAL | arbitraje automatizado PASS; sesión real pendiente |
| campañas/reintentos/pausas existentes | PASS/PARTIAL | suite completa extensión PASS; uso real no ejecutado |
| extensión unpacked | BLOCKED | requiere Chrome `chrome://extensions` |
| Deploy Preview + extensión unpacked | BLOCKED | build admite origen exacto; no se abrió una sesión Netlify/Chrome desde este entorno |

## Firestore

Al abrir Inbox:

- se leen zonas activas mediante el servicio existente/caché;
- se resuelven clientes por IDs determinísticos en lotes de hasta 30 y cache de sesión.

Al abrir un chat o leer mensajes:

- no se escribe ni lee historial WhatsApp en Firestore.

Al responder:

- el mensaje se envía por la extensión/WhatsApp Web;
- no se crea una escritura Firestore por mensaje.

Al crear/modificar cliente o zona:

- se utilizan servicios de Clientes y sus permisos;
- la creación `if missing` usa transacción sobre el documento determinístico.

No se agregó polling agresivo ni listeners globales para el Inbox.

## Responsive

- Desktop: tres columnas (chats, conversación, CRM).
- <=1180 px: chats + conversación y CRM debajo.
- <=760 px: navegación progresiva `Chats / Conversación / Cliente`; no se fuerzan tres columnas comprimidas.

Esta evidencia es estructural/CSS. La inspección visual con navegador real queda marcada PARTIAL.

## Limitaciones reales de WhatsApp Web

- Los selectores y atributos internos pueden cambiar sin aviso.
- El teléfono no siempre está visible; no se inventa ni se vincula CRM si no existe evidencia suficiente.
- La identidad por nombre es sólo fallback y se marca con menor confianza.
- Archivados no se recorren forzadamente si no están presentes en la lista visible/normal.
- Las etiquetas de WhatsApp se obtienen mediante una superficie de UI distinta y no se editan por chat desde Inbox en esta etapa.
- La confirmación de envío es observacional; ante incertidumbre después del click se informa `SEND_STATUS_UNKNOWN`.

## QA manual exacto pendiente

1. `npm run build` en extensión con el origen exacto del Deploy Preview si se usa preview.
2. Abrir `chrome://extensions`, Developer mode, Load unpacked y seleccionar el directorio de build validado.
3. Abrir WhatsApp Web con una cuenta/chat de prueba.
4. Abrir el Deploy Preview autorizado.
5. Validar lista/no leídos, chat individual, teléfono disponible/no disponible, grupo/canal, draft preexistente y dos mensajes idénticos intencionales.
6. Iniciar una campaña de prueba mínima y comprobar que las operaciones incompatibles de Inbox quedan bloqueadas sin cambiar el chat de campaña.
7. Repetir con Contact Export de prueba.
8. Dormir/reiniciar service worker desde DevTools de extensión y repetir una operación con requestId controlado.
9. Refrescar WhatsApp inmediatamente después de iniciar un envío de prueba y comprobar que no se declara éxito incierto ni se reenvía ciegamente.
10. Revisar desktop, tablet y móvil con DevTools responsive.

Nunca ejecutar estos pasos contra una campaña masiva o datos destructivos de producción.