# Continuar el módulo de envíos desde otra PC

Estado actualizado: **20/10/2026**. Repositorio: [AgustinBazanUB/App-Integral-FM](https://github.com/AgustinBazanUB/App-Integral-FM). Rama: **`codex/modulo-envios-v08`**. PR de trabajo: [#40](https://github.com/AgustinBazanUB/App-Integral-FM/pull/40), mantenido como borrador.

El código, la documentación, las referencias originales y las capturas de esta adaptación están versionados en esta rama. Los secretos en `.env`/`.env.local`, las credenciales, la configuración privada local de herramientas y las carpetas temporales no deben copiarse al repositorio. Conservar los archivos de superficies `.env.gestion` y `.env.ecommerce` que ya forman parte del proyecto; no reemplazarlos con credenciales privadas.

## Retomar en una instalación nueva

```powershell
git clone https://github.com/AgustinBazanUB/App-Integral-FM.git
cd App-Integral-FM
git switch --track origin/codex/modulo-envios-v08
npm ci
npm run dev:gestion
```

Si el repositorio ya existe, guardar primero cualquier trabajo local, ejecutar `git fetch origin`, cambiar a `codex/modulo-envios-v08` y actualizar con `git pull --ff-only`. No es necesario crear otra rama para continuar este trabajo. Usar Node 20 para coincidir con CI.

La configuración de frontend se orienta mediante `.env.example`. Configurar únicamente los valores correspondientes a esa PC; las credenciales privadas de Firebase/Netlify permanecen fuera de Git. El servidor Vite por sí solo no ejecuta las funciones de Netlify: para probar el backend real utilizar el preview o un entorno local de funciones configurado expresamente.

## Qué quedó implementado

| Apartado | Estado |
| --- | --- |
| Venta Rápida | Crea venta/envío vinculados y descuenta una vez del origen físico seleccionado. |
| Panel Vendedor | Registra solicitud sin stock hasta la aprobación administrativa; conserva atribución comercial. |
| Tablero | Navegación superior de tres apartados, tres resúmenes, filtros, incidencias por fila y acceso a detalle. |
| Solicitudes | Lista y revisión en paralelo; origen real, transporte y preparadores; validaciones existentes del servidor. |
| Preparaciones | Componente compartido en Gestión y Panel Vendedor, selección, QR individual, vista compacta y PDF A4 con hasta cinco etiquetas estándar por página. |
| Detalle | Página en Gestión con progreso, datos, última ubicación, eventos y operaciones administrativas. El vendedor conserva su ficha lateral. |
| QR interno | Elección de rol para etiquetas; sesión y asignación obligatorias para preparar o reportar un problema. |
| Repartidor | Acceso temporal por tramo, recepción, repositorio, salida final, entrega e incidencias. |
| GPS | Solicitud automática al confirmar la salida hacia el cliente; permiso ligado al toque, confirmación de publicación, último punto, parada y rechazo de peticiones tardías mediante sesión GPS. |
| Cliente | Página independiente de sólo lectura, progreso y última posición permitida; enlace a Google Maps cuando está disponible. |

La adaptación v07 reorganiza el código funcional existente. No agrega pedidos ficticios al backend ni reemplaza transacciones por los botones simulados del prototipo. El QR de etiqueta identifica un envío y ofrece los dos roles; el QR temporal emitido por Gestión permite entrar directamente como repartidor autorizado. Preparadores y repartidores conservan permisos diferentes.

## Diseño y archivos principales

- [Referencias originales v07](shipping-reference/v07/README.md): 15 imágenes, HTML y descripción original, con manifiesto de hashes.
- [Evidencia de la adaptación](shipping-evidence/visual-v07/README.md): capturas y recorrido manual de escritorio/móvil con datos sintéticos.
- `src/gestion/pages/ShippingPage.jsx`: navegación, tablero, filtros y apertura de la ficha como página.
- `src/gestion/shipping/ShippingRequests.jsx` y `ShipmentDetail.jsx`: revisión de solicitudes, formulario compartido y ficha operativa.
- `ShippingTasks.jsx` y `ShippingLabelSheet.jsx`: selección, vista A4 y QR; `shippingLabels.mjs` sigue generando el PDF autorizado.
- `ShippingPublicApp.jsx` y `CourierPortal.jsx`: elección de rol, preparación interna, reparto y seguimiento del cliente.
- `ShippingProgress.jsx`, `ShippingLocation.jsx`, `shipping.css`: progreso, presentación de la última ubicación y estilos del módulo.
- `courierGps.mjs`, `services/shippingService.js` y `netlify/functions/_lib/shipping.mjs`: controlador GPS, transporte y validaciones transaccionales. La adaptación visual no cambió estos endpoints.

Las etiquetas A4 se compactaron el 20/10/2026: la etiqueta estándar pasó de 78 mm a unos 46,8 mm de alto (40% menos), conservando una columna QR de 19,5 mm y ampliando las fuentes aproximadamente 20%. Teléfono, dirección, observaciones y pedido se muestran sobre su propia línea inferior. El contenido largo aumenta el alto automáticamente y conserva los saltos de página; la vista previa de Gestión refleja la misma jerarquía.

Las instrucciones operativas actuales provienen del pedido del usuario y de estos documentos de implementación. El HTML, las imágenes y sus notas originales son referencias visuales; sus textos sobre direcciones, mapas simulados o sesiones de demostración no sustituyen las decisiones actuales.

## Verificar antes de integrar

```powershell
npm test
npm run test:shipping
npm run build:surfaces
```

La regresión local de esta adaptación pasó **999 pruebas**. Gestión y ecommerce compilaron correctamente. CI incluye regresión y reglas en un emulador `demo-*`; los resultados definitivos de cada commit aparecen en el PR. Vite conserva avisos de tamaño de chunks, sin impedir la compilación.

Para el laboratorio visual sin Firebase real:

```powershell
node tests/qa-shipping-ui.mjs --serve
```

Abrir la URL local que devuelve. El laboratorio necesita `esbuild` instalado por `npm ci`. El recorrido automático opcional `npm run test:shipping:ui` requiere Playwright y Chrome locales; `SHIPPING_QA_NODE_MODULES` y `SHIPPING_QA_CHROME` permiten indicar instalaciones locales. El modo `--serve` no abre ni automatiza un navegador.

## Preview y despliegue

Preview compartido: [deploy-preview-40--appintegralflormia.netlify.app](https://deploy-preview-40--appintegralflormia.netlify.app/gestion/shipping).

Subir a esta rama actualiza el Deploy Preview del PR. No fusionar ni publicar producción como parte de la continuidad. Las reglas e índices nuevos de Firebase todavía no se publicaron globalmente; las lecturas tienen respaldo autenticado mediante funciones.

El sitio correcto es **appintegralflormia**, ID `8b6e2130-3336-4f04-9ab8-a58dffd96bf7`. La configuración local `.netlify/state.json` de la PC anterior apuntaba a otro sitio: no confiar en una vinculación heredada para desplegar. Preferir la integración GitHub del PR. Los previews no garantizan consumo total cero: tráfico y funciones pueden consumir recursos.

Para comandos de GitHub especificar el repositorio, porque el repositorio base predeterminado de `gh` en la PC anterior apuntaba a otro fork:

```powershell
gh pr checks 40 --repo AgustinBazanUB/App-Integral-FM
```

La rama incluye cambios previos de facturación procedentes de `codex/vendedor-facturacion-cae` que aún requieren revisión respecto de `main`. Revisar el diff completo antes de integrar.

## Pendientes y datos reales anteriores

- Probar GPS real en un teléfono, permisos, actualización visible para cliente/administración y parada al entregar. El laboratorio utiliza una posición sintética, no evidencia física.
- Configurar proveedor de mapa/geocodificación y parámetros de geocerca si se requiere entrega validada por ubicación. Actualmente se muestra la última posición y se abre Google Maps por acción del usuario; no se dibuja una ruta ficticia ni se consulta un proveedor nuevo automáticamente.
- Sin geocerca, cerrar una entrega requiere una excepción administrativa con motivo. No hace falta una dirección de repositorio para operar sus estados.
- Repetir prueba remota con cuenta real de vendedor/preparador de permisos limitados y con impresión/cámara físicas. La nueva vista del vendedor reutiliza el componente comprobado en el laboratorio, sin acreditar una sesión productiva limitada.
- Conciliar las ventas ficticias ya creadas el 16/10: **FM-FMLV-20261016-0011** y **0012**, por ARS 22.000 cada una; una unidad de Aceite de Oliva Arbequina 500cc descontada en Lavalle y otra en Zapala. Ambos envíos quedaron entregados. No se crearon otras ventas durante la adaptación visual.
- La anulación habitual de ventas vinculadas a envíos está bloqueada para evitar reposiciones al origen incorrecto. Cancelar un envío no devuelve stock ni dinero; la conciliación necesita movimientos compensatorios supervisados.

Detalle: [prueba manual del preview](shipping-manual-preview-40.md), [guía de GPS](shipping-courier-gps.md) y [especificación técnica](shipping-v08.md).

## Ajustes de títulos y GPS móvil — 20/10/2026

Los tableros de Gestión, solicitudes, preparaciones, revisión, detalle, QR interno y portal de reparto ahora destacan **Envío para [cliente]** y dejan el código del envío en una línea secundaria. El tramo inicial hacia el repositorio conserva el título de destino y no muestra datos del cliente al repartidor del primer tramo. El enlace público del cliente continúa sin exponer su nombre.

Al confirmar la salida directa o **Salir del repositorio hacia el cliente**, el navegador empieza a solicitar ubicación inmediatamente desde ese toque. El primer punto queda retenido localmente hasta que el servidor confirma que el pedido está en reparto final; después se comparte y aparece en el mapa con el marcador de moto. No se muestra un botón para iniciar la ubicación manualmente en el recorrido normal. Si el permiso o la señal fallan, el portal ofrece **Reintentar ubicación**.

Pendiente de esta revisión: comprobar en el iPhone del usuario que Chrome muestra el permiso al tocar salida y que el mapa refleja una posición real en la preview HTTPS. En iOS, revisar **Ajustes → Apps → Chrome → Ubicación** si Chrome no tiene acceso. La prueba de interfaz automatizada usa geolocalización simulada y no reemplaza esa validación física.
