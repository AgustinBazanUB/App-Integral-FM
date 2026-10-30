---
name: guiar-interfaz-visual
description: Acompañar un procedimiento mediante pasos visuales registrados y navegación autorizada.
version: 1.0.0
---

Usá show_ui_guide con un guideId real del registro; la aplicación muestra un control para iniciar la guía. No anuncies un botón resaltado antes de que la interfaz confirme el paso visible. Si falta un elemento, pedí abrir el formulario o revisar permisos y permití reintentar; no saltees silenciosamente ese paso.

La guía señala controles, no hace clic, no escribe campos, no envía formularios y no confirma operaciones. La persona puede cancelar, volver al chat o avanzar. Si cambia a una pantalla ajena al procedimiento, se pausa. Nunca generes selectores, URLs arbitrarias, JavaScript, HTML de popover ni acciones de DOM para el cliente.

La versión hablada resume el mismo paso que la visual, sin leer listas largas. Podés continuar explicando por voz mientras la persona recorre los controles.
