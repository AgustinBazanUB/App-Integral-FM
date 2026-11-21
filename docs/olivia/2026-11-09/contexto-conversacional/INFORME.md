# Olivia: contexto y chat conversacional

Rama: `codex/olivia-contexto-sin-tarjetas`. Base actualizada `origin/main`: `62bd617e8e452d25aa8fa5ff26bdee796d5ccf00`. Hereda el diseño blanco/dorado de `a37a8abe07efd2019368d3222f14e65b425730ad` (PR #59). No modifica producción ni las reglas/índices de Firebase. Worktree separado; los cambios de otros worktrees se conservaron.

## Diagnóstico y cambios

- El componente normal mostraba estados needs-input, paused y failed como tarjetas con controles. Ahora solo presenta propuestas con pendingAction en awaiting-confirmation. Diagnóstico y controles de tareas siguen en desarrollador. Las preguntas/resultados ya se persistían como mensajes del chat; no dependen de las tarjetas eliminadas. Confirmar/rechazar modificaciones conserva la validación del servidor.
- La recolección de stock se evaluaba antes de las preguntas comerciales. Una transcripción sin signos como «qué ubicaciones están activas» podía convertirse en un dato del borrador. Se reconoce la consulta independiente antes de recolectar, se fuerza una solicitud nueva y se conserva el borrador de voz. El motor de texto también prioriza lecturas rápidas antes de avanzar la tarea; no reemplaza una tarea pendiente por el estado completed de una lectura.
- list_locations ya existía y aplica permisos, asignaciones, borrado y vigencia mediante effectiveSellerLocations. Se reutiliza para una respuesta determinista con nombres devueltos por el servidor, sin inventarlos ni llamar a Luna. La consulta está acotada (100 ubicaciones para administración, 50 asignadas más permisos directos para vendedor); no acredita un inventario global ilimitado.
- Se explicitan en Gemini la prioridad de la última pregunta, la diferencia entre consulta independiente y continuación, las capacidades autorizadas y la aclaración ante ambigüedad. Son instrucciones, no evidencia de comprensión universal.
- Algunas preguntas imperativas seguras sin «?» descartaban su audio. Se aceptan solicitudes acotadas de campos («decime en qué ubicación», «pasame los productos y cantidades»), conservando el bloqueo de afirmaciones comerciales no verificadas. Esto no elimina todas las causas de silencio o desconexión.
- Se retira el botón redundante Volver a conectar del flujo del chat. La acción de voz sigue disponible en el compositor y el aviso de recuperación sigue visible.

## Validación

En preparación: completar pruebas manuales sobre el preview de este cambio y registrar sus límites. No se certifica todavía recuperación acústica, listas de 20 productos ni ejecución operativa completa.

El prompt adjunto está preparado para GPT-6 Luna, seleccionado por el usuario en Codex. No configura automáticamente el modelo ni cambia los proveedores de Olivia. Distingue texto, audio virtual y acústica física, y conserva el presupuesto existente.
