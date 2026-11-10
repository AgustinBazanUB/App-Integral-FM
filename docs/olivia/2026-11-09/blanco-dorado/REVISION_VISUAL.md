# Olivia · blanco y dorado

Rama: `codex/olivia-blanco-dorado`. Partió de origin/main actualizado `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00` e incorporó la candidata V6.2 `718a236ed51335074b81d2ae208c852f42ddb6b6` por fast-forward. El PR hacia main incluye esa candidata todavía pendiente de aprobación, además de esta revisión visual. No se integró a producción.

## Diseño

La imagen aportada se usa como referencia de estructura: encabezado, zona centrada de orbe/estado, conversación, compositor y costos al pie. No se copia su fondo negro ni su leyenda de boceto.

- Superficie blanca; mensajes propios en marfil; líneas y acentos dorados.
- Texto e iconos en negro cálido; texto secundario legible en marrón grisáceo.
- Orbe perlado blanco/dorado en todos los accesos de Olivia, también con el sistema en modo oscuro. Conserva los patrones de cada estado y las indicaciones de error.
- Iconos vectoriales de trazo fino: adjuntar, menú, micrófono, voz, minimizar y envío con flecha ascendente.
- Hover, pulsación y foco con transiciones breves de 220–260 ms; movimiento reducido desactiva transiciones y animaciones. Sin nuevas dependencias ni recursos de imagen remotos.
- Orbe y texto de estado permanecen centrados cuando ya hay mensajes; en ventanas de poca altura se compactan para preservar el compositor.
- Compositor y footer independientes del scroll de mensajes. Vista móvil a 100dvw, controles en una fila y costos visibles al escribir.

El tema está aislado en `olivia-gold.css`; no cambia la paleta del resto de los módulos. Se conservan etiquetas accesibles, permisos, confirmaciones, modelo, audio, transporte y cola existentes. No se cambió el orden del historial ni se corrigieron aquí los pendientes conversacionales documentados en V6.2.

## Verificación

1164 tests aprobados y build correcto (advertencia existente de chunks grandes). Se actualizó el stub de iconos del test del compositor para preservar sus comprobaciones de disponibilidad y handlers.

Chrome local con servicios simulados: estructura de dos mensajes como la referencia; compositor habilitado y envío con Enter con respuesta visible; menú y Escape con foco devuelto; conexión de voz simulada con anillo dorado; modo oscuro con superficie del orbe `#fffefa`; movimiento reducido con cero animaciones CSS activas y transición `0s`. No son pruebas de Gemini ni de audio físico. No se hicieron nuevas llamadas pagas de modelo para diseñar o probar la interfaz.

En 390×844: panel de 390,4 px dentro de visualViewport 390,4, overflow interno 0 y orbe centrado en x=195,2. Se comprobó que el footer continúa visible con el textarea enfocado. Capturas locales privadas en `C:/Users/agsba/.codex/visualizations/2026/11/09/olivia-blanco-dorado/`.

El preview final debe revisarse con voz apagada. Su destino Firebase debe ser `app-integral-fm-pruebas` antes de generar conversaciones de QA. No se autorizan escrituras comerciales en producción ni se promocionan datos de prueba.
