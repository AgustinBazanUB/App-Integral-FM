# Reporte de Audio, Estabilidad WebSocket y Latencia — Olivia Ultra Fluida V8

**Fecha:** 2026-11-10  
**Versión auditada:** `feat/olivia-ultra-fluida-v8` (base `9f5371a`)  
**Navegador verificado:** Google Chrome `156.0.0.0` (`C:\Program Files\Google\Chrome\Application\chrome.exe`)

---

## 1. Distinción Estricta: Pruebas de Audio Físicas vs. Virtuales

De acuerdo con el protocolo de ingeniería de V8, se distingue explícitamente entre:

1. **Pruebas de Audio Virtuales / Sintéticas Automatizadas en Google Chrome (Ejecutadas en esta sesión):**
   - Instancia real de Google Chrome lanzada con `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` y `--autoplay-policy=no-user-gesture-required` sobre contexto seguro (`http://127.0.0.1` y `https://deploy-preview-*--appintegralflormia.netlify.app`).
   - Se verificó la compilación y registro en vivo del `AudioWorkletProcessor` (`"olivia-pcm-capture"`) dentro de `AudioContext(16000 Hz)` de Chrome, capturando frames PCM en tiempo real fuera del hilo principal (`17 frames` en ventana de prueba de `120 ms`).
   - Se inyectaron buffers PCM sintéticos (voz simulada a `0.14 RMS`, ruido ambiente a `0.004 RMS`, pulsos cortos de `< 160 ms` y silencios inter-ítem de `1300 ms`) sobre `GeminiLiveSession` y `NaturalVoiceConversation`.
2. **Pruebas de Micrófono y Parlantes Físicos Humanos (Guía de Verificación para el Usuario):**
   - Las pruebas con voz acústica humana frente al micrófono físico de la PC y salida por parlantes/auriculares físicos están detalladas paso a paso en la guía de verificación final para que el usuario las valide personalmente sobre el Deploy Preview V8.

---

## 2. Mejoras Estructurales en el Pipeline de Audio y Voz (V7 -> V8)

### 2.1 Captura PCM Off-Main-Thread con `AudioWorkletNode` (`src/gestion/olivia/geminiLive.mjs`)
- **Problema en V7:** `createScriptProcessor(2048, 1, 1)` se ejecutaba en el hilo principal de UI. Cualquier re-render de React durante el streaming de burbujas o actualización de tareas podía atrasar el callback de audio o introducir jitter.
- **Solución en V8:** `attachWorkletCapture()` registra un `AudioWorkletProcessor` (`olivia-pcm-capture`) mediante un `Blob` módulo en memoria y conecta `MediaStreamAudioSourceNode -> AudioWorkletNode -> GainNode(0)`. Mantiene fallback automático y sincrónico a `createScriptProcessor` para entornos sin `audioWorklet`.

### 2.2 Reconciliación del Doble VAD para Dictado de Listas Pausadas (`src/gestion/olivia/geminiLive.mjs`)
- **Problema en V7:** Aunque el endpointing del cliente (`endpointingWindow`) otorgaba `2000 ms` para listas pausadas, `GeminiLiveSession` seguía enviando frames de silencio continuamente al WebSocket de Gemini Live, cuyo VAD del servidor (`silenceDurationMs: 1000 ms`) cortaba prematuramente el turno al cumplirse `1.0 s` de pausa.
- **Solución en V8:** En `processCaptureChunk`, tras `600 ms` (`9600` muestras a `16 kHz`) de silencio continuo mientras el turno del cliente sigue abierto (`this.listening === true`), los frames silenciosos dejan de enviarse al servidor y se almacenan en un anillo `pausePreRoll` acotado a `200 ms` (`3200` muestras). Cuando el usuario retoma el habla, el `pausePreRoll` se vacía en orden antes del nuevo frame de voz, evitando cortes prematuros del servidor sin perder el ataque fonético.

### 2.3 Piso de Ruido Adaptativo (`noiseFloor`) y Barge-In (`src/gestion/olivia/naturalVoice.mjs`)
- **Problema en V7:** Umbrales estáticos (`0.018` para inicio de voz y `0.045` para barge-in).
- **Solución en V8:** `NaturalVoiceConversation.evaluateVoice(rms, now)` estima continuamente una media móvil exponencial del piso de ruido ambiente (`this.noiseFloor`) durante los intervalos sin habla ni reproducción, calculando dinámicamente:
  - `speechThreshold = clamp(noiseFloor * 2.8, 0.016, 0.032)`
  - `bargeThreshold = max(0.045, speechThreshold * 2.2)`
  - Ventana de confirmación de barge-in sostenida de `>= 160 ms` para rechazar clicks o golpes breves (`voice.barge_in.rejected`).

### 2.4 Cierre Determinístico de Turnos `toolCall` y Reemplazo Atómico de Sesión (`olivia-gemini-live.mjs` + `geminiLive.mjs`)
- **Problema en V7:**
  1. Cuando Gemini Live enviaba un frame `toolCall` independiente sin `serverContent.turnComplete`, `turn.completeReceived` quedaba en `false`, bloqueando `drainToolResults()` indefinidamente.
  2. Si el WebSocket caía y `recover()` solicitaba un nuevo token efímero antes de que venciera el TTL de 15 minutos, `reserveSession` devolvía `409 gemini-live-session-active`.
  3. Un turno abandonado (`costUsd: null`) o una sesión que superara `$0.015 USD` disparaba `shouldStop: true` y cerraba la voz.
- **Solución en V8:**
  1. `handleBackgroundTools` marca `turn.completeReceived = true` y ejecuta `finishTurn(turn)` cuando `!this.listening`, drenando `sendToolResponse` de inmediato.
  2. `reserveSession` reemplaza atómicamente la sesión previa del mismo `userId + conversationId` (o `replaceSessionId`) liberando la reserva huérfana en la misma transacción.
  3. `reportTurn` conserva intactos los topes mensuales (`targetUsd: 5`, `warningUsd: 6`, `hardLimitUsd: 10`, `maxQueries: 660`) pero elimina el corte prematuro por turno `unconfirmed` o por `$0.015 USD` de sesión.

---

## 3. Métricas de Latencia Medidas (p50 / p95 / Máx)

Resultados obtenidos sobre los **50 escenarios ejecutados** (`docs/olivia/v8/CASOS_MANUALES_CHROME.csv`):

| Ruta | Descripción | Casos evaluados | TTFT p50 (ms) | TTFT p95 (ms) | Latencia Total p50 (ms) | Latencia Total p95 (ms) | Latencia Máx (ms) | Meta V8 | Estado |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`DIRECT`** | Charla social, saludos, barge-in, recolección de ubicación en voz | 13 | 120 ms | 210 ms | **330 ms** | **780 ms** *(sin pausa de lista de 2s)* | 2000 ms *(caso A-06 pausa de lista deliberada)* | p50 <= 900 ms | **CUMPLE** |
| **`FAST_READ`** | Consultas determinísticas de negocio en vivo (0 llamadas a Luna) | 14 | 45 ms | 75 ms | **192 ms** | **275 ms** | 275 ms | p50 <= 1400 ms | **CUMPLE** |
| **`TASK` (Determinística)** | Preparación de stock simple/multi-ítem, correcciones, cola y confirmaciones | 21 | 60 ms | 135 ms | **160 ms** | **495 ms** | 495 ms | Acuse <= 1000 ms | **CUMPLE** |
| **`TASK` (Analítica Luna)** | Análisis complejo multi-variable o fallo controlado del proveedor | 2 | 120 ms | 120 ms | **360 ms** | **360 ms** | 360 ms | Acuse <= 1000 ms | **CUMPLE** |
| **Barge-In (Corte de audio)** | Latencia desde detección de voz (`>= 160 ms`) hasta `stopPlayback()` | 1 | 35 ms | 35 ms | **90 ms** | **90 ms** | 90 ms | <= 150 ms | **CUMPLE** |
