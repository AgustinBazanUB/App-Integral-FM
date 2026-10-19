# Verificación visual de la adaptación v07

Fecha: 19/10/2026. Son capturas de la aplicación implementada en un laboratorio local con adaptadores sintéticos. **No son registros ni posiciones del Firebase original.** El laboratorio muestra un aviso visible. El contenedor local añade espacio alrededor de las vistas; las cabeceras generales de Gestión y del vendedor pertenecen a la aplicación real, no al laboratorio.

| Captura | Qué permite revisar |
| --- | --- |
| [01-tablero.jpg](01-tablero.jpg) | Navegación superior, tres resúmenes, filtros y marcador de incidencia por pedido. |
| [02-solicitudes.jpg](02-solicitudes.jpg) | Lista de solicitudes y revisión del origen/preparación en paralelo. |
| [03-preparaciones.jpg](03-preparaciones.jpg) | Lista seleccionable y vista de las etiquetas al costado. |
| [04-qr-individual.jpg](04-qr-individual.jpg) | QR de un pedido y acceso a su preparación. |
| [05-detalle.jpg](05-detalle.jpg) | Página de detalle: datos, seguimiento y eventos. |
| [06-qr-inicio.jpg](06-qr-inicio.jpg) | Selector de acceso interno/repartidor en escritorio. |
| [07-qr-inicio-movil.jpg](07-qr-inicio-movil.jpg) | El mismo selector en móvil. |
| [08-repartidor-movil.jpg](08-repartidor-movil.jpg) | Destino, etapa y controles de ubicación del repartidor. |
| [09-cliente-movil.jpg](09-cliente-movil.jpg) | Seguimiento del cliente con una coordenada sintética, sin ruta inventada. |
| [10-preparacion-interna-movil.jpg](10-preparacion-interna-movil.jpg) | Pedido, productos y acciones de preparación. |
| [11-tablero-movil.jpg](11-tablero-movil.jpg) | Resúmenes y tablero adaptados al teléfono. |
| [12-preparaciones-movil.jpg](12-preparaciones-movil.jpg) | Selección y etiquetas en disposición vertical. |

## Comprobado mediante la interfaz

- Aprobación desde la nueva vista: origen físico y preparador seleccionables; la solicitud deja de figurar entre las pendientes tras confirmar en el adaptador local.
- Selección individual y múltiple; vista de etiquetas actualizada; generación del PDF A4; apertura y cierre del visor; QR individual y enlace a preparación.
- Detalle como página de Gestión y vuelta mediante navegación. El Panel Vendedor conserva la ficha en panel lateral y utiliza el mismo componente de preparaciones/etiquetas.
- QR sin autorización: muestra elección de rol. Repartidor: solicita un acceso temporal. Los enlaces autorizados con rol/credencial continúan entrando directamente al tramo.
- Preparación interna asignada: confirmar listo actualiza el estado; reportar falta de embalaje muestra la incidencia y oculta la confirmación de preparación.
- Tamaños de referencia de 1440 × 1000 y 390 × 844. En móvil se comprobó `scrollWidth <= clientWidth` para tablero, preparaciones, detalle, selector, preparación interna y seguimiento del cliente. Se corrigieron desbordes de las grillas y del seguimiento.
- Sin errores JavaScript registrados en las vistas de tablero/detalle inspeccionadas.

## Límites de esta evidencia

El laboratorio usa adaptadores de servicio; no acredita una transacción remota de inventario, permisos de una cuenta productiva limitada, lectura con cámara, impresión física ni GPS de un teléfono. Los cambios visuales mantienen los endpoints y sus validaciones. La regresión de negocio y las verificaciones anteriores se documentan por separado en [shipping-v08.md](../../shipping-v08.md), [shipping-manual-preview-40.md](../../shipping-manual-preview-40.md) y [shipping-courier-gps.md](../../shipping-courier-gps.md).

Para una inspección local reproducible, ejecutar `node tests/qa-shipping-ui.mjs --serve` y abrir la URL que imprime el proceso. Los fixtures se reinician al recargar; las pestañas no comparten una base remota. `--build-only` reconstruye el paquete del laboratorio sin abrir navegador ni iniciar servidor. El script normal conserva su recorrido automático opcional con Playwright, actualizado a los nuevos controles.
