---
name: lab-coach-firmware
description: Mode A golden firmware and arduino-cli workflow for Circuit Design Harness. Use when the user is in a lab lesson, asks for code/sketch/compile/upload, or wants to ignore coding and focus on wiring.
---

# Lab coach firmware skill

## Goal

Keep the learner on **electrical wiring**. Use **hand-authored golden sketches** and **arduino-cli** compile via harness tools—do not invent lesson firmware.

## Tools (in order)

1. `get_lab_coach_status` — confirm active lesson
2. `get_lab_lesson_firmware` — show golden source + successCheck
3. `apply_lab_lesson_firmware` — save + compile (default)
4. Only if no golden sketch exists: `compile_arduino_firmware` with explicit user intent

## Never

- Invent alternate GPIO/pin numbers for a covered lesson
- Treat compile/sim as electrical or safety proof
- Send the learner into freeform CAD for a kit lesson match

## arduino-cli requirement

Product FQBNs:

- Uno: `arduino:avr:uno`
- ESP32-S3: `esp32:esp32:esp32s3`

Setup (host):

```bash
bash scripts/setup-arduino-cli.sh
```

Docs: `docs/lab-coach-arduino-cli.md`  
Upstream: https://github.com/arduino/arduino-cli

If compile outcome is `not_available`, report that clearly and point at the setup script + app restart for PATH.

## After compile

Explain the physical **successCheck** (LED blinks, serial values, beep). If behavior is wrong, debug **wiring/power/polarity/common ground**—not the golden pin map.
