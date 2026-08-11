# Circuit Design Harness

Circuit Design Harness is a local-first Electron workbench that keeps a Pi coding-agent conversation, circuit schematic, breadboard assembly, firmware, datasheets, camera evidence, and simulation artifacts together in one user-owned project folder.

The application is intended for low-voltage, current-limited prototyping. It helps design and inspect circuits; it is not a certification tool and cannot prove a physical build safe from a camera image or a processor trace.

> [!IMPORTANT]
> This repository contains a working vertical slice, not a complete SPICE/PCB suite. Pi chat, BYOK/provider login, project persistence, attachments, camera captures, typed circuit edits, breadboard checks, firmware compilation, bounded Uno/ESP32-S3 processor execution, ten built-in IC behavior models, and guarded datasheet-derived model packs are implemented. Uno digital output state can drive explicit circuit-net scenarios, but this is functional event propagation—not electrical co-simulation—and analog/thermal/timing physics remain explicitly limited.

## Status

Last audited: 2026-08-09

| Area | Current verified boundary |
| --- | --- |
| Desktop UI | Sandboxed Electron + React application with a Beautiful UI–inspired light engineering theme (soft card shadows, accent chips, AI status orb, elevated prompt bar, approval cards), collapsible project sidebar, full-height assistant column, and a right laboratory column split between build camera and schematic/breadboard design; verified in normal-window and 960×640 minimum-window workflows |
| Pi harness | Pi `AgentSession`, streaming/restoration, provider discovery, Pi-supported API-key/OAuth/custom-provider auth, model selection, image/tool-result input, and purpose-specific design/camera/firmware tools; embedded sessions exclude global extensions/skills/prompt overrides and expose no general shell/file tools |
| Project storage | Configurable project root, one project/session/design, atomic versioned JSON, history, deterministic archives, import, and integrity audit |
| Evidence | Bounded PDF/text/image import, hashing, page-aware text/OCR evidence, attachment UUID/page citations, re-index, viewer, and recoverable deletion |
| Circuit | Schema-v3 typed components/pins/nets/placements/publication metadata; 44 structural symbol kinds including an official-pinout ESP32-S3-DevKitC-1 v1.1 board; shared conventional-symbol geometry; ERC diagnostics; review-only UI; deterministic page/transparent SVG, BOM, report, and JSON exports; and approval-gated Pi changes |
| Breadboard | 30-column solderless-board model, intrinsic terminal strips and power rails, component-pin placement, jumpers, physical-short and missing-connectivity diagnostics, review-only UI, and approval-gated Pi placement/jumper proposals |
| Camera/voice | Local camera, encrypted token-scoped LAN WebSocket phone relay with QR pairing, legacy private-LAN JPEG input, opt-in “Eve”/“Hey Eve”, local multilingual Whisper STT, revision-linked camera tool capture, and tone-shaped installed local-system TTS |
| Arduino Uno | Allowlisted Arduino CLI compile plus deterministic virtual-time `simavr` execution, versioned GPIO/UART traces, explicit pin-to-net bridges, and circuit assertions |
| ESP32-S3 | Allowlisted Arduino/ESPHome compile plus bounded local Espressif QEMU `esp32s3` CPU/UART-console execution; GPIO/circuit bridging is explicitly unsupported because the pinned GPIO device is a stub |
| Other ESP32 boards | Retained in the official ESPHome reference catalog; clearly reported as not executable by this product |
| ESPHome | Pinned official catalog snapshot: 738 components and 298 ESP32 boards, search, official docs/source links, structural validation, safe native validation, compile, and artifact recording |
| Built-in ICs | Ten manufacturer-sourced pin maps and deterministic functional adapters, approval-gated Pi placement, net propagation, state/edge steps, driver-conflict diagnostics, and scenario assertions; mixed-signal models are explicitly idealized |
| Datasheet model packs | Pi-readable strict JSON contract, attachment/page provenance, explicit UI approval, hashing, monotonic revisions, preserved history, and fixed declarative runtimes for truth tables, analog curves, I²C registers, and SPI command recognition |
| Packaging | Hash-verified macOS arm64 simulator and Whisper sidecars; local `package:dir` remains ad-hoc; `package:mac` is wired for Developer ID + hardened runtime + notarize/staple when Apple credentials and a Developer ID Application certificate are present; GitHub Actions CI quality gates + macOS package smoke and tag/`workflow_dispatch` release pipelines publish DMG/ZIP artifacts; Windows/Linux sidecars and clean-Mac Gatekeeper verification remain release work |
| Storage discipline | No persistent diagnostic logs by default; app-owned logs are pruned oldest-first to an aggregate 100 MiB ceiling at startup, native output is bounded/truncated, and native source/toolchain build directories are unique temporary inputs removed on success or failure |

The authoritative step-by-step ledger is [TASKS.md](./TASKS.md). Durable contributor rules are in [AGENTS.md](./AGENTS.md).

## Product loop

1. Choose a project root and create a project.
2. Configure any provider/auth method exposed by Pi and select a model.
3. Attach requirements, schematics, PDFs, and component datasheets.
4. Ask Pi to inspect the 44-kind component catalog, create or revise the circuit, name nets, set paper metadata, or propose a clean publication layout.
5. Review the semantic diff and explicitly approve or reject it.
6. Place the logical parts and jumpers on the breadboard view.
7. Ask Pi to read, author, and compile Arduino or ESPHome firmware for Uno or ESP32-S3 through its constrained project tools.
8. Ask Pi to run the bounded local processor simulator and read its separate CPU/GPIO/UART/circuit-assertion coverage report. On Uno, optionally map observed output pins into circuit nets.
9. Use a built-in IC adapter, or ask Pi to propose a cited declarative model from an attachment and explicitly install it.
10. Start a local camera or scan the temporary LAN pairing QR. Say or type “Eve, take a look”; the camera tool saves the current frame with revision provenance and returns that image to the same Pi turn for comparison with the canonical circuit/assembly state.
11. Iterate while the project retains conversation, evidence, design revisions, firmware, captures, and model history.

## Interface

The UI has three primary regions and uses a light engineering theme adapted from [Beautiful UI](https://beautiful-ui-five.vercel.app/) (soft multi-layer shadows, hairline borders, blue accent, green/orange status semantics, and AI-native chat/approval patterns):

- A collapsible project/chat sidebar built from shadcn-style primitives.
- A full-height central conversation pane with agent-status orb, stream-style message bubbles, elevated prompt composer, attachments, Eve/push-to-talk controls, model/provider controls, and human-in-the-loop approval cards.
- A wider right laboratory column with build camera above the schematic/breadboard design surface (segmented view switch). The split and the assistant/laboratory boundary are resizable.

Firmware and processor simulation deliberately have no manual dashboard: Pi uses narrow read/compile/run tools as its engineering playground and reports their exact validation boundary in chat. Schematic and breadboard surfaces are review-only. The renderer preload exposes proposal approval/rejection but no direct circuit/assembly mutation methods; Pi stages typed circuit or breadboard proposals until the user explicitly approves them.

The schematic deliberately resembles conventional paper figures rather than generic node boxes: dark orthogonal wires, junction dots, ANSI-style resistor zigzags, capacitor plates, diode/LED arrows, transistor/gate/source/ground symbols, horizontal labels, and restrained semantic color. Onscreen and exported drawings use the same deterministic geometry engine so the paper artifact cannot silently diverge from the canonical view.

Each revision export contains:

- `schematic.svg` — A4/Letter page SVG with border and title block;
- `schematic-transparent.svg` — tightly cropped vector artwork for a paper or slide;
- `bom.csv` and `bom.md` — grouped logical BOMs with catalog identities and limitations;
- `design-report.md` — revision, structural diagnostics, and evidence boundary; and
- `circuit.json` — the canonical revision used to produce the assets.

“Publication-ready” here means deterministic, scalable figure assets with explicit revision and provenance. It does not mean a journal has accepted the paper, that component ratings/packages/footprints are complete, or that electrical behavior and physical safety have been proven.

The natural-language request “I need you to use ESP32 to create a Pomodoro timer” has an app-owned intent route. It instructs Pi to stage—never auto-apply—a conservative ESP32-S3-DevKitC-1 v1.1 reference proposal in the same turn, using two buttons, an active buzzer, a status LED/resistor, and an I²C OLED header. Global Pi slash commands and “special channels” are deliberately unavailable inside Electron because they can register general tools or spawn the packaged application as a CLI. Two consecutive live provider-backed disposable-project runs verified that the exact sentence produced a typed pending proposal with no agent errors; automated tests cover routing, transcript redaction, board geometry, and same-transaction net resolution.

Camera preview stays local and ephemeral. A user may save a frame manually. Phrases such as “take a look,” “check this with the camera,” and “does this design look correct?” are deterministically routed through the same consent-gated capture operation used by `inspect_build_camera`: one current frame is saved and attached as multimodal content to that exact Pi turn. The tool remains available for Pi-directed visual workflows. Nothing uploads continuous video. Speech/listening is project-scoped and stops on project changes, manual microphone use, assistant activity, or spoken output.

## Logistics and corrections to the initial plan

| Initial idea | Engineering issue | Product decision |
| --- | --- | --- |
| Three fixed sections | Chat, camera, schematic, breadboard, and firmware become unusably small on laptops. | Use sidebar + full-height assistant + resizable right camera-over-design layout; keep firmware/simulation out of the manual UI. |
| “One chat creates one design” | Chat is not typed, diffable, or safe as a design database. | One project links a Pi session to canonical revisioned circuit/assembly files. |
| Agent directly modifies CAD | Opaque model file edits can corrupt connectivity or hide safety changes. | Pi stages typed transactions; validation and explicit user approval apply them atomically. |
| Continuous camera feedback | Continuous multimodal upload is invasive, expensive, noisy, and difficult to audit. | Preview locally; an explicit user save or consented Pi camera-tool call captures one revision-linked frame. |
| Galaxy S23 as a camera | A phone is not automatically an Electron webcam; browser capture needs a secure origin and hostile-LAN controls. | Use an ephemeral HTTPS page, 256-bit pairing token, SHA-256 certificate fingerprint, QR code, bounded encrypted WebSocket frames, and one connected phone. Authenticated WebRTC/NAT traversal remains later work. |
| Wake word immediately | Always-on microphone, echo from TTS, wrong-session routing, privacy, and cancellation need a deliberate state machine. | Make Eve opt-in, visibly listening, fully local, paused during Pi/manual-mic/TTS activity, and cancelled on project changes. Real Galaxy/Indian-accent qualification remains outstanding. |
| Attach PDFs directly to the LLM | Large/scanned or adversarial documents overflow context and lose page provenance. | Hash, extract/OCR, page-label, retrieve bounded excerpts, and treat them as untrusted evidence. |
| “Circuit CAD” as one view | Logical schematic, physical breadboard, PCB layout, firmware, and simulation have different models/rules. | Keep a canonical logical netlist plus separate physical assembly; PCB/manufacturing is later. |
| Simulation proves correctness | Compile, CPU execution, functional IC behavior, analog physics, and a physical build are not equivalent. | Report every stage separately and expose limitations/unsupported features. |
| Generate simulator code from a datasheet | LLM-authored native/script execution is a supply-chain and sandbox escape risk. | Generate strict cited data packs executed only by four fixed host-owned declarative adapters. |
| Store under a hard-coded home path | OS permissions, cloud sync, and user expectations differ. | Use a configurable user-selected project root with atomic writes and integrity checks. |

## Pi and BYOK

“Pi” means the customizable Pi coding-agent harness, not Raspberry Pi hardware. The Electron main process embeds `@earendil-works/pi-coding-agent` and uses Pi's `ModelRuntime` as the authority for provider discovery and credentials. Consequently, the app does not maintain a competing provider-key format: API keys, OAuth subscriptions, custom providers, environment/file credentials, and local endpoints work when the installed Pi runtime supports them.

Normal design sessions disable Pi's built-in general-purpose tools. Pi receives constrained tools to:

- inspect the full structural component catalog and exact pin IDs;
- read the circuit and breadboard;
- stage typed circuit and breadboard proposals for explicit approval, including net renaming and publication metadata;
- stage a bounded deterministic grid-aligned publication layout for explicit approval;
- capture the current build-camera frame on an explicit visual request and return it as image content;
- read and author project firmware, invoke allowlisted compilers, and run bounded local simulation;
- assess Uno/ESP32-S3 simulation coverage;
- run an already-compiled Uno firmware trace against explicit circuit-net mappings and assertions;
- search the pinned ESPHome catalog;
- inspect the ten built-in IC models;
- list project model packs; and
- obtain the guarded datasheet-model contract.

## Local embedded simulation contract

There is no Wokwi or cloud-simulator integration.

The product distinguishes these claims:

1. structural source/config validation;
2. native compiler validation;
3. firmware artifact creation;
4. processor/SoC execution;
5. modeled peripherals;
6. external-part functional evaluation;
7. electrical/thermal/timing simulation; and
8. physical evidence or hardware-in-the-loop measurements.

Only the stages actually reached are reported. Uno runs use a 1,000–5,000,000 µs virtual-time window and emit a bounded `CDH_TRACE_V1` record containing output-mode pin transitions, final output states, and UART0 bytes. Explicit Uno pin-to-net mappings can feed the deterministic functional IC runner and its assertions. This still does not establish voltage, current, loading, timing margins, thermal behavior, breadboard correctness, or safety.

ESP32-S3 runs use a bounded five-second host-time QEMU process and capture console text. Source inspection of the pinned engine found that its `esp32s3` GPIO device implements strap reads but no GPIO register/pin behavior, so the product reports GPIO trace and circuit assertions as unsupported rather than fabricating events. Generic system QEMU is rejected unless `-machine help` exposes the exact `esp32s3` machine.

The product targets are deliberately limited to:

- `arduino_uno_r3` via `arduino:avr:uno` and `simavr`;
- `esp32s3` via `esp32:esp32:esp32s3` and Espressif QEMU's `esp32s3` machine.

The ESPHome catalog still includes other ESP32 boards for documentation and configuration reference. Validation returns an `unsupported_product_target` warning instead of pretending those boards can be run here.

The circuit catalog includes a typed ESP32-S3-DevKitC-1 v1.1 symbol with all 44 J1/J3 header positions from the [official Espressif header table](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html#header-block). It is a structural wiring symbol, not a board simulator: exact module/revision, 3.3 V logic, strapping pins, flash/PSRAM reservations, and the unsupported QEMU GPIO boundary remain visible limitations.

## Ten built-in IC models

There is no authoritative universal “ten most-used ICs” ranking. This project uses a documented high-utility bench set covering timing, analog conditioning, logic, I/O expansion, counting, and loads.

| Model ID | Part | Local functional boundary | Manufacturer source |
| --- | --- | --- | --- |
| `ne555` | NE555 timer | Idealized trigger/threshold/reset latch and discharge state | [TI datasheet](https://www.ti.com/lit/ds/symlink/ne555.pdf) |
| `lm358b` | LM358B dual op amp | Idealized saturated two-channel comparison | [TI datasheet](https://www.ti.com/lit/ds/symlink/lm358b.pdf) |
| `lm393` | LM393 dual comparator | Idealized open-collector low/high-impedance truth behavior | [TI datasheet](https://www.ti.com/lit/ds/symlink/lm393.pdf) |
| `sn74hc00` | SN74HC00 quad NAND | Four deterministic NAND truth tables | [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74hc00.pdf) |
| `sn74hc04` | SN74HC04 hex inverter | Six deterministic inverter truth tables | [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74hc04.pdf) |
| `sn74hc595` | SN74HC595 SIPO register | Shift, clear, latch, cascade, and output-enable state | [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74hc595.pdf) |
| `sn74hc165` | SN74HC165 PISO register | Parallel load, clock inhibit, shift, and complementary output | [TI datasheet](https://www.ti.com/lit/ds/symlink/sn74hc165.pdf) |
| `cd4017b` | CD4017B decade counter | Reset, inhibit, decoded count, and carry state | [TI datasheet](https://www.ti.com/lit/ds/symlink/cd4022b.pdf) |
| `uln2003a` | ULN2003A Darlington array | Seven inverting low-side open-collector channels | [TI datasheet](https://www.ti.com/lit/ds/symlink/uln2003a.pdf) |
| `l293d` | L293D motor driver | Enable/input/output truth behavior for four half bridges | [TI datasheet](https://www.ti.com/lit/ds/symlink/l293.pdf) |

Each has an ordered package pin map, supply metadata, deterministic adapter tests, and visible limitations. Pi can stage their placement for explicit user approval; they can then be evaluated alone or propagated across named/ID-addressed schematic nets in a bounded functional scenario. A scenario accepts manual stimuli or explicitly bridged Uno output states, one rising edge per component step, prior component state, and expected-net assertions; it detects conflicting drivers and non-convergence. The models do not claim propagation delay, parasitics, loading, power dissipation, motor mechanics, component tolerance, or physical safety.

## Datasheet-derived model packs

Project-specific components use strict schema-versioned JSON rather than generated code. A proposal contains:

- a stable lowercase model ID and monotonically increasing revision;
- Uno/S3 target applicability;
- pins and roles;
- recommended/absolute electrical limits;
- one declarative behavior kind;
- explicit limitations; and
- attachment UUID, exact page, claim, and confidence for every cited source.

Supported behavior adapters are:

- `digital_gpio`: complete 0/1 truth-table rows;
- `analog_curve`: strictly increasing points with clamped linear interpolation;
- `i2c_registers`: declared device addresses, register widths/access/reset values, and bounded state;
- `spi_commands`: declared modes, maximum clock, opcodes, directions, and optional constant response bytes.

Installation rejects extra fields, scripts, expressions, network references, missing attachments/pages, invalid pin references, duplicate registers/opcodes, unsafe ranges, and non-increasing revisions. It fingerprints the proposal and cited attachment, atomically replaces the current revision, and preserves the previous revision under `simulation/models/history/`.

These fixed adapters make the system extensible without granting an LLM executable-code authority. Their results are functional approximations, not electrical proof.

## Project format

```text
<user-selected-root>/
└── <project-slug>--<short-id>/
    ├── project.json
    ├── circuit.json
    ├── assembly.json
    ├── AGENTS.md
    ├── chat/*.jsonl
    ├── attachments/
    │   ├── originals/
    │   └── extracted/<attachment-id>/
    ├── captures/
    ├── firmware/
    │   ├── arduino/
    │   ├── esphome.yaml
    │   └── .esphome/
    ├── simulation/models/
    │   ├── <model-id>.json
    │   └── history/<model-id>/
    ├── history/
    └── exports/
```

Chat is never the circuit source of truth. `circuit.json` and `assembly.json` are typed, revisioned documents; Pi can propose transactions but cannot overwrite them as blobs. Circuit schema v3 adds title/subtitle/author/document-number/paper metadata and migrates v2 documents atomically with the original retained under `history/`.

## Important limitations

- Uno digital outputs bridge only through explicit pin-to-net mappings and final observed levels; firmware inputs, analog/PWM interpretation, continuous circuit feedback into firmware, I²C/SPI decoding, breadboard holes, and electrical loading are not bridged.
- Built-in and project component runtimes are event/functional models, not SPICE.
- ESP32-S3 QEMU peripheral coverage is partial; GPIO is a stub in the pinned engine, and Wi-Fi, Bluetooth, USB, camera, analog, and many board peripherals need hardware testing.
- Camera inspection cannot see hidden rail splits, continuity, polarity, internal damage, or actual voltage/current.
- The schematic model is not a PCB router and does not yet provide KiCad round-trip, Gerber output, footprints, or manufacturer lifecycle data.
- Common-part symbols are structural catalog entries. Except for the separately documented built-in IC/model adapters, they do not simulate component behavior or establish ratings, tolerance, package, footprint, lifecycle, or sourcing data.
- The current phone relay is private-LAN WSS with an ephemeral self-signed certificate and bearer token. It has no device identity, internet relay, NAT traversal, or WebRTC media controls; the user must compare the displayed SHA-256 fingerprint before accepting the one-session certificate warning.
- Eve wake-word and Whisper command inference are local and opt-in, but sustained wake listening currently starts a bounded Whisper process for each audio segment. Real Galaxy S23, representative Indian-accent, noisy-room, echo, and latency qualification is still required.
- Spoken replies use voices already installed and marked local by the operating system. Tone profiles shape wording, rate, and pitch; voice quality/emotional range depends on the installed voice and has not been qualified across hosts.
- The checked-in simulator bundle is macOS arm64 only; other release hosts need reproducible sidecars.

## Storage and log budget

Large simulator source trees and compiler toolchains are build inputs, not logs. The simulator and voice build scripts create uniquely named system-temporary directories and remove them in a `finally` block on success or failure. Only the small, hash-manifested runtime closure remains under `simulator/dist` and `voice/dist`.

Circuit Design Harness does not persist diagnostic logs by default. Startup retention prunes the dedicated operating-system log directory oldest-first until its total is at most 100 MiB; symlinks are ignored. Electron's LevelDB `*.log` files are application state, not diagnostics, and are deliberately excluded from deletion. Compiler, parser, Whisper, and simulator output is bounded in memory and only a short result is returned to the project conversation. Product QEMU commands reject `-D` and file-backed serial/chardev/trace output, run for a bounded duration, and use `SIGKILL` on timeout so a simulator cannot keep writing a deleted file. `bun run storage:check` independently fails when known application-owned diagnostic logs exceed the same limit.

## Security and safety boundaries

- `nodeIntegration` is disabled; context isolation and renderer sandboxing are enabled.
- Renderer IPC is narrow, sender-validated, and schema-validated.
- Normal Pi sessions receive no shell, arbitrary filesystem, or arbitrary network tools.
- Attachments and model output are untrusted evidence, never instructions.
- Camera capture is local-first; phone frames use encrypted WSS, a fresh 256-bit session-scoped token, one-client replacement, a 12 MiB frame cap, and an ephemeral certificate with a displayed SHA-256 fingerprint. Microphone wake listening is off by default and visibly user-enabled.
- Local STT resolves only a complete host-specific Whisper bundle whose executable and model match the recorded sizes and SHA-256 hashes.
- Packaged simulator executables are resolved from a host-specific SHA-256 manifest; production has no `PATH` fallback.
- Remote camera compatibility accepts only bounded JPEG responses from literal private/loopback addresses and follows no redirects.
- Hazardous mains, high-current, lithium charging, medical, automotive-safety, or RF-power work requires qualified human review and proper test equipment.

## Development

Requirements: Bun 1.2+, Node 22.19+, and macOS for the currently checked-in native sidecars. Native compile commands report `not_available` when Arduino CLI or ESPHome is absent in development.

```bash
bun install
bun run dev
```

Quality gates:

```bash
bun run check
bun run typecheck
bun run test
bun run build
bun run test:e2e
bun run quality
```

Local sidecars are pinned in `simulator/sources.json` and rebuilt with:

```bash
bun run simulators:build
```

Local multilingual speech recognition is pinned in `voice/sources.json` and rebuilt with:

```bash
bun run voice:build
```

The build is intentionally active only for `simavr`, the GPL-compatible `circuit-simavr-trace` sidecar linked to that pinned source, and the Espressif Xtensa QEMU binary containing `esp32s3`. Archived ESP32-S2 experiment scripts are not invoked by the product build.

### macOS packaging and notarization

Local smoke packaging stays ad-hoc and does not contact Apple:

```bash
bun run package:dir
```

Distribution packaging signs with **Developer ID Application**, enables hardened runtime, submits to Apple notarization via `notarytool`, and staples the ticket when credentials are available:

```bash
bun run package:mac
```

Artifacts land in `release/` (`dmg` and `zip`). Prerequisites on this machine:

1. Paid [Apple Developer Program](https://developer.apple.com/programs/) membership.
2. A **Developer ID Application** certificate installed in the login keychain (`security find-identity -v -p codesigning` must list it). Create it in [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/certificates/list) if missing, or export/import a `.p12` and set `CSC_LINK` / `CSC_KEY_PASSWORD`.
3. One notarization auth method (prefer App Store Connect API key):

| Method | Environment variables |
| --- | --- |
| App Store Connect API key (recommended) | `APPLE_API_KEY` (path to `AuthKey_….p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Apple ID + app-specific password | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| Keychain profile from `notarytool store-credentials` | `APPLE_KEYCHAIN_PROFILE` (optional `APPLE_KEYCHAIN`) |

Optional: `CSC_NAME="Developer ID Application: Your Name (TEAMID)"` if multiple identities exist. `MAC_RELEASE_SIGN=1` is set by `package:mac` so the after-pack hook does not replace the Developer ID signature with ad-hoc signing.

Verify after a successful run:

```bash
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Circuit Design Harness.app"
spctl --assess --type execute --verbose "release/mac-arm64/Circuit Design Harness.app"
xcrun stapler validate "release/mac-arm64/Circuit Design Harness.app"
```

Gatekeeper acceptance on a clean Mac (download the DMG, open without right-click bypass) remains a manual release check.

### GitHub Actions pipelines

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) | Push/PR to `main`/`master` | `check`, `typecheck`, `test`, `storage:check`, `build` on Ubuntu; ad-hoc `package:dir` smoke on macOS 14 arm64 |
| [`.github/workflows/release.yml`](./.github/workflows/release.yml) | Tag `v*` or manual `workflow_dispatch` | Runs `quality`, packages macOS arm64 DMG/ZIP, uploads artifacts, and creates a GitHub Release |

Release signing/notarization is optional and only runs when Apple secrets are present (and, for manual runs, when **signed** is enabled):

| Secret | Purpose |
| --- | --- |
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12` |
| `CSC_NAME` | Optional identity string when multiple certificates exist |
| `APPLE_API_KEY` | App Store Connect API key PEM (raw or base64) |
| `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` | API key metadata |
| or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` | Alternative notary auth |

Without those secrets the release job still publishes **ad-hoc** DMG/ZIP artifacts suitable for CI smoke—not Gatekeeper distribution.

```bash
# Tag a release (pushes the v* tag workflow)
git tag v0.1.0
git push origin v0.1.0
```

## Architecture decisions

- [0001 — Product scope](./docs/decisions/0001-product-scope.md)
- [0002 — Pi runtime](./docs/decisions/0002-pi-runtime.md)
- [0003 — Circuit model](./docs/decisions/0003-circuit-model.md)
- [0004 — Electron process model](./docs/decisions/0004-electron-processes.md)
- [0005 — Voice input](./docs/decisions/0005-voice-input.md)
- [0006 — Private-LAN camera](./docs/decisions/0006-private-lan-camera.md)
- [0007 — Local embedded simulation](./docs/decisions/0007-local-embedded-simulation.md)
- [0008 — Guarded component model packs](./docs/decisions/0008-component-model-packs.md)
- [0009 — AI-first workbench](./docs/decisions/0009-ai-first-workbench.md)
- [0010 — Publication schematic](./docs/decisions/0010-publication-schematic.md)
