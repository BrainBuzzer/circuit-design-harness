import type { EmbeddedTargetId } from "./embedded";
import { getStarterLessonById } from "./lesson-fixtures";

/**
 * Hand-authored golden Arduino sketches for Mode A lessons.
 * Learners should not write this code; the coach applies it after wiring.
 * Keep sketches self-contained (no third-party libraries) so arduino-cli
 * needs only the board core.
 */

export interface LessonFirmware {
  readonly lessonId: string;
  readonly targetId: EmbeddedTargetId;
  readonly title: string;
  readonly description: string;
  readonly source: string;
  /** What the learner should observe electrically / physically after upload. */
  readonly successCheck: string;
  readonly limitations: readonly string[];
}

const UNO_LED: LessonFirmware = {
  lessonId: "uno-led-series-resistor",
  targetId: "arduino_uno_r3",
  title: "Uno LED blink on D13",
  description:
    "Blinks digital pin 13 so a series LED on D13↔GND can pulse. Matches the Uno LED lesson pin map.",
  successCheck: "External LED (and often the onboard L LED) blinks about once per second.",
  limitations: [
    "Does not measure LED current or resistor value.",
    "Onboard L LED on many Unos also uses D13.",
  ],
  source: `// Golden sketch: uno-led-series-resistor
// Circuit Design Harness lab coach — do not invent alternate pins for this lesson.
// Wiring: D13 -> 330 ohm -> LED anode; LED cathode -> GND

const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`,
};

const UNO_BUTTON: LessonFirmware = {
  lessonId: "uno-pushbutton-input",
  targetId: "arduino_uno_r3",
  title: "Uno button on D2 with pull-up",
  description:
    "Reads a button from D2 to GND with INPUT_PULLUP and lights the onboard/D13 LED while pressed.",
  successCheck: "Pressing the button lights the LED on pin 13; releasing turns it off.",
  limitations: [
    "Software debounce is minimal; contact bounce may flicker briefly.",
    "Does not validate external pull-up/pull-down wiring variants.",
  ],
  source: `// Golden sketch: uno-pushbutton-input
// Wiring: D2 -- button -- GND; optional LED on D13 as in the LED lesson

const int BUTTON_PIN = 2;
const int LED_PIN = 13;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // INPUT_PULLUP: pressed reads LOW
  int pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
}
`,
};

const UNO_POT: LessonFirmware = {
  lessonId: "uno-potentiometer-analog",
  targetId: "arduino_uno_r3",
  title: "Uno potentiometer on A0",
  description:
    "Reads A0 and prints raw ADC counts over Serial. Optional: maps value to D13 brightness via PWM-ish blink rate.",
  successCheck:
    "Open Serial Monitor at 9600 baud; turning the pot changes the printed 0..1023 values smoothly.",
  limitations: [
    "Does not calibrate absolute volts.",
    "Serial output requires the USB serial monitor; physical wiring success is separate from serial text.",
  ],
  source: `// Golden sketch: uno-potentiometer-analog
// Wiring: pot outer pins to 5V and GND; wiper to A0

const int POT_PIN = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(POT_PIN);
  Serial.println(value);
  delay(100);
}
`,
};

const ESP_LED: LessonFirmware = {
  lessonId: "esp32s3-led-series-resistor",
  targetId: "esp32s3",
  title: "ESP32-S3 LED blink on GPIO4",
  description: "Blinks GPIO4 for the ESP32-S3 external LED + series resistor lesson.",
  successCheck: "External LED on GPIO4 blinks about once per second.",
  limitations: [
    "Confirm silk label '4' on your DevKit revision.",
    "QEMU GPIO is unsupported; physical LED is the success check.",
  ],
  source: `// Golden sketch: esp32s3-led-series-resistor
// Wiring: GPIO4 -> 330 ohm -> LED anode; LED cathode -> GND
// Board: ESP32-S3 DevKit class (Arduino-ESP32 core)

const int LED_PIN = 4;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`,
};

const ESP_BUZZER: LessonFirmware = {
  lessonId: "esp32s3-button-active-buzzer",
  targetId: "esp32s3",
  title: "ESP32-S3 button GPIO5 and active buzzer GPIO6",
  description:
    "While the button on GPIO5 is held to GND, drives GPIO6 high for an active buzzer (or module signal pin).",
  successCheck: "Press button → buzzer sounds (if active 3.3/5 V-class module). Release → silence.",
  limitations: [
    "12 V buzzers need a driver; this sketch only toggles a GPIO.",
    "Passive buzzers need tone/PWM and will not beep on steady HIGH.",
  ],
  source: `// Golden sketch: esp32s3-button-active-buzzer
// Wiring: GPIO5 -- button -- GND; GPIO6 -> active buzzer signal; shared GND
// Optional module VCC -> 3V3

const int BUTTON_PIN = 5;
const int BUZZER_PIN = 6;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
}

void loop() {
  int pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(BUZZER_PIN, pressed ? HIGH : LOW);
}
`,
};

const ESP_SONAR: LessonFirmware = {
  lessonId: "esp32s3-hcsr04-ultrasonic",
  targetId: "esp32s3",
  title: "ESP32-S3 HC-SR04 distance on Serial",
  description:
    "Triggers GPIO7, measures echo on GPIO15, prints estimated distance in cm. Assumes echo is 3.3 V safe (divider if module is 5 V).",
  successCheck:
    "Serial at 115200 shows changing distance_cm when you move a flat object in front of the sensors.",
  limitations: [
    "5 V echo without a divider can damage the ESP32 — wiring is the learner's electrical responsibility.",
    "Clone modules vary; readings are approximate teaching values only.",
  ],
  source: `// Golden sketch: esp32s3-hcsr04-ultrasonic
// Wiring: TRIG=GPIO7, ECHO=GPIO15 (level-safe), VCC/GND per module
// Use a resistor divider on ECHO if the module drives 5 V

const int TRIG_PIN = 7;
const int ECHO_PIN = 15;

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);
  delay(50);
}

void loop() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (duration == 0) {
    Serial.println("timeout");
  } else {
    // Approximate: microseconds / 58 ≈ cm (speed of sound teaching constant)
    float cm = duration / 58.0;
    Serial.print("distance_cm=");
    Serial.println(cm, 1);
  }
  delay(200);
}
`,
};

export const LESSON_FIRMWARE: readonly LessonFirmware[] = [
  UNO_LED,
  UNO_BUTTON,
  UNO_POT,
  ESP_LED,
  ESP_BUZZER,
  ESP_SONAR,
];

export function getLessonFirmware(lessonId: string): LessonFirmware | undefined {
  return LESSON_FIRMWARE.find((entry) => entry.lessonId === lessonId);
}

export function requireLessonFirmware(lessonId: string): LessonFirmware {
  const firmware = getLessonFirmware(lessonId);
  if (!firmware) {
    throw new Error(`No golden firmware for lesson: ${lessonId}`);
  }
  const lesson = getStarterLessonById(lessonId);
  if (lesson && lesson.board !== firmware.targetId) {
    throw new Error(
      `Firmware target ${firmware.targetId} does not match lesson board ${lesson.board}.`,
    );
  }
  return firmware;
}

export function listLessonFirmwareSummaries(): readonly {
  lessonId: string;
  targetId: EmbeddedTargetId;
  title: string;
  description: string;
}[] {
  return LESSON_FIRMWARE.map((entry) => ({
    lessonId: entry.lessonId,
    targetId: entry.targetId,
    title: entry.title,
    description: entry.description,
  }));
}

/** FQBN strings used by arduino-cli for product targets. */
export const ARDUINO_CLI_FQBN: Readonly<Record<EmbeddedTargetId, string>> = {
  arduino_uno_r3: "arduino:avr:uno",
  esp32s3: "esp32:esp32:esp32s3",
};

export const ARDUINO_CLI_REQUIRED_CORES = [
  { id: "arduino:avr", purpose: "Arduino Uno R3 (ATmega328P)" },
  { id: "esp32:esp32", purpose: "ESP32-S3 (Arduino-ESP32 core; needs Espressif index)" },
] as const;

export const ESP32_BOARD_MANAGER_URL =
  "https://espressif.github.io/arduino-esp32/package_esp32_index.json";
