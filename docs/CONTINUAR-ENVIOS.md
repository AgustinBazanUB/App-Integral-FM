# Continuar el módulo de envíos desde otra PC

Estado actualizado: **20/10/2026**. Repositorio: [AgustinBazanUB/App-Integral-FM](https://github.com/AgustinBazanUB/App-Integral-FM). Rama: **`codex/modulo-envios-v08`**. PR de trabajo: [#40](https://github.com/AgustinBazanUB/App-Integral-FM/pull/40), mantenido como borrador.

**Actualización de seguimiento v0.9:** el mapa y el GPS en las pantallas de seguimiento se retiraron. Cliente, detalle y repartidor muestran hitos reales con una escena ilustrada SVG; el mapa Leaflet queda sólo en el formulario de Gestión para corregir manualmente la dirección. No se solicita ubicación, no se transmiten puntos y los endpoints GPS antiguos responden `410`. Ver [guía actual](shipping-illustrated-tracking.md). El Deploy Preview sigue conectado a Firebase staging `app-integral-fm-pruebas`; no publicar Production.

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
| Detalle | Página en Gestión con escena ilustrada por estado, datos, eventos y operaciones administrativas. El selector de domicilio permite corregir manualmente su pin. |
| QR interno | Elección de rol para etiquetas; sesión y asignación obligatorias para preparar o reportar un problema. |
| Repartidor | Acceso temporal por tramo, recepción, repositorio, salida final, entrega e incidencias; sin mapa ni geolocalización. |
| Cliente | Página independiente de sólo lectura con los hitos confirmados, sin mapa, coordenadas ni datos del repartidor. |

La adaptación v07 reorganiza el código funcional existente. No agrega pedidos ficticios al backend ni reemplaza transacciones por los botones simulados del prototipo. El QR de etiqueta identifica un envío y ofrece los dos roles; el QR temporal emitido por Gestión permite entrar directamente como repartidor autorizado. Preparadores y repartidores conservan permisos diferentes.

## Diseño y archivos principales

- [Referencias originales v07](shipping-reference/v07/README.md): 15 imágenes, HTML y descripción original, con manifiesto de hashes.
- [Evidencia de la adaptación](shipping-evidence/visual-v07/README.md): capturas y recorrido manual de escritorio/móvil con datos sintéticos.
- `src/gestion/pages/ShippingPage.jsx`: navegación, tablero, filtros y apertura de la ficha como página.
- `src/gestion/shipping/ShippingRequests.jsx` y `ShipmentDetail.jsx`: revisión de solicitudes, formulario compartido y ficha operativa.
- `ShippingTasks.jsx` y `ShippingLabelSheet.jsx`: selección, vista A4 y QR; `shippingLabels.mjs` sigue generando el PDF autorizado.
- `ShippingPublicApp.jsx` y `CourierPortal.jsx`: elección de rol, preparación interna, reparto y seguimiento del cliente.
- `AnimatedDeliveryJourney.jsx`, `deliveryJourney.mjs`, `shipping-journey.css`: escena vectorial, hitos conectados a los estados, barra accesible y movimiento reducido.
- `ShipmentDetail.jsx`, `CourierPortal.jsx`, `ShippingPublicApp.jsx`: composición de la escena para Gestión, repartidor y cliente. Los tres recorridos omiten ubicación GPS.
- `netlify/functions/_lib/shipping.mjs` y `src/shared/shippingDomain.mjs`: endpoints GPS heredados rechazados con `410`, proyección pública por estado y limpieza de datos heredados.
- `ShippingMap.jsx`: mapa Leaflet sólo como selector manual del domicilio en Gestión; no dibuja rutas ni puntos del repartidor.

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

## Pendientes antes de producción y datos reales anteriores

- Repetir pruebas manuales del flujo comercial y de permisos en Firebase staging, con cuentas de vendedor/preparador limitadas y cámara/impresora físicas antes de habilitarlo en producción.
- No hay requisito de GPS real en esta versión. No configurar proveedor de mapas/geocodificación ni geocerca para cerrar las pruebas de estado.
- Conciliar las ventas ficticias ya creadas el 16/10: **FM-FMLV-20261016-0011** y **0012**, por ARS 22.000 cada una; una unidad de Aceite de Oliva Arbequina 500cc descontada en Lavalle y otra en Zapala. Ambos envíos quedaron entregados. No se crearon otras ventas durante la adaptación visual.
- La anulación habitual de ventas vinculadas a envíos está bloqueada para evitar reposiciones al origen incorrecto. Cancelar un envío no devuelve stock ni dinero; la conciliación necesita movimientos compensatorios supervisados.

Detalle: [seguimiento ilustrado vigente](shipping-illustrated-tracking.md), [prueba manual del preview](shipping-manual-preview-40.md), [guía GPS archivada](shipping-courier-gps.md) y [auditoría técnica](shipping-v08.md).

## Archivo histórico: títulos y GPS móvil — 20/10/2026

> Las siguientes notas describían el intento previo de GPS. La parte de ubicación en móvil quedó retirada en v0.9; no la uses como instrucción de prueba. La guía actual está en [seguimiento ilustrado](shipping-illustrated-tracking.md).

Los tableros de Gestión, solicitudes, preparaciones, revisión, detalle, QR interno y portal de reparto ahora destacan **Envío para [cliente]** y dejan el código del envío en una línea secundaria. El tramo inicial hacia el repositorio conserva el título de destino y no muestra datos del cliente al repartidor del primer tramo. El enlace público del cliente continúa sin exponer su nombre.

Al confirmar la salida directa o **Salir del repositorio hacia el cliente**, el navegador empieza a solicitar ubicación inmediatamente desde ese toque. El primer punto queda retenido localmente hasta que el servidor confirma que el pedido está en reparto final; después se comparte y aparece en el mapa con el marcador de moto. No se muestra un botón para iniciar la ubicación manualmente en el recorrido normal. Si el permiso o la señal fallan, el portal ofrece **Reintentar ubicación**.

El texto anterior registra el intento de prueba en teléfono y queda sólo como historial. La versión vigente no muestra ese permiso y no necesita prueba de ubicación física.

## Seguimiento ilustrado vigente — v0.9

`AnimatedDeliveryJourney` comparte una escena SVG entre Gestión, el Panel del Repartidor y el seguimiento público. El local, la caja, la moto, el repositorio simbólico y la casa se ubican por la etapa guardada en Firebase; no son puntos en un mapa. Los hitos previos son verdes, el actual amarillo y los siguientes grises. El progreso no cambia con temporizadores: sólo avanza al recibir un cambio confirmado.

La entrega directa muestra Pedido recibido → Preparando → Listo para salir → En camino → Entregado. Repositorio agrega Hacia el repositorio → En repositorio → Hacia tu domicilio. Al cancelar, devolver, rechazar o registrar una falla se detiene el avance normal; una incidencia congela la moto en la etapa actual. El estado final coloca el vehículo ante la casa y la caja en la puerta.

La vista de cliente conserva el último estado confirmado si no puede actualizarse y aclara que puede estar desactualizado. `prefers-reduced-motion` reduce animaciones, la pestaña oculta las pausa y el texto HTML mantiene el contenido accesible. No hay recursos Lottie externos: la ilustración es SVG/CSS original y el logo reutiliza el archivo de marca existente. Más detalles de pruebas y del límite de Leaflet en la [guía vigente](shipping-illustrated-tracking.md).
