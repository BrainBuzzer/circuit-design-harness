# Circuit Design Harness implementation ledger

Last updated: 2026-08-11

Status vocabulary:

- `[x] verified` — implemented and covered by the relevant automated or manual acceptance check.
- `[-] implemented` — code exists, but a listed release/device check is still outstanding.
- `[ ] planned` — not implemented.
- `[!] blocked` — requires a named external prerequisite or product decision.

Never relabel compilation as simulation, processor execution as peripheral coverage, a functional model as electrical physics, or camera evidence as proof of safety.

## Phase 0 — Decisions and scope

- [x] Define Pi as the Pi coding-agent harness, not Raspberry Pi hardware.
- [x] Preserve Pi-native BYOK/auth/provider behavior instead of inventing a second credential system.
- [x] Select local-only simulation; reject Wokwi/cloud simulator dependencies.
- [x] Narrow executable product targets to Arduino Uno R3 and ESP32-S3.
- [x] Keep other ESP32 boards only in the official ESPHome reference catalog with an unsupported-product warning.
- [x] Define one project as one primary chat, one logical circuit, one physical assembly, and one project-owned evidence/model history.
- [x] Define extra-low-voltage, current-limited prototyping as the initial safety envelope.
- [x] Record architecture decisions under `docs/decisions/`.

Acceptance: README, ADRs, target schemas, UI target list, Pi tools, compiler mappings, simulator dispatch, and tests agree on Uno + ESP32-S3.

## Phase 1 — Secure Electron foundation

- [x] Scaffold Electron 43, React 19, strict TypeScript, electron-vite, Tailwind, and shadcn-style primitives.
- [x] Apply Beautiful UI–inspired design tokens (soft card/button shadows, accent palette, AI chat bubbles, thinking/status orb, approval cards, elevated prompt bar, segmented design-view switch) while preserving the light engineering workbench layout.
- [x] Disable Node integration; enable context isolation and renderer sandboxing.
- [x] Load production assets through the application protocol and restrictive CSP.
- [x] Deny arbitrary navigation/windows and validate every IPC sender.
- [x] Expose a purpose-specific typed preload API, never raw `ipcRenderer`.
- [x] Gate camera and microphone permissions to short-lived trusted-origin requests.
- [x] Add minimum-window and production-launch Electron smoke coverage.
- [x] Harden the macOS application bundle and Electron fuses.
- [ ] Move sustained Pi and document parsing work to utility/child processes before untrusted wider testing.

## Phase 2 — Project/session persistence

- [x] Add configurable project root selection and writability validation.
- [x] Create, activate, rename, and restore projects.
- [x] Generate stable project IDs/slugs and one portable `AGENTS.md` per project.
- [x] Create chat, attachments, captures, firmware, simulation model, history, trash, and export directories.
- [x] Use schema-versioned JSON and atomic file replacement.
- [x] Persist circuit revision in the project manifest.
- [x] Export/import deterministic project archives with path validation.
- [x] Add project integrity verification across schemas and recorded hashes.
- [ ] Add conflict UX for simultaneous external edits/cloud-synced roots.
- [ ] Add automatic crash-journal recovery beyond transaction checkpoints.

## Phase 3 — Pi runtime and BYOK

- [x] Embed Pi `AgentSession` and `ModelRuntime` in the host process.
- [x] Point each project session manager at `<project>/chat`.
- [x] Discover Pi providers/models and restore the latest conversation.
- [x] Support Pi login prompts, masked secret input, cancellation, logout, and model switching.
- [x] Stream assistant deltas and reject late cross-project events.
- [x] Disable all built-in general tools for normal design sessions.
- [x] Add constrained component-catalog, circuit/breadboard proposal, publication-layout, camera-inspection, firmware read/compile/run, simulation-assessment, ESPHome, IC-catalog, and model-pack tools.
- [x] Route the exact natural-language ESP32 Pomodoro creation request to same-turn proposal staging without redundant firmware/display confirmation; keep the route app-owned and strip its internal context from the visible transcript.
- [x] Add explicit approve/reject paths for Pi circuit and breadboard proposals.
- [x] Prevent Pi from installing a generated model pack directly; installation is user-only IPC.
- [ ] Add provider-backed automated login/session tests using dedicated non-personal fixtures.

## Phase 4 — Logical circuit and publication slice

- [x] Define schema-v3 canonical components, stable pins, nets, constraints, placements, and publication metadata, with tested v1/v2 migration and retained backups.
- [x] Implement a declarative 44-kind structural catalog covering common sources, passives, diodes, transistors, switching/protection, electromechanical loads, connectors, power symbols, logic/analog primitives, an official-pinout ESP32-S3-DevKitC-1 v1.1 board, and built-in ICs.
- [x] Implement add/remove/move/rotate/value/connect/disconnect, net-rename, constraint, and publication-metadata transactions.
- [x] Reject duplicate IDs/references, unknown pins, multi-net terminals, shorted sources, and orphan placements.
- [x] Report missing values, dangling nets, and unconnected pins.
- [x] Validate a complete transaction before atomic persistence.
- [x] Record before/after history and durable undo checkpoints.
- [x] Render a light, review-only SVG schematic using the same conventional-symbol geometry as export, with orthogonal wires, junctions, and rotation-independent labels.
- [x] Export deterministic page and transparent SVGs, CSV/Markdown BOMs, a design report, and canonical circuit JSON.
- [x] Give Pi catalog/read/propose/publication-layout tools that resolve stable references and exact pin IDs.
- [x] Remove direct circuit/assembly mutation and undo from the renderer preload/IPC surface; explicit proposal approval remains the only renderer authority that applies design changes.
- [x] Define exact Uno header-to-ATmega328P port maps and a limitation-annotated ESP32-S3 chip GPIO reference.
- [x] Add an agent-placeable ESP32-S3-DevKitC-1 v1.1 circuit symbol with all 44 official J1/J3 header positions, board-revision limitations, shared on-screen/export geometry, and typed proposal coverage.
- [-] Add board symbols: the agent-placeable ESP32-S3-DevKitC-1 v1.1 symbol and its 44 official J1/J3 header positions are implemented; an Uno board symbol and manual dragging remain planned.
- [ ] Add a full manufacturer-part/package/footprint model and lifecycle metadata.
- [ ] Add KiCad/Circuit JSON/SPICE import/export with explicit loss reports.
- [ ] Add PCB layout/routing/manufacturing views.

## Phase 5 — Breadboard assembly and physical validation

- [x] Define a separate versioned physical assembly tied to circuit revision.
- [x] Implement 30-column breadboard terminal strips and top/bottom power rails.
- [x] Place component pins and color-coded jumpers.
- [x] Reject unknown pins, duplicate placements, occupied holes, and physical shorts.
- [x] Report logical nets whose placed terminals are not physically connected.
- [x] Detect stale circuit/assembly revisions.
- [x] Persist assembly transactions and expose assembly state to Pi.
- [x] Resolve Pi operations from stable component references, validate whole breadboard proposals without mutation, and reject stale approval.
- [ ] Support split-rail breadboards, mini boards, multiple boards, and custom topology.
- [ ] Add polarity/orientation/package-fit rules and measurement assertions.

## Phase 6 — Attachments and grounded datasheets

- [x] Content-sniff, size-bound, hash, and copy imported PDFs/text/images.
- [x] Preserve immutable originals and page/extraction manifests.
- [x] Extract text; render/OCR image-only pages with confidence labels.
- [x] Keep attachment UUID, original filename, page, excerpt, hash, and OCR status in Pi evidence.
- [x] Retrieve bounded relevant chunks instead of dumping entire documents.
- [x] Add page viewer, deterministic re-index, recoverable trash, and restore.
- [x] Treat extracted text as untrusted evidence rather than instructions.
- [ ] Add bounding-box citations and in-view claim highlighting.
- [ ] Move parsers into a tighter utility-process sandbox and ship every parser/OCR dependency.
- [ ] Add adversarial/corrupt/encrypted/oversized PDF corpus tests.

## Phase 7 — Camera and voice

- [x] Add local UVC/virtual-camera preview and explicit device selection.
- [x] Add literal-private-address, no-redirect, bounded JPEG remote-camera compatibility.
- [x] Add ephemeral HTTPS + encrypted WebSocket phone relay with QR pairing, a 256-bit session token, SHA-256 certificate fingerprint, one-client replacement, and bounded JPEG frames.
- [x] Freeze, review, save, and explicitly select a frame before Pi receives it.
- [x] Keep the current preview ephemeral, deterministically route explicit visual phrases through the consent-gated camera operation, attach one revision-linked frame to that same Pi turn, and retain the Pi camera tool for longer workflows.
- [x] Include circuit revision and capture provenance in multimodal context.
- [x] Add editable, non-auto-send push-to-talk transcription with local multilingual Whisper, size/time/cancellation guards, and hash-verified model/runtime assets.
- [x] Add opt-in local “Eve”/“Hey Eve” segmentation, visible listening state, Pi/manual-mic/TTS pause behavior, and cross-project teardown.
- [-] Add optional installed-local-system spoken replies, tone-shaped wording/rate/pitch, and speech teardown; real-device voice quality/emotion remains unverified.
- [ ] Add annotations/crops/redaction and capture-retention controls.
- [ ] Replace bearer-token/self-signed compatibility with authenticated device identity and WebRTC if adaptive media, NAT traversal, or richer phone controls are required.
- [ ] Run Galaxy S23, representative Indian-accent, noisy-room, echo, latency, battery, roaming, and hostile-LAN qualification.

## Phase 8 — Uno and ESP32-S3 firmware

- [x] Provide project-local Arduino and ESPHome persistence plus constrained Pi read/replace/compile tools; remove the manual firmware/simulation dashboard.
- [x] Map only `arduino_uno_r3` and `esp32s3` through an allowlisted FQBN table.
- [x] Perform structural validation before native tool invocation.
- [x] Invoke Arduino CLI and ESPHome without a shell, with bounded cwd/arguments/time/output.
- [x] Record firmware source and build artifacts under the project.
- [x] Report native-tool absence, validation failure, compile failure, and successful artifact creation separately.
- [x] Run Uno ELF artifacts through a pinned `simavr` sidecar for bounded deterministic virtual time.
- [x] Probe exact Espressif QEMU machine presence before running ESP32-S3 merged images.
- [x] Reject generic architecture QEMU as an ESP32-S3 simulator.
- [x] Resolve packaged sidecars only from a verified host manifest; development may fall back to PATH.
- [x] Retire active ESP32-S2 and RISC-V build/probe paths after the target scope changed.
- [ ] Add cancellation and isolated worker lifecycle for long firmware compile/simulation processes.
- [x] Capture a versioned bounded Uno digital-output/UART trace and bridge explicit final output pins into circuit-net scenario assertions.
- [x] Add deterministic virtual time plus a known-pass ATmega328P D13 firmware fixture and trace parser/bridge fixtures.
- [ ] Add circuit-to-firmware input feedback, UART assertions, and decoded I²C/SPI transactions; these are not implied by the current one-way GPIO bridge.
- [x] Audit pinned ESP32-S3 QEMU GPIO and report it unsupported: the device is a strap-only register stub with no observable pin behavior.

## Phase 9 — ESPHome catalog and guidance

- [x] Pin exact ESPHome source and documentation commits.
- [x] Generate a deterministic catalog of 738 in-tree components and 298 ESP32 boards.
- [x] Include component platform/module metadata plus official documentation and source links.
- [x] Search boards/components from the UI and Pi tool.
- [x] Parse and structurally validate exact YAML.
- [x] Skip unsafe native expansion for external components.
- [x] Run native `esphome config` before compile when safe and available.
- [x] Assess ESP32-S3 board simulation; retain other boards as reference-only with an explicit warning.
- [ ] Extract option-level schemas/examples into an offline guidance index; today the app links official docs and delegates exact option validation to installed ESPHome.
- [ ] Add catalog-refresh CI that reports upstream diffs before replacing the pinned snapshot.

## Phase 10 — Ten built-in IC models

- [x] Choose and document a high-utility set instead of claiming an unverifiable popularity ranking.
- [x] Add NE555, LM358B, LM393, SN74HC00, SN74HC04, SN74HC595, SN74HC165, CD4017B, ULN2003A, and L293D.
- [x] Record official TI datasheet URLs, ordered package pins, supply metadata, fidelity, and limitations.
- [x] Implement deterministic combinational logic, stateful registers/counter, low-side/open-collector, motor-driver truth behavior, and idealized mixed-signal adapters.
- [x] Add approval-gated Pi schematic placement with stable model/pin IDs.
- [x] Add Pi catalog inspection and a local interactive behavior bench.
- [x] Propagate manual stimuli through connected schematic ICs with bounded convergence, component state/rising edges, conflicting-driver diagnostics, and explicit net assertions.
- [x] Unit-test catalog uniqueness, pin order, truth behavior, edge/state behavior, tri-state behavior, and idealized analog decisions.
- [x] Bridge explicit Uno firmware GPIO outputs into the connected circuit-net runner; manual stimuli can coexist when they do not conflict.
- [ ] Schedule event-by-event bidirectional firmware/peripheral co-simulation; the current bridge applies final observed output levels for one deterministic circuit step.
- [ ] Add current/voltage/loading/timing/thermal models or a reviewed SPICE bridge before making electrical claims.

## Phase 11 — Guarded datasheet-to-model workflow

- [x] Define a strict schema-versioned declarative pack; reject unknown fields.
- [x] Restrict target IDs to Uno and ESP32-S3.
- [x] Require page-level project attachment provenance and confidence.
- [x] Validate duplicate pins, pin references, voltage ranges, truth-table completeness, analog point order, register uniqueness, and opcode uniqueness.
- [x] Prohibit executable code, expressions, scripts, arbitrary paths, and network references by construction.
- [x] Add Pi guidance/list tools while withholding install authority.
- [x] Add explicit paste/review/install UI.
- [x] Verify attachment and page existence, capture attachment hash, and fingerprint the proposal.
- [x] Serialize project writes, require increasing revisions, write atomically, and retain previous revisions.
- [x] Implement fixed local adapters for digital truth tables, clamped analog interpolation, I²C register state/access, and SPI command recognition.
- [x] Add a project-model runtime UI and exact limitation output.
- [x] Test strictness, bad references/ranges, citations, hashing, revision history, all four runtimes, and installed-model evaluation.
- [ ] Add a structured proposal editor/diff instead of raw JSON paste.
- [ ] Add provenance coverage checks that require each individual electrical/register/command claim to map to a citation, not merely at least one citation per pack.
- [ ] Add signed/trusted publisher packs if models are ever shared across projects.

## Phase 12 — Packaging and release

- [x] Pin simavr and Espressif QEMU source commits and licenses.
- [x] Build the active sidecars for Uno and ESP32-S3 only.
- [x] Bundle the allowlisted macOS dynamic-library/license closure.
- [x] Rewrite local loader paths and ad-hoc sign Mach-O sidecars.
- [x] Record every shipped simulator file size and SHA-256 hash.
- [x] Keep persistent app/native-tool logs at or below an aggregate 100 MiB with startup retention and a quality-gate audit; the application writes no diagnostic logs by default.
- [x] Prohibit QEMU file-backed debug/serial/chardev/trace output, cap captured process output, and force-kill timed-out simulator processes so deleted files cannot remain open and grow invisibly.
- [x] Isolate embedded Pi sessions from global extensions, skills, packages, and prompt overrides while preserving the active project's `AGENTS.md`; this prevents extension commands from spawning the packaged Electron binary as a Pi CLI or re-enabling general tools.
- [x] Run two consecutive live provider-backed disposable-project checks of the exact ESP32 Pomodoro sentence; both staged validated typed proposals after fixing same-transaction created-net lookup, and every disposable project was removed in `finally`.
- [x] Build simulator and voice sidecars in unique temporary source directories and delete those directories in `finally` on success or failure.
- [x] Verify exact `esp32s3` machine presence in the checked-in macOS arm64 bundle.
- [x] Run the final AI-first quality/E2E/package smoke: 39 test files/126 tests, production build, 100 MiB log-retention/storage audit, publication schematic/catalog/review-only authority, Electron layout/settings/QR/local+LAN-camera/project-restoration workflows, minimum-window control fit, package creation/direct launch/clean quit, deep signature verification, all 18 voice+simulator manifest hashes, and bundled S3 machine presence.
- [-] Pin, build, hash-verify, package, and execute the macOS arm64 `whisper.cpp` + multilingual `small-q5_1` bundle; other hosts and representative-speaker qualification remain outstanding.
- [ ] Build and verify Windows x64 and Linux x64/arm64 simulator sidecars.
- [x] Wire Developer ID + hardened-runtime + notarytool packaging (`package:mac`, entitlements, after-pack release path that does not ad-hoc overwrite release signatures, unused native exclusions, `scripts/verify-macos-gatekeeper.sh`).
- [x] Obtain a Developer ID Application certificate and App Store Connect API notary key; notarize the existing Developer ID arm64 ZIP — Apple status **Accepted** / Ready for distribution; ticket includes nested simulators/voice Mach-O.
- [-] Local `spctl --assess` + `xcrun stapler validate` on this agent host remain blocked by Launch Services/codesign subsystem errors (reproduced on Calculator.app too); re-run `bun run package:mac:verify` and a clean-Mac double-click open outside the agent when LS works. Fresh `package:mac` re-sign also needs `timestamp.apple.com:443` reachability.
- [x] Add GitHub Actions CI (quality gates + macOS ad-hoc package smoke) and release pipelines (tag/`workflow_dispatch` → package DMG/ZIP → GitHub Release; optional Apple secrets; explicit ad-hoc vs Developer ID/notarized channel + sidecar presence in notes).
- [ ] Add installer, update channel, rollback, SBOM, and complete third-party notices.

## Phase 13 — Release acceptance scenarios

- [x] Known-good 5 V / 330 Ω / LED logical circuit passes ERC fixture.
- [x] Shorted-source and malformed-net fixtures fail with stable reasons.
- [x] Breadboard intrinsic strips/rails and jumper connectivity are verified by unit tests.
- [x] Uno compile/simavr command and artifact flow is covered by service tests.
- [x] ESP32-S3 exact-machine acceptance and generic-QEMU rejection are covered by service tests.
- [x] Built-in and generated component runtimes have deterministic unit fixtures.
- [x] Connected built-in IC net propagation has known-pass, conflicting-driver, failed-assertion, and invalid-scenario fixtures.
- [x] Project isolation, archive integrity, media guards, provider UI, and core Electron startup have automated coverage.
- [x] Verify the three-column camera-over-design layout, working Settings persistence, QR/WSS pairing lifecycle, review-only schematic/breadboard surfaces, conventional symbols, catalog/inspector/zoom controls, six-file export, and no document overflow at 960×640 in Electron E2E.
- [x] Add domain/service scenarios where a versioned firmware signal drives schematic nets and assertions.
- [x] Add an Electron E2E fixture where real Uno HEX execution drives a stable circuit net and assertion through IPC/UI.
- [ ] Extend the Electron E2E firmware fixture through a placed built-in IC; IC net propagation is currently covered independently by domain fixtures.
- [ ] Run physical Uno and ESP32-S3 hardware-in-the-loop fixtures; compare UART/GPIO traces without treating them as certification.
- [ ] Test a real Galaxy S23 WSS camera flow and any later WebRTC flow across representative LAN conditions.
- [ ] Complete accessibility audit, keyboard-only workflow, reduced-motion, and screen-reader pass; automated 960×640 layout/overflow coverage is complete.

## Current completion boundary

The repository is a substantial working vertical slice. It is complete for project/Pi/evidence workflows, typed approval-gated AI circuit and breadboard design, the 44-kind structural component catalog including ESP32-S3-DevKitC-1 v1.1, deterministic publication schematic assets, the AI-first camera-over-design workbench, local Eve/Whisper software flows, token-scoped private-LAN WSS camera transport, compile + bounded processor execution on Uno/S3, deterministic Uno output/UART tracing, explicit one-way Uno pin-to-net assertions, standalone deterministic IC behavior evaluation, and guarded project-specific declarative models. Physical phone/microphone/accent/voice quality is not included in that verified claim.

It is not complete as a unified electrical co-simulator or production-signed multi-platform CAD product. The highest-priority remaining engineering sequence is:

1. add visible draggable board symbols on top of the implemented pin maps;
2. add circuit-to-firmware input feedback and an event scheduler instead of final-state-only propagation;
3. decode and bridge UART/I²C/SPI transactions where the engine exposes them;
4. add reviewed voltage/current/loading/timing diagnostics or a SPICE bridge before electrical claims;
5. run real Galaxy S23 camera and representative Indian-accent/echo/latency qualification, then optimize wake inference with a persistent isolated worker if measurements justify it;
6. add physical hardware-in-the-loop comparisons without treating them as certification;
7. isolate sustained Pi/simulator/compile/voice processes and support cancellation;
8. then finish multi-host packaging, accessibility, and signed distribution.
