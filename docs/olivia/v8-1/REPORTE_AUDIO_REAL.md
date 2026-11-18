# Reporte de audio real — Olivia V8.1

**Fecha de inspección de dispositivos:** 2026-11-10.
**Preview V8.1:** pendiente de desplegar y verificar en el momento de redactar este archivo.

## Dispositivos disponibles

| Dirección | Dispositivo detectado | Evidencia |
|---|---|---|
| Salida física | `Speakers (Realtek(R) Audio)` | Enumeración local de endpoints de Windows. |
| Entrada física | `Microphone Array (Intel® Smart Sound Technology for Digital Microphones)` | Enumeración local de endpoints de Windows. |
| Entrada virtual | No detectada (sin cable virtual, Stereo Mix ni loopback publicable como micrófono). | Búsqueda local por dispositivos de audio. |

Windows SAPI dispone de voces `en-US` (David, Zira y Mark); no hay voz SAPI `es-AR` ni voz española instalada. Por eso, si se usa TTS local para la prueba por parlantes, el origen y la pronunciación se consignarán como sintetizados con limitación de idioma, no como voz humana argentina.

## Modalidades

- **Audio aislado reproducible / virtual:** bloqueado por falta de entrada virtual. No se conectó el loopback de salida al micrófono ni se presentó el sonido de Olivia a sí misma.
- **Prueba física por parlantes → micrófono:** autorizada por el usuario y técnicamente disponible. Los resultados (incluyendo si se escuchó/capturó el audio, transcripción, latencia audible y dispositivos seleccionados) se agregarán al terminar las sesiones reales.
- `audio.schedule` y marcas WebAudio se reportan como eventos internos; solo una escucha/captura acústica permite hablar de sonido audible. No se grabará audio ambiental.

## Límites actuales

La presencia de los dos endpoints confirma disponibilidad, no calidad acústica. Sin una sesión completada en el nuevo preview no se afirma todavía latencia audible, eco, cancelación, precisión de ASR ni tiempo de corte de barge-in.
