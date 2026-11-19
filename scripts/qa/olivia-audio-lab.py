"""Controlled Windows audio QA. Microphone samples are reduced to levels, never saved.

Install SoundCard in a temporary PYTHONPATH. `probe` optionally saves only speaker
loopback (the synthetic stimulus and Olivia's output), plus numeric level windows.
Do not run a probe while unrelated media or private conversations are playing.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Event
import time
import wave
import winsound

import numpy as np
import soundcard as sc

RATE = 48000
WINDOW = 960  # 20 ms; multichannel avoids WASAPI's documented mono capture issue.


def iso_now():
    return datetime.now(timezone.utc).isoformat()


def levels(data):
    return {"rms": float(np.sqrt(np.mean(data * data))),
            "peak": float(np.max(np.abs(data))),
            "clippedFraction": float(np.mean(np.abs(data) >= .999))}


def capture(device, seconds, keep_audio, opened):
    count = int(seconds * RATE / WINDOW)
    windows, audio = [], []
    channels = min(2, device.channels)
    with device.recorder(samplerate=RATE, channels=channels, blocksize=WINDOW * 4) as recorder:
        started = time.time()
        opened.set()
        for i in range(count):
            data = recorder.record(numframes=WINDOW)
            windows.append({"offsetSeconds": i * WINDOW / RATE, **levels(data)})
            if keep_audio:
                audio.append(data.copy())
    return {"device": device.name, "channels": channels,
            "startedEpoch": started, "windows": windows}, (np.concatenate(audio) if audio else None)


def summary(record):
    windows = record["windows"]
    return {"device": record["device"], "channels": record["channels"],
            "startedEpoch": record["startedEpoch"], "windowSeconds": WINDOW / RATE,
            "rmsMedian": float(np.median([w["rms"] for w in windows])),
            "rmsMax": max(w["rms"] for w in windows),
            "peak": max(w["peak"] for w in windows),
            "clippedFractionMax": max(w["clippedFraction"] for w in windows)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["devices", "meter", "probe"])
    parser.add_argument("--seconds", type=float, default=3)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--stimulus", type=Path, help="Replay an approved WAV through the default physical speakers.")
    args = parser.parse_args()
    if not 0.5 <= args.seconds <= 40:
        parser.error("Use 0.5 to 40 seconds per controlled probe.")
    if args.output and args.command != "probe":
        parser.error("Only probe can save speaker loopback.")
    if args.stimulus and (args.command != "probe" or not args.stimulus.is_file()):
        parser.error("A probe stimulus must be an existing approved WAV file.")
    speaker, microphone = sc.default_speaker(), sc.default_microphone()
    loopback = sc.get_microphone(id=speaker.id, include_loopback=True)
    if args.command == "devices":
        print(json.dumps({"speaker": speaker.name, "microphone": microphone.name,
                          "loopback": loopback.name, "loopbackChannels": loopback.channels}, ensure_ascii=False))
        return
    if args.output and args.output.exists():
        parser.error("Refusing to overwrite an existing capture.")
    print(json.dumps({"status": "READY", "at": iso_now(), "seconds": args.seconds,
                      "microphoneAudioSaved": False}), flush=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        system_open, mic_open = Event(), Event()
        system_future = pool.submit(capture, loopback, args.seconds, bool(args.output), system_open)
        microphone_future = pool.submit(capture, microphone, args.seconds, False, mic_open)
        if not system_open.wait(10) or not mic_open.wait(10):
            raise RuntimeError("Audio capture did not become ready; no stimulus was played.")
        stimulus = None
        if args.stimulus:
            time.sleep(1)
            stimulus = {"file": str(args.stimulus.resolve()), "startedEpoch": time.time()}
            winsound.PlaySound(str(args.stimulus.resolve()), winsound.SND_FILENAME)
            stimulus["endedEpoch"] = time.time()
        system, audio = system_future.result()
        mic, _ = microphone_future.result()
    report = {"at": iso_now(), "sampleRate": RATE, "seconds": args.seconds,
              "loopback": summary(system), "physicalMicrophoneLevels": summary(mic),
              "microphoneAudioSaved": False}
    if stimulus:
        report["stimulus"] = stimulus
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(args.output), "wb") as target:
            target.setnchannels(audio.shape[1])
            target.setsampwidth(2)
            target.setframerate(RATE)
            target.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        envelope = args.output.with_suffix(".levels.json")
        envelope.write_text(json.dumps({**report, "loopbackWindows": system["windows"],
                                        "microphoneLevelWindows": mic["windows"]}), encoding="utf-8")
        report["loopbackFile"] = str(args.output.resolve())
        report["levelFile"] = str(envelope.resolve())
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
