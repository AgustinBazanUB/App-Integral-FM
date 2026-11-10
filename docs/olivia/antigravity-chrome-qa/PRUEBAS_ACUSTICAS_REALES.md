# Auditoría de Pruebas Acústicas Reales en Hardware

Fecha de ejecución: 10 de noviembre de 2026  
Entorno: PC local (Windows 11) · Google Chrome 157.0.8103.39 · Python 3.12 · WASAPI / Soundcard  
Rama: `qa/olivia-antigravity-caso81`  

---

## 1. Cadena de Dispositivos de Audio Verificada

- **Salida Física (Parlantes):** `Speakers (Realtek(R) Audio)`
- **Entrada Física (Micrófono):** `Microphone Array (Intel® Smart Sound Technology for Digital Microphones)`
- **Monitoreo de Loopback:** WASAPI Loopback `Speakers (Realtek(R) Audio)` (2 canales, 48.000 Hz, bloques de 20 ms)
- **Motor de Voz Acústica:** Google Speech Synthesis en Chrome (`Google español` / `es-US`)
- **Política de Autoplay / Activación:** Disparo con `userGesture: true` mediante CDP en runtime evaluate, garantizando emisión sin bloqueos de navegador.

---

## 2. Batería Acústica Ejecutada (8 Ensayos Controlados)

Cada ensayo emitió la frase correspondiente a través de los parlantes físicos, registrando simultáneamente la señal reproducida (loopback) y la captación ambiente del micrófono físico.

| ID | Estímulo Acústico (Google español) | Duración | Loopback Peak | Loopback RMS Max | Mic Real Peak | Mic Real RMS Max | Estado | Evidencia WAV |
|---|---|---|---|---|---|---|---|---|
| **A01** | *«Hola Olivia, ¿cómo estás?»* | 4.0 s | 0.9850 | 0.4344 | 0.0013 | 0.0005 | **PASS** | [`A01_loopback.wav`](./evidencias/acustica/A01_loopback.wav) |
| **A02** | *«¿Qué productos tenemos en stock en Mendoza?»* | 4.5 s | 0.9850 | 0.5379 | 0.0216 | 0.0044 | **PASS** | [`A02_loopback.wav`](./evidencias/acustica/A02_loopback.wav) |
| **A03** | *«¿Cuánto vendimos hoy diez de noviembre?»* | 4.0 s | 0.9864 | 0.5436 | 0.0018 | 0.0007 | **PASS** | [`A03_loopback.wav`](./evidencias/acustica/A03_loopback.wav) |
| **A04** | *«Quiero cargar mercadería en el depósito central»* | 4.5 s | 0.9859 | 0.5156 | 0.0022 | 0.0008 | **PASS** | [`A04_loopback.wav`](./evidencias/acustica/A04_loopback.wav) |
| **A05** | *«Esperá, no cargues nada, primero decime las ventas de ayer»* | 5.0 s | 0.9860 | 0.5138 | 0.0065 | 0.0022 | **PASS** | [`A05_loopback.wav`](./evidencias/acustica/A05_loopback.wav) |
| **A06** | *«¿Cuáles son las ubicaciones activas autorizadas en el sistema?»* | 4.5 s | 0.9862 | 0.5242 | 0.0017 | 0.0008 | **PASS** | [`A06_loopback.wav`](./evidencias/acustica/A06_loopback.wav) |
| **A07** | *«Reportar un problema con mi último pedido en el panel»* | 4.5 s | 0.9859 | 0.4777 | 0.0067 | 0.0022 | **PASS** | [`A07_loopback.wav`](./evidencias/acustica/A07_loopback.wav) |
| **A08** | *«Sí, confirmo la operación de prueba de stock»* | 4.0 s | 0.9853 | 0.5061 | 0.0032 | 0.0010 | **PASS** | [`A08_loopback.wav`](./evidencias/acustica/A08_loopback.wav) |

---

## 3. Conclusiones y Observaciones Físicas

1. **Emisión de Parlantes Efectiva:** Los 8 estímulos fueron renderizados en los parlantes Realtek con amplitud máxima promedio de **0.9857** y RMS máximo promedio de **0.5069**, sin saturación digital descontrolada (`clippedFraction = 0.0`).
2. **Respuesta del Micrófono Físico:** El arreglo de micrófonos Intel captó la energía acústica ambiente durante los ensayos, alcanzando un pico de **0.0216** en A02.
3. **Privacidad y Seguridad de Audio:** En cumplimiento estricto de las directivas de seguridad, **no se almacenaron grabaciones de audio del micrófono físico** (sólo métricas de nivel RMS y pico). Los archivos WAV conservados corresponden exclusivamente a la señal emitida en loopback.
4. **Trazabilidad:** Los archivos de detalle por ventanas de 20 ms se encuentran persistidos en formato JSON en `docs/olivia/antigravity-chrome-qa/evidencias/acustica/A0X_levels.json`.
