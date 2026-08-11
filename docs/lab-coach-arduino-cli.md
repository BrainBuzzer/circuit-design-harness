# Lab coach + Arduino CLI setup

Mode A teaches **wiring**. Golden sketches and [arduino-cli](https://github.com/arduino/arduino-cli) handle **code compile** so you can focus on electrical engineering.

## What the harness already does

| Step | Who |
| --- | --- |
| Golden pin map + build steps | Lab coach lessons |
| Golden `.ino` sketch per lesson | `src/domain/lesson-firmware.ts` |
| Save sketch under `firmware/arduino/CircuitHarness/` | `apply_lab_lesson_firmware` / compile tools |
| Compile with allowlisted `arduino-cli` | Firmware service (no shell) |
| Upload to board | **You** (USB + IDE/cli upload) or future product work |
| Camera check of wires | Lab coach step checklist |

The app does **not** invent lesson firmware when a golden sketch exists. Prefer `apply_lab_lesson_firmware` over freeform `compile_arduino_firmware` during a lesson.

## Install once (macOS)

From the repo root:

```bash
bash scripts/setup-arduino-cli.sh
```

This installs:

1. [arduino-cli](https://github.com/arduino/arduino-cli) (Homebrew or official script)
2. Core `arduino:avr` → FQBN `arduino:avr:uno`
3. Core `esp32:esp32` (Espressif index) → FQBN `esp32:esp32:esp32s3`

Manual alternative:

```bash
brew install arduino-cli
arduino-cli config init
arduino-cli config add board_manager.additional_urls \
  https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index
arduino-cli core install arduino:avr
arduino-cli core install esp32:esp32
arduino-cli version
arduino-cli core list
```

Restart the Electron app so it inherits `PATH` (GUI apps on macOS may not see Homebrew until restarted from a shell or via `launchctl`).

## Learner workflow (no coding required)

1. Lab coach → start a lesson (e.g. Uno LED).
2. Wire only the current step; camera-check the step.
3. When wiring for the lesson is complete:
   - Ask: **“Load the golden sketch and compile for this lesson.”**
   - Or use the Lab coach **Load golden sketch** / **Compile** actions.
4. Upload with Arduino IDE or:

   ```bash
   arduino-cli upload -p /dev/cu.usbmodem* --fqbn arduino:avr:uno \
     path/to/project/firmware/arduino/CircuitHarness
   ```

5. Observe the **success check** in the lesson firmware (blink, serial numbers, beep). If code is known-good and behavior is wrong, debug **wiring/power/polarity**—that is the EE lesson.

## Agent tools (Mode A)

| Tool | Role |
| --- | --- |
| `get_lab_lesson_firmware` | Show golden source + success check |
| `apply_lab_lesson_firmware` | Write golden sketch; optional compile via arduino-cli |
| `compile_arduino_firmware` | Advanced: custom source (demoted during lessons) |
| `read_project_firmware` | Inspect saved sketch |

## Claim boundary

- Compile success ≠ circuit correct ≠ safe build.
- Golden sketches match lesson pin maps only.
- 12 V buzzers, 5 V echo into ESP32, and motor loads still need electrical judgment.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `Arduino CLI is not installed` | `which arduino-cli`; re-run setup script; restart app |
| Uno compile fails | `arduino-cli core list` includes `arduino:avr` |
| ESP32-S3 compile fails | Espressif index URL + `esp32:esp32` core installed |
| Upload port missing | Cable, drivers, correct `/dev/cu.*` port |
| LED dark after good compile | Polarity, series R, pin number vs silk, GND common |
