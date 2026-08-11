# ADR 0007: Embedded simulation is local, bundled, and limited to Uno/S3

- Status: accepted
- Date: 2026-08-09

## Context

The harness must not upload firmware, circuit state, or simulator state to a cloud simulator. “Simulation support” can mean source validation, compilation, processor execution, peripheral emulation, external-part behavior, electrical physics, or hardware measurement; collapsing these stages creates unsafe claims.

An earlier implementation pursued wider ESP32-family coverage and an experimental ESP32-S2 model. Product scope was later corrected: only ESP32-S3 is required from the ESP32 family.

## Decision

1. Executable product targets are Arduino Uno R3 and ESP32-S3.
2. Uno uses local `simavr`; ESP32-S3 uses Espressif QEMU only when `-machine help` contains the exact `esp32s3` model.
3. Other ESP32 boards remain searchable in the pinned ESPHome catalog but receive an explicit `unsupported_product_target` warning and no simulation assessment.
4. There is no Wokwi/cloud/remote execution fallback.
5. Release artifacts bundle host-specific simulator executables, runtime libraries, license texts, and a SHA-256 manifest. Packaged resolution has no PATH fallback.
6. Structural validation, compiler results, artifact creation, processor execution, modeled peripherals, component behavior, electrical physics, and hardware evidence remain separate report stages.
7. A bounded processor run may be `executed`; it does not prove the firmware's connected peripherals, circuit, breadboard, or physical build works.
8. The active simulator build no longer imports the experimental ESP32-S2 model and no longer builds/probes RISC-V QEMU. The obsolete S2 import/verification scripts were permanently removed so they cannot become an accidental product path.
9. Uno runs use a harness-owned sidecar linked to the pinned simavr library. It stops on bounded virtual processor cycles and emits `CDH_TRACE_V1` with output-mode GPIO transitions/final levels, UART0 bytes, termination, and truncation flags.
10. Explicit Uno output-pin mappings may become circuit scenario stimuli. This is one-way functional propagation of final levels, not electrical or bidirectional co-simulation.
11. The pinned ESP32-S3 QEMU GPIO implementation is a strap-read stub. S3 GPIO tracing and circuit bridging remain explicitly unsupported; console capture is not promoted to a structured UART trace.
12. QEMU diagnostic, trace, serial, and chardev output may not target files. Console output is captured through bounded stdout/stderr only, each run has a host timeout, and timeout termination uses `SIGKILL`.

## Implemented boundary

- Pinned simavr commit `c7a701bd7a892efb1163d4384e5ce72208f359a6`.
- Pinned Espressif QEMU commit `febae182e132e4055529be423a818225ebddaa3a`.
- Allowlisted Arduino FQBNs `arduino:avr:uno` and `esp32:esp32:esp32s3`.
- Bounded no-shell compile and run commands.
- A 2 MiB process-output buffer, short displayed-result truncation, rejection of file-backed QEMU output, and forced timeout termination.
- Exact QEMU machine probe and generic-QEMU rejection.
- Hash-verified macOS arm64 bundle with relative loader paths and license closure.
- UI/Pi capability assessment that reports partial features and unsupported peripherals.
- Exact Uno header/ATmega328P port mapping, bounded signal runner, known-pass D13 fixture, trace parser, UI/Pi bridge controls, and circuit assertions.
- Separate result fields for CPU execution, GPIO trace, UART trace, and circuit assertions.

## Consequences

- Scope and release size are tractable, but the product intentionally does not execute classic ESP32/C2/C3/C5/C6/C61/H2/P4/S2 firmware.
- ESP32-S3 QEMU is a partial SoC emulator; its GPIO is unimplemented beyond strap reads, and Wi-Fi, Bluetooth, USB, camera, analog, and many peripherals still require explicit unsupported feedback or hardware tests.
- Uno firmware output GPIO can drive an explicit final-state circuit scenario. Firmware inputs, event-by-event feedback, decoded buses, analog/loading physics, breadboard state, and S3 GPIO remain outside that boundary.
- Windows/Linux sidecars and signed/notarized distribution remain separate release work.
