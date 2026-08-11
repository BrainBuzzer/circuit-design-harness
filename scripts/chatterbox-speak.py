#!/usr/bin/env python3
"""Bounded Chatterbox (Resemble AI) synthesis sidecar for Circuit Design Harness.

Loads hash-verified local weights from a model directory (no network), synthesizes
short plain text to a mono WAV file. Prefer Chatterbox-Nano on CPU.

Requires: pip install chatterbox-tts torch torchaudio soundfile
"""

from __future__ import annotations

import argparse
import sys
import wave
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Synthesize speech with Resemble Chatterbox")
    parser.add_argument("--model-dir", required=True, help="Local Chatterbox checkpoint directory")
    parser.add_argument("--text-file", required=True, help="UTF-8 text to speak")
    parser.add_argument("--output", required=True, help="Output WAV path")
    parser.add_argument("--device", default="cpu", choices=["cpu", "mps", "cuda"])
    parser.add_argument("--variant", default="nano", choices=["nano", "turbo", "original"])
    parser.add_argument("--exaggeration", type=float, default=0.5)
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    text_path = Path(args.text_file)
    output_path = Path(args.output)

    if not model_dir.is_dir():
        print(f"Model directory missing: {model_dir}", file=sys.stderr)
        return 2
    if not text_path.is_file():
        print(f"Text file missing: {text_path}", file=sys.stderr)
        return 2

    text = text_path.read_text(encoding="utf-8").strip()
    if not text:
        print("Spoken text is empty.", file=sys.stderr)
        return 2
    if len(text) > 500:
        print("Spoken text exceeds 500 characters.", file=sys.stderr)
        return 2

    try:
        if args.variant in ("nano", "turbo"):
            from chatterbox.tts_turbo import ChatterboxTurboTTS  # type: ignore

            model = ChatterboxTurboTTS.from_local(
                str(model_dir),
                device=args.device,
                nano=args.variant == "nano",
            )
            wav = model.generate(text)
            sample_rate = int(model.sr)
        else:
            from chatterbox.tts import ChatterboxTTS  # type: ignore

            model = ChatterboxTTS.from_local(str(model_dir), device=args.device)
            wav = model.generate(text, exaggeration=float(args.exaggeration))
            sample_rate = int(model.sr)
    except ImportError:
        print(
            "chatterbox-tts is not installed. Install with: "
            "python3 -m pip install chatterbox-tts torch torchaudio soundfile",
            file=sys.stderr,
        )
        return 3
    except Exception as exc:  # noqa: BLE001 — surface model errors to host
        print(f"Chatterbox synthesis failed: {exc}", file=sys.stderr)
        return 1

    try:
        import numpy as np
        import torch

        if isinstance(wav, torch.Tensor):
            audio = wav.detach().cpu().float().numpy()
        else:
            audio = np.asarray(wav, dtype=np.float32)
        audio = np.squeeze(audio)
        if audio.ndim != 1:
            audio = audio.reshape(-1)
        pcm = np.clip(audio, -1.0, 1.0)
        pcm_i16 = (pcm * 32767.0).astype("<i2")
        with wave.open(str(output_path), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(sample_rate)
            out.writeframes(pcm_i16.tobytes())
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to write WAV: {exc}", file=sys.stderr)
        return 1

    print(f"ok sample_rate={sample_rate} frames={len(pcm_i16)} variant={args.variant}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
