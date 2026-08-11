# ADR 0005: Local voice input, Eve wake phrase, and installed local speech

Status: accepted and implemented on 2026-08-09

## Decision

Keep voice outside Pi's provider/model contract. The renderer records bounded audio, converts it locally to mono 16 kHz PCM WAV, and sends it through narrow IPC to a main-process transcription adapter. The adapter runs a pinned `whisper.cpp` executable with the multilingual `small-q5_1` model without a shell, provider credential, or network request. The executable, model, source commit, sizes, licenses, and SHA-256 hashes are recorded in the host-specific voice manifest and verified before use.

Push-to-talk records for at most 60 seconds. Its transcript remains editable and is never auto-sent. The optional Eve mode records 2.5-second local segments, detects “Eve” or “Hey Eve” in the local transcript, and either sends the remainder as the request or records one bounded eight-second command segment. Eve is off by default, visibly enabled, paused while Pi, push-to-talk, or TTS is active, and torn down when the active project changes.

Spoken replies use only voices the browser marks as `localService`. Warm, focused, calm, and energetic preferences shape both Pi's response-writing guidance and local speech rate/pitch. Tone never changes evidence or safety claims. Speech is cancelled on project changes and when listening begins.

## Why

- Pi's chat model contract accepts text/images, not audio.
- Local recognition avoids provider coupling, credential handling, audio upload, and opaque browser speech-recognition services.
- The multilingual small model is a deliberate accuracy/size compromise for Indian English and code/electronics vocabulary; the checked-in quantized model is about 181 MiB.
- An opt-in state machine preserves session routing and makes microphone consent visible.

## Verification boundary

- Unit tests cover WAV/content/duration/project guards, cancellation, runtime absence, wake-phrase segmentation, preference persistence, and voice-bundle tamper rejection.
- A real pinned engine/model run transcribed a generated “Hey Eve, check the resistor value” fixture correctly.
- Electron E2E verifies the Eve control, settings persistence, local-voice controls, and project/minimum-window lifecycle.
- Representative Indian-accent speakers, Galaxy S23 microphones, noisy rooms, TTS echo, latency, and emotional voice quality remain real-device qualification work. Do not describe them as verified.

## Consequences

- Wake listening currently launches a bounded Whisper process per audio segment; a reviewed persistent worker may reduce latency and power use later.
- The installed local-system voice determines the achievable naturalness and emotional range. The app does not download or silently install a TTS voice.
- Windows/Linux releases require their own reproducibly built and verified Whisper bundles.
