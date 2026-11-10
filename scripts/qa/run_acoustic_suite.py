"""Automated Acoustic QA Runner for Olivia / App Integral Flor Mía.
Runs controlled physical audio stimuli via Chrome Google TTS (es-US)
with explicit userGesture: True on CDP Runtime.evaluate,
and records simultaneous WASAPI loopback (Realtek Speakers) and
Intel Smart Sound Microphone Array physical levels.
"""
import json
from pathlib import Path
import time
import urllib.request
import wave
import numpy as np
import soundcard as sc
import websocket

RATE = 48000
WINDOW = 960  # 20ms windows

def get_chrome_page():
    targets = json.loads(urllib.request.urlopen("http://127.0.0.1:9222/json/list").read())
    page = next(t for t in targets if t["type"] == "page")
    return page["webSocketDebuggerUrl"]

def trigger_speech_in_chrome(ws_url, phrase, voice_name="Google español"):
    ws = websocket.create_connection(ws_url)
    expr = f"""
    (() => {{
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance({json.dumps(phrase)});
        const voices = speechSynthesis.getVoices();
        const v = voices.find(x => x.name.includes({json.dumps(voice_name)})) || voices[0];
        u.voice = v;
        u.rate = 1.0;
        u.pitch = 1.0;
        speechSynthesis.speak(u);
        return {{ voice: v.name, spoken: {json.dumps(phrase)} }};
    }})()
    """
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expr,
            "userGesture": True,
            "returnByValue": True
        }
    }))
    res = json.loads(ws.recv())
    ws.close()
    return res.get("result", {}).get("result", {}).get("value")

def compute_levels(data):
    return {
        "rms": float(np.sqrt(np.mean(data * data))),
        "peak": float(np.max(np.abs(data))),
        "clippedFraction": float(np.mean(np.abs(data) >= 0.999))
    }

def record_physical(speaker_loopback, microphone, duration_sec, ws_url, phrase, wav_out):
    num_frames = int(duration_sec * RATE)
    count = int(num_frames / WINDOW)
    
    loopback_windows = []
    mic_windows = []
    loopback_audio = []
    
    with speaker_loopback.recorder(samplerate=RATE, channels=2, blocksize=WINDOW * 4) as loop_rec, \
         microphone.recorder(samplerate=RATE, channels=min(2, microphone.channels), blocksize=WINDOW * 4) as mic_rec:
        
        # Warm up 0.2s
        for _ in range(int(0.2 * RATE / WINDOW)):
            loop_rec.record(numframes=WINDOW)
            mic_rec.record(numframes=WINDOW)
            
        start_time = time.time()
        
        # Trigger speech with user gesture
        speech_info = trigger_speech_in_chrome(ws_url, phrase)
        
        for i in range(count):
            d_loop = loop_rec.record(numframes=WINDOW)
            d_mic = mic_rec.record(numframes=WINDOW)
            
            loopback_audio.append(d_loop.copy())
            loopback_windows.append({"t": i * WINDOW / RATE, **compute_levels(d_loop)})
            mic_windows.append({"t": i * WINDOW / RATE, **compute_levels(d_mic)})
            
    full_audio = np.concatenate(loopback_audio)
    
    # Save WAV
    wav_out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_out), "wb") as wf:
        wf.setnchannels(full_audio.shape[1])
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes((np.clip(full_audio, -1, 1) * 32767).astype("<i2").tobytes())
        
    summary_loop = {
        "rmsMax": max(w["rms"] for w in loopback_windows),
        "rmsMedian": float(np.median([w["rms"] for w in loopback_windows])),
        "peak": max(w["peak"] for w in loopback_windows),
        "clippedFractionMax": max(w["clippedFraction"] for w in loopback_windows)
    }
    
    summary_mic = {
        "rmsMax": max(w["rms"] for w in mic_windows),
        "rmsMedian": float(np.median([w["rms"] for w in mic_windows])),
        "peak": max(w["peak"] for w in mic_windows),
        "clippedFractionMax": max(w["clippedFraction"] for w in mic_windows)
    }
    
    return {
        "phrase": phrase,
        "durationSec": duration_sec,
        "speechInfo": speech_info,
        "loopbackSummary": summary_loop,
        "micSummary": summary_mic,
        "wavFile": str(wav_out.resolve()),
        "loopbackWindows": loopback_windows,
        "micWindows": mic_windows
    }

def main():
    print("=== Iniciando Batería Acústica Automatizada en PC con UserGesture ===")
    speaker = sc.default_speaker()
    mic = sc.default_microphone()
    loopback = sc.get_microphone(id=speaker.id, include_loopback=True)
    
    print(f"Salida física: {speaker.name}")
    print(f"Entrada física: {mic.name}")
    print(f"Loopback WASAPI: {loopback.name}")
    
    ws_url = get_chrome_page()
    print(f"Chrome WebSocket: {ws_url}")
    
    test_cases = [
        {"id": "A01", "phrase": "Hola Olivia, ¿cómo estás?", "duration": 4.0},
        {"id": "A02", "phrase": "¿Qué productos tenemos en stock en Mendoza?", "duration": 4.5},
        {"id": "A03", "phrase": "¿Cuánto vendimos hoy diez de noviembre?", "duration": 4.0},
        {"id": "A04", "phrase": "Quiero cargar mercadería en el depósito central", "duration": 4.5},
        {"id": "A05", "phrase": "Esperá, no cargues nada, primero decime las ventas de ayer", "duration": 5.0},
        {"id": "A06", "phrase": "¿Cuáles son las ubicaciones activas autorizadas en el sistema?", "duration": 4.5},
        {"id": "A07", "phrase": "Reportar un problema con mi último pedido en el panel", "duration": 4.5},
        {"id": "A08", "phrase": "Sí, confirmo la operación de prueba de stock", "duration": 4.0}
    ]
    
    results = []
    base_dir = Path("docs/olivia/antigravity-chrome-qa/evidencias/acustica")
    
    for case in test_cases:
        cid = case["id"]
        phrase = case["phrase"]
        dur = case["duration"]
        wav_path = base_dir / f"{cid}_loopback.wav"
        
        print(f"\n--- Ejecutando {cid}: '{phrase}' ({dur}s) ---")
        res = record_physical(loopback, mic, dur, ws_url, phrase, wav_path)
        
        # Save level details
        json_path = base_dir / f"{cid}_levels.json"
        json_path.write_text(json.dumps(res, indent=2, ensure_ascii=False), encoding="utf-8")
        
        print(f"  [Loopback] Peak: {res['loopbackSummary']['peak']:.4f} | RMS Max: {res['loopbackSummary']['rmsMax']:.4f}")
        print(f"  [Mic Real] Peak: {res['micSummary']['peak']:.4f} | RMS Max: {res['micSummary']['rmsMax']:.4f}")
        print(f"  WAV guardado en: {wav_path.name}")
        
        results.append({
            "id": cid,
            "phrase": phrase,
            "duration": dur,
            "voice": res.get("speechInfo", {}).get("voice"),
            "loopbackPeak": res["loopbackSummary"]["peak"],
            "loopbackRmsMax": res["loopbackSummary"]["rmsMax"],
            "micPeak": res["micSummary"]["peak"],
            "micRmsMax": res["micSummary"]["rmsMax"],
            "wavFile": str(wav_path),
            "status": "PASS" if res["loopbackSummary"]["peak"] > 0.005 or res["micSummary"]["peak"] > 0.005 else "FAIL"
        })
        time.sleep(0.5)
        
    # Write summary files
    summary_path = Path("docs/olivia/antigravity-chrome-qa/PRUEBAS_ACUSTICAS_REALES.json")
    summary_path.write_text(json.dumps({
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "speaker": speaker.name,
        "mic": mic.name,
        "loopback": loopback.name,
        "voice": "Google español",
        "trials": results
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    
    print("\n=== Batería acústica completada exitosamente ===")
    print(f"Reporte resumido guardado en: {summary_path}")

if __name__ == "__main__":
    main()
