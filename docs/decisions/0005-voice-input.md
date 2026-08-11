# ADR 0005: Local voice input, Eve wake phrase, and Chatterbox spoken replies

Status: accepted and updated on 2026-08-11

## Decision

Keep voice outside Pi's provider/model contract. The renderer records bounded audio, converts it locally to mono 16 kHz PCM WAV, and sends it through narrow IPC to a main-process transcription adapter. The adapter runs a pinned `whisper.cpp` executable with the multilingual `small-q5_1` model without a shell, provider credential, or untrusted network path beyond the allowlisted first-start model download.

### First-start model download

Large Whisper and Chatterbox weight files are **not** packaged in the app installer. On first application start (and whenever assets are missing or fail hash verification), the main-process `VoiceAssetService` downloads hash-pinned assets over HTTPS into the app userData directory, verifies byte size and SHA-256, and only then marks readiness. The small host-specific `whisper-cli` binary may still ship in `extraResources`; the ~181 MiB Whisper model and Chatterbox-Nano weights download on demand from allowlisted Hugging Face URLs recorded in `voice/sources.json`.

### Push-to-talk and Eve

Push-to-talk records for at most 60 seconds. Its transcript remains editable and is never auto-sent.

The optional Eve mode uses **[LiveKit wakeword](https://github.com/livekit/livekit-wakeword)** (openWakeWord-compatible ONNX classifier) for continuous local wake detection—not continuous Whisper transcription. The renderer streams 16 kHz PCM frames to a main-process Python sidecar (`scripts/wakeword-detect.py` → `livekit.wakeword.WakeWordModel`). On detection of the pinned `hey_eve` classifier, Eve records one bounded eight-second command segment and runs Whisper **once** for that command. Eve is off by default, visibly enabled, paused while Pi, push-to-talk, or TTS is active, and torn down when the active project changes. If wake-word or Whisper assets are still downloading, Eve enters a recoverable waiting state and retries.

The `hey_eve.onnx` classifier is acquired into userData on first start (hash-verified). A training config lives at `voice/wakeword/hey_eve.yaml` for producing a production-quality model with `livekit-wakeword run`; replace the placeholder ONNX and update `voice/sources.json` pins after training.

### Spoken replies (Chatterbox)

Spoken replies use **Resemble AI Chatterbox** ([github.com/resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)), specifically the on-device **Nano** variant loaded via a bounded Python sidecar (`scripts/chatterbox-speak.py`), not browser `speechSynthesis` / OS `localService` voices. Before synthesis, a pure `prepareSpokenReply` / `summarizeForSpeech` transform shortens the assistant message and strips dense electrical values, long pin/net dumps, and code fences so TTS conveys the high-level outcome without reciting BOM detail. The full chat text on screen is unchanged. Rate/volume/tone preferences still shape delivery; tone never changes evidence or safety claims. Speech is cancelled on project changes and when listening begins.

## Why

- Pi's chat model contract accepts text/images, not audio.
- Local recognition and synthesis avoid provider coupling, credential handling, and audio upload.
- Download-on-first-start keeps installer size manageable while preserving hash-verified supply chain for weights.
- Chatterbox is the product-required open-source TTS family; Nano is the CPU-friendly member of that family suitable for first-run Electron hosts.
- Summarized speech avoids long component-value blathering while keeping the written reply complete.

## Verification boundary

- Unit tests cover WAV/content/duration/project guards, cancellation, runtime absence, download+hash verify (including tamper rejection), wake-phrase segmentation, Eve asset-wait recovery, speech-summary transforms on electronics-heavy fixtures, Chatterbox TTS readiness gating and summary→sidecar pipeline, preference persistence, and per-file voice-bundle verification when the large Whisper model is absent from the package.
- Representative Indian-accent speakers, Galaxy S23 microphones, noisy rooms, TTS echo, latency, and emotional voice quality remain real-device qualification work. Do not describe them as verified.
- Host must provide `python3` with `chatterbox-tts` (and torch/torchaudio/soundfile) for synthesis; missing Python deps surface as actionable synthesis errors after weights are ready. Full multi-GB weight downloads are not required to pass automated gates—fixtures + injectable fetch prove the contract.

## Consequences

- Wake listening currently launches a bounded Whisper process per audio segment; a reviewed persistent worker may reduce latency and power use later.
- First start requires network access for allowlisted model URLs and substantial local disk for Chatterbox-Nano weights (~2 GiB class).
- Windows/Linux releases require their own reproducibly built and verified Whisper `whisper-cli` binaries; model weights share the same download pins.
- Preference field `speechVoiceUri` is retained for schema compatibility but is unused by the Chatterbox speak path.
