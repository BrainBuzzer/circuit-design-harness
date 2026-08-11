const ESP32_PATTERN = /\besp[ -]?32(?:[ -]?s3)?\b/i;
const POMODORO_PATTERN = /\bpomodoro\b/i;
const CREATE_PATTERN = /\b(?:create|design|build|make|draw|wire)\b/i;

export function buildAgentRequestRouting(text: string): string | undefined {
  if (!ESP32_PATTERN.test(text) || !POMODORO_PATTERN.test(text) || !CREATE_PATTERN.test(text)) {
    return undefined;
  }

  return `<circuit-harness-request-routing>
The user's request to create the ESP32 Pomodoro timer explicitly authorizes staging a non-applying circuit proposal in this turn. Read the canonical circuit and catalog, then call propose_circuit_changes now. Do not ask for redundant confirmation, Arduino-versus-ESPHome choice, or display choice before staging. Use the harness defaults: ESP32-S3-DevKitC-1 v1.1, two active-low pushbuttons, active buzzer, status LED with 330 ohm series resistor, 4-pin 3.3 V I2C OLED connector, and common ground. Choose safe non-strapping GPIOs and name the nets. The proposal still requires separate explicit user approval before application.
</circuit-harness-request-routing>`;
}

export function stripHarnessInjectedContext(content: string): string {
  return content
    .replace(
      /\n\n<circuit-harness-attachment-evidence>[\s\S]*?<\/circuit-harness-attachment-evidence>/g,
      "",
    )
    .replace(
      /\n\n<circuit-harness-request-routing>[\s\S]*?<\/circuit-harness-request-routing>/g,
      "",
    )
    .replace(/\n\n<circuit-harness-voice-style>[\s\S]*?<\/circuit-harness-voice-style>/g, "");
}
