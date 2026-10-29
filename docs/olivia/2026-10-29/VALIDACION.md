# Olivia: animación procedural y voz minimizada

Actualización sobre `origin/main` actualizado, incorporando el trabajo pendiente de PR #46 (que incluye #45). La revisión acumulada conserva las mejoras de conversación, instrucciones que reemplazan tareas anteriores, acuses de voz, paciencia y recuperación. No modifica reglas ni índices de Firebase.

## Cambios

- Equalizer Orb y OrbPill originales de VoiceOrbs, adaptación React 18/MIT documentada en `src/gestion/olivia/voiceorbs/README.md`.
- Animación por estado, sin `levelRef` de micrófono/altavoz. Ripple y flow usan capas distintas con transición de opacidad; carga lenta y conexión regular. Se eliminó el analizador de salida que solo alimentaba la visualización. El analizador de entrada permanece para VAD.
- Orb activo de 134,4 px, antes 168. Tamaños compacto, reposo, launcher y ajustes móviles reducidos 20%. Sin subtítulos visibles bajo el orb; solo estado del micrófono. Avisos críticos y recuperación junto al compositor.
- Minimizar, abrir y finalizar voz son operaciones separadas. El panel y Escape minimizan. La sesión, borrador, adjuntos, historial y recuperación de trabajos permanecen montados; reabrir no inicia otra conversación ni pide de nuevo su estado si ya está cargado.
- Preferencia por usuario y dispositivo, inicialmente apagada, disponible en el chat y en Configuración de Olivia. Con la opción apagada queda el acceso habitual y controles visibles de sesión; encendida queda una única pill. Confirmaciones Sí/No exclusivamente dentro del chat.
- `AbortError` por reemplazo explícito es neutral. El trabajo identificado sigue recuperándose con el panel oculto. Revocación del micrófono, audio suspendido/interrumpido, pérdida de conexión y abandono de página cierran los recursos de voz y ofrecen reinicio explícito.

## Validación ejecutada

- `npm run build:gestion`: correcto. Continúa el aviso previo de chunks mayores a 500 kB.
- `node --test tests/olivia*.test.mjs`: 311 pruebas correctas.
- `npm test`: 979 pruebas correctas, sin fallos ni omitidas.
- Navegador Chromium integrado, fixture local aislada con fetch, documentos y audio sintéticos; nunca solicita el micrófono del sistema ni conecta Firebase.
- Consulta de voz de 25 segundos: minimizar, abrir Productos, continuar procesando y reproducir respuesta; mismo historial y borrador al reabrir. Sin error por demora.
- Activar/desactivar preferencia, launcher único, silenciar/reactivar desde la pill y finalizar voz. Preferencia apagada mantiene acceso habitual y controles visibles.
- Confirmación preparada, pill con “Revisar acción” sin botones de aprobación, reapertura y rechazo en el panel. Cancelación explícita sin error; fallo definitivo con pill y recuperación.
- Conexión interrumpida mediante emulación de red: captura finalizada, aviso real, reconexión explícita y conversación conservada. Permiso denegado y voz desactivada presentan pills compactas.
- Ancho medido del orb activo: 134,4000 px en escritorio y 99,2000 px en móvil. Siete barras con `fm-ripple` al escuchar y `fm-flow` al reproducir PCM sintético; movimiento reducido sin animación. Solo el texto de micrófono queda visible junto al orb.
- Responsive a 375×812 y 320×568: botones accesibles, pill ajusta sus filas dentro del viewport; separación de barra inferior y áreas seguras. Capturas en `evidence/`.
- Pruebas de VAD: silencio base 1900 ms, pausas reanudadas de 3–4 segundos, envío manual, límite por turno, permisos y liberación del micrófono. No se introducen llamadas de IA adicionales para inferir pausas.

## Límites de la revisión

La continuidad corresponde a navegar entre módulos de la SPA. Cerrar/recargar la página, revocar permisos, bloquear el dispositivo o suspender audio puede interrumpirla. Se conserva el límite existente de 60 segundos y 4 MB por turno, cuotas y controles del servidor. No se promete captura en segundo plano de iOS. La revisión responsive se hizo en Chromium; falta prueba física en Safari/iPhone y Android con micrófono real.

Las pruebas funcionales fueron locales y sintéticas. La comprobación remota del preview es de solo lectura; no se crean cuentas, documentos, ventas ni stock. No se considera validada la credencial privada del servidor sin acceso a su contexto. Antes de cualquier prueba remota con escrituras deben verificarse frontend, Functions, Authentication, Firestore y cuenta de servicio de `app-integral-fm-pruebas` según `docs/FIREBASE-PRUEBAS.md`. No se modifica producción ni se promueven datos de pruebas.
