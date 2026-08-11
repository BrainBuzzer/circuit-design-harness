import { type Lesson, parseLesson, validateLessonCatalog } from "./lesson";

/**
 * Hand-authored starter-kit lessons. These are the golden source of truth for Mode A.
 * Do not generate lessons from the LLM at runtime.
 */

const UNO_LED: Lesson = parseLesson({
  schemaVersion: 1,
  id: "uno-led-series-resistor",
  title: "Uno: LED with series resistor",
  summary:
    "Wire a single LED and 330 Ω resistor on an Arduino Uno so digital pin 13 can light the LED safely.",
  board: "arduino_uno_r3",
  difficulty: "starter",
  learningGoals: [
    "An LED needs a series resistor to limit current.",
    "LED polarity: long leg is anode (+), short leg is cathode (−).",
    "Uno pin 13 and GND form a simple digital output loop.",
  ],
  parts: [
    { id: "uno", name: "Arduino Uno R3", quantity: 1 },
    { id: "led", name: "5 mm LED (any color)", quantity: 1 },
    {
      id: "r330",
      name: "330 Ω resistor",
      quantity: 1,
      notes: "Orange-orange-brown common band code",
    },
    { id: "jumper", name: "Male-male jumper wires", quantity: 2 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    {
      signal: "LED_ANODE_VIA_RESISTOR",
      boardPin: "D13",
      notes: "Resistor between D13 and LED anode",
    },
    { signal: "LED_CATHODE", boardPin: "GND", notes: "Short LED leg to ground rail" },
  ],
  breadboardIntent:
    "Place LED across a breadboard trench. Series 330 Ω from Uno D13 to LED anode (long leg). LED cathode (short leg) to GND rail tied to Uno GND.",
  commonMistakes: [
    "LED inserted backwards (no light, usually not destroyed at 5 V with 330 Ω).",
    "Missing series resistor (risk of overcurrent on the LED).",
    "Cathode connected to 5 V instead of GND.",
    "Using pin 13 in wiring but a different pin in firmware.",
  ],
  limitations: [
    "This lesson is a structural wiring guide, not electrical proof of safe current for every LED rating.",
    "Camera checks only see surface layout; they cannot prove continuity or polarity under the board.",
    "Built-in Uno L LED on D13 may also light; that is expected.",
  ],
  firmwareHint:
    "Arduino blink sketch on pin 13: pinMode(13, OUTPUT); digitalWrite(13, HIGH/LOW) with delay.",
  keywords: ["led", "blink", "resistor", "uno", "arduino", "series resistor", "light", "diode"],
  steps: [
    {
      id: "power-gnd",
      title: "Ground rail",
      instruction:
        "Connect a jumper from Uno GND to the blue/black ground rail on the breadboard. Leave 5 V unconnected for this lesson.",
      why: "The LED cathode returns current to ground. One solid GND rail keeps later steps simple.",
      referenceSummary: "Uno GND → breadboard ground rail only.",
      cameraChecklist: [
        "A wire is visible from a Uno GND pin to the breadboard ground rail",
        "No extra wire from 5 V is required for this step",
      ],
      completionHint: "Ground rail is ready when one jumper reaches a marked GND pin.",
    },
    {
      id: "place-led",
      title: "Place the LED",
      instruction:
        "Insert the LED across the center trench. Long leg (anode) on one side, short leg (cathode) on the other. Note which row is the anode.",
      why: "LEDs only conduct one way. Anode faces the positive drive path through the resistor.",
      referenceSummary: "LED long leg = anode; short leg = cathode toward ground side.",
      cameraChecklist: [
        "One LED is seated on the breadboard",
        "Legs straddle the center trench or sit in two clear rows",
      ],
    },
    {
      id: "series-resistor",
      title: "Add 330 Ω series resistor",
      instruction:
        "Place the 330 Ω resistor from an empty hole in the anode row to a free row that will receive the D13 jumper. One resistor end must share the anode row with the long LED leg.",
      why: "The resistor limits current so the LED and pin stay within beginner-safe ranges for this kit pattern.",
      referenceSummary: "D13 → 330 Ω → LED anode; cathode still free for GND.",
      cameraChecklist: [
        "A resistor is visible with one end in the LED anode row",
        "The other resistor end is free for a jumper to D13",
      ],
    },
    {
      id: "cathode-gnd",
      title: "Cathode to ground",
      instruction:
        "Jumper the LED short leg (cathode) row to the ground rail that already ties to Uno GND.",
      why: "Completes the circuit so current can return to the board ground.",
      referenceSummary: "LED cathode → GND rail → Uno GND.",
      cameraChecklist: [
        "A jumper runs from the short LED leg row to the ground rail",
        "Ground rail still has the Uno GND connection",
      ],
    },
    {
      id: "d13-drive",
      title: "Drive from D13",
      instruction:
        "Jumper Uno digital pin 13 to the free end of the 330 Ω resistor (not directly to the LED cathode).",
      why: "Pin 13 sources current through the resistor into the LED anode when firmware drives it high.",
      referenceSummary: "Uno D13 → resistor free end; path D13–R–LED–GND.",
      cameraChecklist: [
        "A jumper is visible from the header labeled 13 to the resistor free end",
        "No direct short from pin 13 to GND without the LED path",
      ],
      completionHint:
        "Load a blink sketch on pin 13; LED should pulse. If not, re-check polarity and resistor series path.",
    },
  ],
});

const UNO_BUTTON: Lesson = parseLesson({
  schemaVersion: 1,
  id: "uno-pushbutton-input",
  title: "Uno: pushbutton input",
  summary:
    "Wire a momentary pushbutton from Uno digital pin 2 to GND and read it with the internal pull-up.",
  board: "arduino_uno_r3",
  difficulty: "starter",
  learningGoals: [
    "A button is a switch between two points, not a power source.",
    "INPUT_PULLUP means the pin reads HIGH when open and LOW when closed to GND.",
    "No external resistor is required when using the internal pull-up for this pattern.",
  ],
  parts: [
    { id: "uno", name: "Arduino Uno R3", quantity: 1 },
    { id: "button", name: "Tactile pushbutton (4-pin or 2-pin)", quantity: 1 },
    { id: "jumper", name: "Male-male jumper wires", quantity: 2 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    { signal: "BUTTON_SENSE", boardPin: "D2", notes: "Digital input with INPUT_PULLUP" },
    { signal: "BUTTON_TO_GND", boardPin: "GND", notes: "Other button side to ground" },
  ],
  breadboardIntent:
    "Seat the pushbutton across the trench. One side to Uno D2, opposite switched side to GND. Firmware uses pinMode(2, INPUT_PULLUP); pressed reads LOW.",
  commonMistakes: [
    "Wiring the button to 5 V instead of GND while using INPUT_PULLUP.",
    "Reading the wrong diagonal pair on a 4-pin tactile switch.",
    "Forgetting INPUT_PULLUP so the pin floats and chatters.",
  ],
  limitations: [
    "Does not teach external pull-down or hardware debouncing RC networks.",
    "Camera cannot prove which switch pins are internally connected.",
  ],
  firmwareHint: "pinMode(2, INPUT_PULLUP); buttonPressed = digitalRead(2) == LOW;",
  keywords: ["button", "pushbutton", "switch", "input", "pullup", "uno", "arduino", "press"],
  steps: [
    {
      id: "gnd-rail",
      title: "Ground reference",
      instruction: "Jumper Uno GND to the breadboard ground rail.",
      why: "The button will short the sense pin to this ground when pressed.",
      referenceSummary: "Uno GND → ground rail.",
      cameraChecklist: ["Wire from Uno GND to breadboard ground rail is visible"],
    },
    {
      id: "seat-button",
      title: "Seat the button",
      instruction:
        "Press the tactile button into the breadboard across the center trench so each side lands on a separate row pair.",
      why: "Four-pin buttons usually bridge two pins per side; spanning the trench matches common kit layouts.",
      referenceSummary: "Button straddles the trench; two electrical sides.",
      cameraChecklist: ["A pushbutton is seated across the center of the breadboard"],
    },
    {
      id: "sense-d2",
      title: "Sense wire to D2",
      instruction: "Jumper one button side to Uno digital pin 2.",
      why: "Pin 2 is the digital input the firmware will read.",
      referenceSummary: "Button side A → Uno D2.",
      cameraChecklist: ["Jumper from button to the header pin labeled 2"],
    },
    {
      id: "button-gnd",
      title: "Other side to GND",
      instruction: "Jumper the opposite button side to the ground rail.",
      why: "Pressing the button connects D2 to GND so INPUT_PULLUP reads LOW.",
      referenceSummary: "Button side B → GND rail → Uno GND.",
      cameraChecklist: [
        "Second jumper from the button to the ground rail",
        "No wire from the button to the 5 V rail for this lesson",
      ],
      completionHint: "Sketch should print or light when the pin reads LOW while pressed.",
    },
  ],
});

const UNO_POT: Lesson = parseLesson({
  schemaVersion: 1,
  id: "uno-potentiometer-analog",
  title: "Uno: potentiometer to A0",
  summary:
    "Wire a three-pin potentiometer as a voltage divider into Uno analog pin A0 for a readable 0–1023 value.",
  board: "arduino_uno_r3",
  difficulty: "starter",
  learningGoals: [
    "A potentiometer is a variable voltage divider.",
    "Outer pins go to 5 V and GND; the wiper (center) is the signal.",
    "Analog pins measure voltage, not resistance directly.",
  ],
  parts: [
    { id: "uno", name: "Arduino Uno R3", quantity: 1 },
    { id: "pot", name: "10 kΩ potentiometer (trim or panel)", quantity: 1 },
    { id: "jumper", name: "Male-male jumper wires", quantity: 3 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    { signal: "POT_VCC", boardPin: "5V", notes: "One outer pot pin" },
    { signal: "POT_GND", boardPin: "GND", notes: "Other outer pot pin" },
    { signal: "POT_WIPER", boardPin: "A0", notes: "Center wiper pin" },
  ],
  breadboardIntent:
    "Pot outer legs to 5 V and GND rails powered from Uno. Center wiper to A0. analogRead(A0) sweeps with rotation.",
  commonMistakes: [
    "Swapping wiper and an outer pin so the reading barely changes.",
    "Leaving 5 V or GND disconnected so the wiper floats.",
    "Using 3.3 V logic assumptions on a 5 V Uno analog reference without knowing AREF.",
  ],
  limitations: [
    "Does not calibrate absolute voltage; raw ADC counts depend on Vcc.",
    "Camera cannot read the pot value or prove which pin is the wiper without markings.",
  ],
  firmwareHint: "int value = analogRead(A0); // 0..1023 on classic Uno",
  keywords: [
    "potentiometer",
    "pot",
    "analog",
    "a0",
    "voltage divider",
    "uno",
    "arduino",
    "knob",
    "ldr",
  ],
  steps: [
    {
      id: "power-rails",
      title: "Power the rails",
      instruction:
        "Jumper Uno 5 V to the red power rail and Uno GND to the blue/black ground rail.",
      why: "The pot needs a stable top and bottom voltage to divide.",
      referenceSummary: "Uno 5V → + rail; Uno GND → − rail.",
      cameraChecklist: ["Wire from 5 V to the red rail", "Wire from GND to the ground rail"],
    },
    {
      id: "seat-pot",
      title: "Seat the potentiometer",
      instruction: "Place the three-pin pot on the breadboard so each pin has its own row.",
      why: "Each pin must be independently jumpered.",
      referenceSummary: "Three pot pins in three distinct rows.",
      cameraChecklist: ["Potentiometer body is visible with three pins engaged"],
    },
    {
      id: "outer-power",
      title: "Outer pins to 5 V and GND",
      instruction: "Connect one outer pin to the 5 V rail and the other outer pin to GND.",
      why: "Creates the full voltage across the resistive track.",
      referenceSummary: "Outer pins: 5 V and GND (order sets which way the knob increases).",
      cameraChecklist: [
        "One outer pin jumpered to the red rail",
        "Other outer pin jumpered to the ground rail",
      ],
    },
    {
      id: "wiper-a0",
      title: "Wiper to A0",
      instruction: "Jumper the center pot pin to Uno analog A0.",
      why: "The wiper voltage is what the ADC measures.",
      referenceSummary: "Center pin → A0.",
      cameraChecklist: ["Jumper from the center pot pin to the header labeled A0"],
      completionHint:
        "Serial-print analogRead(A0) while turning the shaft; values should move smoothly.",
    },
  ],
});

const ESP_LED: Lesson = parseLesson({
  schemaVersion: 1,
  id: "esp32s3-led-series-resistor",
  title: "ESP32-S3: LED with series resistor",
  summary:
    "Wire an external LED and 330 Ω resistor to a safe GPIO on ESP32-S3-DevKitC-1 style boards (GPIO 4).",
  board: "esp32s3",
  difficulty: "starter",
  learningGoals: [
    "ESP32-S3 GPIOs are 3.3 V logic, not 5 V tolerant as inputs.",
    "Avoid strapping pins for simple LED lessons when possible.",
    "Same LED series-resistor pattern as Uno, different pin and voltage.",
  ],
  parts: [
    { id: "esp32s3", name: "ESP32-S3-DevKitC-1 (or compatible dual-header DevKit)", quantity: 1 },
    { id: "led", name: "5 mm LED", quantity: 1 },
    { id: "r330", name: "330 Ω resistor", quantity: 1 },
    { id: "jumper", name: "Male-male jumper wires", quantity: 2 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    {
      signal: "LED_ANODE_VIA_RESISTOR",
      boardPin: "GPIO4",
      notes: "Header label may read 4; confirm silkscreen for your DevKit revision",
    },
    { signal: "LED_CATHODE", boardPin: "GND", notes: "Any GND pin on the DevKit" },
  ],
  breadboardIntent:
    "GPIO4 → 330 Ω → LED anode; LED cathode → GND. Prefer a non-strapping GPIO; this lesson standardizes on GPIO4.",
  commonMistakes: [
    "Driving an LED from a 5 V pin or external 5 V without level care.",
    "Using a strapping pin that changes boot behavior.",
    "Mixing up 3V3 and 5V pins on the header.",
    "Assuming the onboard RGB LED is the same as this external LED pin.",
  ],
  limitations: [
    "Exact header silk varies by DevKit revision; match the official pin table for your board.",
    "QEMU GPIO is unsupported in this product; physical blink is the lesson success check.",
    "Camera cannot prove 3.3 V levels.",
  ],
  firmwareHint: "Arduino-ESP32: pinMode(4, OUTPUT); digitalWrite(4, HIGH/LOW);",
  keywords: ["led", "blink", "resistor", "esp32", "esp32-s3", "esp32s3", "devkit", "gpio", "light"],
  steps: [
    {
      id: "identify-gnd",
      title: "Find GND",
      instruction:
        "Locate a GND pin on the ESP32-S3 DevKit silk and jumper it to the breadboard ground rail.",
      why: "All return paths share ground with the module.",
      referenceSummary: "DevKit GND → ground rail.",
      cameraChecklist: ["Jumper from a pin labeled GND to the breadboard ground rail"],
    },
    {
      id: "place-led-r",
      title: "LED and series resistor",
      instruction:
        "Place LED (long leg anode) and 330 Ω in series on the breadboard. Cathode side will go to GND; resistor free end will go to GPIO4.",
      why: "Limits current from the 3.3 V GPIO into the LED.",
      referenceSummary: "GPIO path → 330 Ω → anode; cathode → GND.",
      cameraChecklist: [
        "LED and resistor are both on the board",
        "Resistor shares a row with the LED anode (long leg)",
      ],
    },
    {
      id: "cathode-gnd",
      title: "Cathode to GND",
      instruction: "Connect the LED short leg to the ground rail.",
      why: "Completes the LED current loop.",
      referenceSummary: "LED cathode → GND rail.",
      cameraChecklist: ["Jumper or direct link from short LED leg to ground rail"],
    },
    {
      id: "gpio4",
      title: "GPIO4 drive",
      instruction:
        "Jumper the free resistor end to the header pin labeled 4 (GPIO4). Do not use EN, BOOT, or 5V for this signal.",
      why: "GPIO4 is a common non-lesson-critical IO for starter blink demos on DevKitC-class boards.",
      referenceSummary: "Header 4 → resistor → LED → GND.",
      cameraChecklist: [
        "Jumper from pin labeled 4 to the resistor free end",
        "No jumper from the LED path to the 5V pin",
      ],
      completionHint: "Firmware toggling GPIO4 should blink the external LED.",
    },
  ],
});

const ESP_BUZZER_BUTTON: Lesson = parseLesson({
  schemaVersion: 1,
  id: "esp32s3-button-active-buzzer",
  title: "ESP32-S3: button and active buzzer",
  summary:
    "Wire a GND-referenced pushbutton on GPIO0-careful alternative GPIO5 and an active buzzer on GPIO6 for a press-to-beep starter build.",
  board: "esp32s3",
  difficulty: "starter",
  learningGoals: [
    "Active buzzers need DC drive on the signal pin (they contain an oscillator).",
    "Passive buzzers need PWM/tone; this lesson uses an active buzzer only.",
    "Button still uses INPUT_PULLUP to GND.",
  ],
  parts: [
    { id: "esp32s3", name: "ESP32-S3-DevKitC-1 class board", quantity: 1 },
    { id: "button", name: "Tactile pushbutton", quantity: 1 },
    {
      id: "buzzer",
      name: "Active buzzer module or active buzzer",
      quantity: 1,
      notes: "Must be active (often labeled with a sticker or sealed top)",
    },
    { id: "jumper", name: "Male-male jumper wires", quantity: 5 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    { signal: "BUTTON_SENSE", boardPin: "GPIO5", notes: "INPUT_PULLUP; press to GND" },
    { signal: "BUTTON_GND", boardPin: "GND" },
    {
      signal: "BUZZER_SIGNAL",
      boardPin: "GPIO6",
      notes: "Active buzzer I/O or + via module transistor",
    },
    { signal: "BUZZER_GND", boardPin: "GND" },
    {
      signal: "BUZZER_VCC_IF_MODULE",
      boardPin: "3V3",
      notes: "Only if the buzzer module has a separate VCC pin",
    },
  ],
  breadboardIntent:
    "Button: GPIO5 to one side, other side GND. Active buzzer: signal from GPIO6, ground shared; module VCC to 3V3 if present. Never drive a buzzer from 5 V into an ESP32 pin.",
  commonMistakes: [
    "Using a passive buzzer and expecting DC HIGH to tone continuously.",
    "Powering a 5 V buzzer module from 5 V while tying signal incorrectly into the ESP32.",
    "Wiring the button to 3V3 instead of GND with pull-up logic.",
    "Choosing BOOT/GPIO0 as the only button without understanding download-mode strapping.",
  ],
  limitations: [
    "Module pin labels (I/O, S, SIG) vary; follow your module silk.",
    "Volume and current vary by part; keep sessions short if the buzzer runs hot.",
    "Camera cannot hear the buzzer or prove active vs passive type.",
  ],
  firmwareHint:
    "pinMode(5, INPUT_PULLUP); pinMode(6, OUTPUT); digitalWrite(6, digitalRead(5) == LOW ? HIGH : LOW);",
  keywords: [
    "buzzer",
    "beep",
    "button",
    "pushbutton",
    "active buzzer",
    "esp32",
    "esp32-s3",
    "esp32s3",
    "sound",
    "alarm",
  ],
  steps: [
    {
      id: "gnd-3v3",
      title: "Shared ground (and 3V3 if needed)",
      instruction:
        "Jumper DevKit GND to the ground rail. If your buzzer module has a VCC pin, also jumper 3V3 to the red rail.",
      why: "Signal and power references must share ground with the ESP32.",
      referenceSummary: "GND rail from DevKit; optional 3V3 rail for module VCC.",
      cameraChecklist: ["GND jumper is visible", "If module needs power, 3V3 jumper is visible"],
    },
    {
      id: "button",
      title: "Button on GPIO5",
      instruction:
        "Wire pushbutton between header pin 5 (GPIO5) and GND. Use INPUT_PULLUP in firmware later.",
      why: "Press connects GPIO5 to ground for a clear LOW reading.",
      referenceSummary: "GPIO5 — button — GND.",
      cameraChecklist: ["Button on breadboard", "Jumper to pin labeled 5", "Other side to ground"],
    },
    {
      id: "buzzer-gnd",
      title: "Buzzer ground",
      instruction: "Connect the buzzer/module GND to the ground rail.",
      why: "Return path for the buzzer drive current.",
      referenceSummary: "Buzzer GND → ground rail.",
      cameraChecklist: ["Buzzer ground pin tied to the ground rail"],
    },
    {
      id: "buzzer-signal",
      title: "Buzzer signal on GPIO6",
      instruction:
        "Connect the active buzzer signal pin (I/O, S, or + on simple two-pin active buzzers) to GPIO6. If the module has VCC, connect VCC to 3V3.",
      why: "GPIO6 drives the active oscillator input or module transistor.",
      referenceSummary: "GPIO6 → buzzer signal; VCC→3V3 only for three-pin modules.",
      cameraChecklist: [
        "Jumper from pin labeled 6 to the buzzer signal pin",
        "No buzzer wire on the 5V pin for the ESP32 signal path",
      ],
      completionHint: "Pressing the button should beep when firmware maps GPIO5 LOW → GPIO6 HIGH.",
    },
  ],
});

const ESP_ULTRASONIC: Lesson = parseLesson({
  schemaVersion: 1,
  id: "esp32s3-hcsr04-ultrasonic",
  title: "ESP32-S3: HC-SR04 ultrasonic module",
  summary:
    "Wire a common HC-SR04 distance module using GPIO7 (TRIG) and GPIO15 (ECHO) with shared GND and 5 V module power only when your module requires it—plus a clear 3.3 V echo caution.",
  board: "esp32s3",
  difficulty: "starter",
  learningGoals: [
    "HC-SR04 uses TRIG (output from MCU) and ECHO (pulse back to MCU).",
    "Many HC-SR04 modules are 5 V devices; ECHO may need a divider on strict 3.3 V MCUs.",
    "Starter kits often include this module; treat voltage carefully.",
  ],
  parts: [
    { id: "esp32s3", name: "ESP32-S3-DevKitC-1 class board", quantity: 1 },
    { id: "hcsr04", name: "HC-SR04 ultrasonic module", quantity: 1 },
    {
      id: "dividers",
      name: "Two resistors for echo divider (e.g. 1 kΩ + 2 kΩ) if using 5 V echo",
      quantity: 2,
      notes: "Skip only if your module is explicitly 3.3 V tolerant on ECHO",
    },
    { id: "jumper", name: "Male-male jumper wires", quantity: 6 },
    { id: "breadboard", name: "Half-size solderless breadboard", quantity: 1 },
  ],
  pinMap: [
    { signal: "TRIG", boardPin: "GPIO7", notes: "MCU drives trigger" },
    {
      signal: "ECHO_TO_MCU",
      boardPin: "GPIO15",
      notes: "After level safety; never assume raw 5 V echo is safe",
    },
    { signal: "MODULE_GND", boardPin: "GND" },
    {
      signal: "MODULE_VCC",
      boardPin: "5V",
      notes: "Typical HC-SR04 VCC; confirm module marking",
    },
  ],
  breadboardIntent:
    "Module VCC to 5 V (if required), GND shared. TRIG from GPIO7. ECHO through a resistor divider into GPIO15 for 5 V modules. Keep wiring short.",
  commonMistakes: [
    "Feeding 5 V ECHO straight into an ESP32 GPIO.",
    "Swapping TRIG and ECHO.",
    "Missing common ground between module and DevKit.",
    "Expecting the harness camera or QEMU to measure distance.",
  ],
  limitations: [
    "Electrical safety of 5 V echo depends on your divider and module variant—this is guidance, not a lab certification.",
    "Some 'HC-SR04' clones differ; read your module’s silk.",
    "No distance value is claimed from camera evidence.",
  ],
  firmwareHint:
    "Pulse TRIG high 10 µs; pulseIn/echo timing on GPIO15; distance_cm ≈ duration_us / 58.",
  keywords: [
    "ultrasonic",
    "hc-sr04",
    "hcsr04",
    "distance",
    "sensor",
    "trig",
    "echo",
    "esp32",
    "esp32-s3",
    "esp32s3",
    "ranging",
  ],
  steps: [
    {
      id: "gnd-vcc",
      title: "Power and ground",
      instruction:
        "Connect module GND to DevKit GND. Connect module VCC to DevKit 5V only if the module is a standard 5 V HC-SR04. Do not power the ESP32 module itself from random external supplies.",
      why: "Shared ground is mandatory; VCC must match the module rating.",
      referenceSummary: "HC-SR04 GND→GND; VCC→5V when required by the module.",
      cameraChecklist: [
        "GND wire between module and DevKit is visible",
        "VCC wire lands on a 5V-labelled pin if used",
      ],
    },
    {
      id: "trig",
      title: "TRIG to GPIO7",
      instruction: "Jumper module TRIG to header pin 7 (GPIO7).",
      why: "The MCU starts a measurement with a short HIGH pulse on TRIG.",
      referenceSummary: "GPIO7 → TRIG.",
      cameraChecklist: ["Wire from pin labeled 7 to the module pin labeled TRIG"],
    },
    {
      id: "echo-divider",
      title: "ECHO level safety",
      instruction:
        "If ECHO is 5 V: build a divider (example: ECHO → 1 kΩ → node to GPIO15 → 2 kΩ → GND). If your module documentation states 3.3 V ECHO, you may wire ECHO to GPIO15 directly and skip the divider—state that assumption.",
      why: "ESP32-S3 pins are 3.3 V. A raw 5 V echo risks damage.",
      referenceSummary: "ECHO attenuated into GPIO15, or native 3.3 V ECHO only when documented.",
      cameraChecklist: [
        "ECHO path toward pin 15 is visible",
        "If divider used, two resistors form a chain toward ground",
      ],
    },
    {
      id: "final-check",
      title: "Orientation and clearance",
      instruction:
        "Point the metal cans outward with a clear path. Confirm TRIG≠ECHO wiring. Do not claim a distance reading from the camera.",
      why: "Mechanical placement affects readings; electrical map must stay correct first.",
      referenceSummary: "Sensors face free air; pin map GPIO7/GPIO15 + power/GND.",
      cameraChecklist: [
        "Module transducers are not blocked by jumper nests",
        "Four logical connections (VCC/GND/TRIG/ECHO path) appear present",
      ],
      completionHint: "Firmware distance printout is the success check—not the camera.",
    },
  ],
});

export const STARTER_LESSONS: readonly Lesson[] = [
  UNO_LED,
  UNO_BUTTON,
  UNO_POT,
  ESP_LED,
  ESP_BUZZER_BUTTON,
  ESP_ULTRASONIC,
];

validateLessonCatalog(STARTER_LESSONS);

export function getStarterLessons(): readonly Lesson[] {
  return STARTER_LESSONS;
}

export function getStarterLessonById(lessonId: string): Lesson | undefined {
  return STARTER_LESSONS.find((lesson) => lesson.id === lessonId);
}
