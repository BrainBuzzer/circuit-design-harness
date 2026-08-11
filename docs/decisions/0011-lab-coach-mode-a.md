# ADR 0011: Mode A lab coach as the beginner default

Status: accepted and implemented on 2026-08-11

## Decision

Ship **Mode A — lab coach** as the default beginner product path for Arduino Uno R3 and ESP32-S3 starter-kit builds. Learners select or match a **hand-authored golden lesson**, follow ordered physical steps, and use the build camera against that step’s checklist—not against an AI-invented schematic.

Keep **Mode B — sandbox CAD** (typed `circuit.json` / `assembly.json` proposals, publication SVG, freeform invent routes such as ESP32 Pomodoro) available but secondary. Do not delete the CAD stack.

## Why

- Open-ended schematic invention is a poor teacher for complete beginners: wrong ground truth poisons camera “checks” and approval diffs are not reviewable by novices.
- Starter kits need fixed pin maps, parts allowlists, common-mistake lists, and step-bound camera checklists.
- Camera evidence remains **visible-only**; coach value is golden references + teaching, not electrical or safety proof.

## Implemented boundary

- Zod-validated lesson schema and six shipped fixtures covering both boards (LED+resistor, pushbutton, potentiometer, button+active buzzer, HC-SR04).
- Per-project `coach.json` progress (lesson id + step index) with start/advance/go-to/clear.
- Agent tools: `list_lab_lessons`, `get_lab_lesson`, `start_lab_lesson`, `get_lab_coach_status`, `advance_lab_lesson_step`, `explain_lab_step`.
- Request routing prefers Mode A when a lesson is active or a beginner prompt matches a lesson; demotes freeform propose for those paths; Pomodoro remains advanced sandbox when no lesson is active.
- `inspect_build_camera` and visual-request injection attach active step context when present.
- Workbench **Lab coach** design tab is the default laboratory view.
- Golden Arduino sketches per lesson (`lesson-firmware.ts`); apply/compile via coach tools and UI using allowlisted `arduino-cli` (host install via `scripts/setup-arduino-cli.sh`). Learners are not expected to author code for covered lessons.

## Explicit non-claims

Coach guidance and camera checklists do not prove hidden connectivity, continuity, voltage, current, polarity, or safety. Firmware/sim stages remain separate claim levels. Lessons are not SPICE models or manufacturer certification.
