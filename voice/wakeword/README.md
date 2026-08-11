# Wake-word model (LiveKit)

This product uses the **trained** LiveKit classifier:

- **Phrase:** “Hey LiveKit”
- **File:** `hey_livekit.onnx` (from [livekit/livekit-wakeword](https://github.com/livekit/livekit-wakeword) `examples/resources/`)
- **Pins:** `voice/sources.json` → `wakeword.files`

First start copies/downloads the model into userData (`voice-assets/wakeword/`) after SHA-256 verification.

Inference: `scripts/wakeword-detect.py` via `livekit.wakeword.WakeWordModel`.
