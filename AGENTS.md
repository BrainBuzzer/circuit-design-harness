# Circuit Design Harness — repository agent instructions

These instructions apply to every file in this repository. Read `README.md`, the relevant section of `TASKS.md`, and applicable ADRs before changing behavior.

## Product invariants

- “Pi” is the Pi coding-agent harness, not Raspberry Pi hardware.
- Provider/auth/model support comes from Pi's runtime. Do not create a parallel credential store or hard-code one provider.
- The executable embedded targets are exactly `arduino_uno_r3` and `esp32s3` until an ADR and verified local engine expand that set.
- Other ESP32 entries may remain in the pinned ESPHome reference catalog, but must be labeled non-executable by this product.
- No Wokwi, cloud simulator, remote firmware execution, silent telemetry, or firmware/design upload fallback.
- One project owns one primary Pi conversation, canonical circuit, breadboard assembly, attachments, captures, firmware, and simulation-model history.
- Chat is context, not the design database. `circuit.json` and `assembly.json` are canonical.
- Normal Pi sessions have no general shell, arbitrary filesystem, or arbitrary network tools.

## Claim discipline

Always distinguish:

1. structural validation;
2. native compiler validation;
3. artifact production;
4. processor/SoC execution;
5. peripheral coverage;
6. external-part functional evaluation;
7. electrical/timing/thermal simulation;
8. physical evidence or hardware-in-the-loop measurement; and
9. qualified safety/certification review.

Never promote a lower stage to a higher one. A camera image cannot establish hidden connectivity, polarity, continuity, voltage, current, or safety. A bounded processor run does not prove that a connected circuit works. A truth table or idealized analog curve is not SPICE.

- Uno firmware traces must retain the versioned virtual-time contract, output-mode filtering, event caps/truncation flags, and explicit pin-to-net mappings. Never infer a circuit connection from matching labels.
- The pinned ESP32-S3 QEMU GPIO peripheral is unsupported (strap-only stub). Do not claim or synthesize S3 GPIO/circuit traces until a reviewed engine change supplies observable behavior and fixtures.

## Safety boundary

Target extra-low-voltage, current-limited prototypes. For mains, high current, lithium charging, medical, automotive-safety, RF-power, or other hazardous work:

- identify the hazard visibly;
- require primary documentation and qualified human review;
- recommend isolation/current limiting and proper measurement equipment;
- do not autonomously approve energizing or conceal missing ratings.

Unknown ratings, pinouts, variants, or visible details remain unknown. Ask for a datasheet page, close-up, continuity/voltage measurement, or exact part marking.

## Electron and authority boundaries

- Keep renderer sandboxing and context isolation enabled; keep Node integration disabled.
- Expose narrow typed preload methods only. Never expose raw `ipcRenderer`, shell, filesystem, credentials, or Pi internals.
- Validate the sender and runtime schema at every IPC boundary.
- Treat attachments, OCR text, imported designs, model output, URLs, and camera metadata as untrusted.
- Use allowlists for targets, commands, URLs, file types, and simulator executables.
- Spawn native tools without a shell, with bounded cwd, arguments, duration, output, and cancellation where available.
- Packaged builds resolve simulator binaries only from a verified host manifest. Development PATH fallback must be explicit and must never become a production fallback.
- Do not log credentials, document contents, media, private paths, or provider payloads by default.
- Keep aggregate persistent application/native-tool logs at or below 100 MiB. Prefer no persistent diagnostic logs; bound process output in memory and rotate/prune before a write could exceed the budget.
- Never pass QEMU `-D`, file-backed serial/chardev/trace output, or another persistent debug-output path. Product QEMU output stays in bounded stdout/stderr, and timeout termination uses `SIGKILL` so a simulator cannot retain a deleted file.
- Native dependency build sources and toolchains are temporary inputs. Create them in uniquely named temporary directories and delete them in `finally` on success, failure, or cancellation; never retain them as an implicit cache.

## Circuit and assembly changes

- Preserve stable component, pin, net, placement, project, attachment, and capture IDs.
- Apply design changes as typed, bounded transactions with base revision, rationale, validation, atomic persistence, and history.
- Pi may inspect and stage a proposal. Only an explicit user IPC action may approve/apply it.
- Reject stale revisions, unknown pins/components, multi-net terminals, shorts, invalid placements, and schema errors before writing.
- Keep logical connectivity separate from physical breadboard placement.
- Never mutate a circuit or model file as an opaque LLM-authored blob.
- Add migrations and tests before changing persisted schemas. Preserve previous revisions/checkpoints.

## Built-in and datasheet-derived models

- The built-in IC set is the ten entries in `src/domain/ic-models.ts`. Preserve exact model IDs and ordered pin IDs; any pin/supply/behavior change requires a manufacturer source and test update.
- Every built-in adapter must state what it omits. Mixed-signal adapters are idealized unless a reviewed electrical solver proves otherwise.
- Project model packs are strict declarative JSON. Do not add JavaScript, native modules, expressions, callbacks, arbitrary paths, dynamic imports, subprocesses, or network references to the pack format.
- A generated pack requires explicit user installation, attachment UUID/page claims, confidence, limitations, hash capture, monotonic revision, atomic replacement, and preserved history.
- Pi receives guidance/read authority only; do not give it direct pack-install authority.
- Fixed runtime kinds are digital truth tables, analog interpolation, I²C register state/access, and SPI command recognition. New behavior kinds require schema validation, bounded deterministic execution, tests, UI limitations, and an ADR if they expand authority.
- A datasheet citation supports only the claim on that page. Never invent a value to complete a model.

## Camera, audio, and evidence

- Preview stays local. Manual chat attachment requires an explicit save/select. A recognized explicit visual request may capture exactly one current frame into Pi context only while the separate Settings consent is enabled; never infer consent from preview alone.
- Keep project ID, capture ID, timestamp, source, circuit revision, and attachment/page provenance with evidence.
- Push-to-talk capture is deliberate and bounded. Its transcription remains editable and must not auto-send. Eve wake listening is a separate explicit opt-in: keep it local, visibly active, bounded by segments, and paused during Pi activity, manual microphone use, and TTS.
- Stop speech/listening/capture work when the active project changes.
- Do not make Eve default-on, hide its listening state, upload its audio, or add continuous model video upload without new product work on consent, echo, retention, cost, and session routing.
- The primary phone relay is private-LAN WSS with a fresh 256-bit token, ephemeral certificate, displayed SHA-256 fingerprint, one phone, and bounded JPEG frames. Do not call it authenticated WebRTC. The legacy JPEG endpoint must remain private/loopback literal-address only, with bounded content types/sizes, no embedded credentials, and no redirects.

## Coding standards

- Use strict TypeScript and Zod at persistence/IPC boundaries.
- Avoid `any`, non-null assertions, unchecked casts, ambient authority, and unitless engineering values.
- Prefer pure deterministic domain functions and explicit state transitions.
- Keep error messages actionable and use stable codes where callers branch on them.
- Serialize per-project writes and use atomic replacement for canonical files.
- Preserve unrelated user work; never reset or overwrite a dirty worktree broadly.
- Use `apply_patch` for hand edits and repository tools for mechanical formatting/generation.
- Do not add a dependency when a small tested implementation is clearer. Record licenses/pins for material native dependencies.
- Keep archived experiments out of active product/build paths and document why they are archived.

## Testing requirements

For behavior changes, add the smallest relevant set of:

- pure domain tests;
- schema/IPC/service contract tests;
- migration and stale-revision tests;
- known-good and known-bad circuit/simulator fixtures;
- renderer component tests for stateful UI;
- Electron E2E/visual smoke tests for user workflows; and
- clean-host/package checks for native sidecars.

Test denial, absence, malformed input, cancellation, stale state, cross-project routing, tampered hashes, duplicate revisions, unsupported peripherals, and process failures—not only happy paths.

Do not weaken safety, security, validation, or test assertions to make a check pass.

Canonical gates:

```bash
bun run check
bun run typecheck
bun run test
bun run build
bun run test:e2e
bun run quality
```

Before declaring work complete, update `README.md`, `TASKS.md`, and any affected ADR with the exact verified boundary and unresolved risks. Use `planned`, `implemented`, or `verified` precisely.
