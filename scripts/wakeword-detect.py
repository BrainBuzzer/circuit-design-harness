#!/usr/bin/env python3
"""Bounded LiveKit wake-word detection sidecar for Circuit Design Harness.

Reads length-prefixed PCM frames from stdin (uint32 LE sample count + int16 samples
at 16 kHz mono). Writes one JSON object per line on stdout:

  {"type":"ready"}
  {"type":"scores","scores":{"hey_eve":0.12}}
  {"type":"detection","name":"hey_eve","confidence":0.91}
  {"type":"error","message":"..."}

Uses livekit-wakeword (openWakeWord-compatible ONNX classifiers). No network.
Requires: pip install livekit-wakeword
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="LiveKit wake-word detector")
    parser.add_argument("--model", required=True, help="Path to hey_eve.onnx classifier")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--name", default="hey_eve", help="Expected score key / detection name")
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.is_file():
        emit({"type": "error", "message": f"Wake word model missing: {model_path}"})
        return 2

    threshold = max(0.0, min(1.0, float(args.threshold)))

    try:
        from livekit.wakeword import WakeWordModel  # type: ignore
    except ImportError:
        emit(
            {
                "type": "error",
                "message": "livekit-wakeword is not installed. Install with: python3 -m pip install livekit-wakeword",
            }
        )
        return 3

    try:
        model = WakeWordModel(models=[str(model_path)])
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "message": f"Failed to load wake word model: {exc}"})
        return 1

    emit({"type": "ready", "model": args.name, "threshold": threshold})

    stdin = sys.stdin.buffer
    while True:
        header = stdin.read(4)
        if not header:
            break
        if len(header) < 4:
            emit({"type": "error", "message": "Truncated frame header."})
            return 1
        (sample_count,) = struct.unpack("<I", header)
        if sample_count == 0 or sample_count > 480_000:
            emit({"type": "error", "message": f"Invalid sample count: {sample_count}"})
            return 1
        raw = stdin.read(sample_count * 2)
        if len(raw) < sample_count * 2:
            emit({"type": "error", "message": "Truncated PCM frame."})
            return 1
        try:
            import numpy as np

            audio = np.frombuffer(raw, dtype=np.int16)
            scores = model.predict(audio)
            # Normalize keys to strings
            score_map = {str(k): float(v) for k, v in dict(scores).items()}
            emit({"type": "scores", "scores": score_map})
            # Prefer exact name, else first score key
            confidence = score_map.get(args.name)
            if confidence is None and score_map:
                confidence = next(iter(score_map.values()))
                name = next(iter(score_map.keys()))
            else:
                name = args.name
            if confidence is not None and confidence >= threshold:
                emit(
                    {
                        "type": "detection",
                        "name": name,
                        "confidence": confidence,
                    }
                )
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "message": f"Wake word predict failed: {exc}"})
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
