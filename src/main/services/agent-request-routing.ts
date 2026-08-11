import {
  type CoachProgress,
  isBeginnerBuildIntent,
  matchLessonFromText,
  resolveActiveLessonStep,
} from "@domain/lesson";
import { getStarterLessons } from "@domain/lesson-fixtures";

const ESP32_PATTERN = /\besp[ -]?32(?:[ -]?s3)?\b/i;
const POMODORO_PATTERN = /\bpomodoro\b/i;
const CREATE_PATTERN = /\b(?:create|design|build|make|draw|wire)\b/i;

export interface CoachRoutingInput {
  readonly text: string;
  readonly progress?: CoachProgress;
  readonly visualRequest?: boolean;
}

/**
 * Build injected request routing. Mode A (lab coach) wins over freeform invent
 * when a lesson is active or a starter lesson matches beginner intent.
 * Pomodoro remains an advanced freeform path only when no coach binding applies.
 */
export function buildAgentRequestRouting(input: string | CoachRoutingInput): string | undefined {
  const text = typeof input === "string" ? input : input.text;
  const progress = typeof input === "string" ? undefined : input.progress;
  const visualRequest = typeof input === "string" ? false : Boolean(input.visualRequest);
  const lessons = getStarterLessons();
  const active = progress ? resolveActiveLessonStep(lessons, progress) : undefined;

  if (active) {
    const wantsFirmware =
      /\b(?:code|sketch|firmware|compile|upload|program|flash|arduino-?cli|load\s+sketch|golden\s+sketch)\b/i.test(
        text,
      );
    if (wantsFirmware) {
      return `<circuit-harness-request-routing>
Mode A lab coach firmware path: lesson "${active.lesson.id}" is active.
Call get_lab_lesson_firmware then apply_lab_lesson_firmware for this lesson (golden sketch). Do NOT invent a new sketch or alternate pins.
If arduino-cli is not available, tell the user to run: bash scripts/setup-arduino-cli.sh and restart the app.
Remind them: compile success is not wiring proof; successCheck is what to observe on the bench.
</circuit-harness-request-routing>`;
    }

    const cameraBlock = visualRequest
      ? `
The user asked for a visual/build check. Compare the attached camera frame ONLY against this active golden step:
- lessonId: ${active.lesson.id}
- stepId: ${active.step.id}
- step ${active.stepNumber}/${active.totalSteps}: ${active.step.title}
- referenceSummary: ${active.step.referenceSummary}
- cameraChecklist: ${JSON.stringify(active.step.cameraChecklist)}
- commonMistakes: ${JSON.stringify(active.lesson.commonMistakes)}
Describe only visible evidence. Do not invent a new circuit. Do not call propose_circuit_changes for this check. Call get_lab_coach_status if you need the full structured payload. Visible evidence cannot establish hidden connectivity, continuity, voltage, current, polarity, or safety.`
      : `
A lab lesson is active. Teach step ${active.stepNumber}/${active.totalSteps} ("${active.step.title}") of lesson "${active.lesson.title}" (${active.lesson.id}).
Call get_lab_coach_status or explain_lab_step. Stay inside the lesson parts allowlist and pin map. Do not invent freeform netlists or call propose_circuit_changes / propose_breadboard_changes unless the user explicitly asks for advanced sandbox CAD.`;

    return `<circuit-harness-request-routing>
Mode A lab coach is active for this project.
${cameraBlock}
</circuit-harness-request-routing>`;
  }

  const matched = matchLessonFromText(lessons, text);
  if (matched && isBeginnerBuildIntent(text)) {
    return `<circuit-harness-request-routing>
Mode A lab coach default: the user's beginner kit request matches golden lesson "${matched.title}" (${matched.id}) for board ${matched.board}.
Call start_lab_lesson with lessonId "${matched.id}" (or list_lab_lessons first if you need confirmation), then teach step 0 using explain_lab_step / get_lab_coach_status.
Do NOT call propose_circuit_changes or invent a new schematic as the primary path. Sandbox CAD tools are demoted while coaching.
If the user only wanted a conceptual explanation with no build, you may explain without starting—but prefer the golden lesson wiring when they are building.
</circuit-harness-request-routing>`;
  }

  if (visualRequest) {
    return `<circuit-harness-request-routing>
Build-camera check without an active lab lesson: describe only visible evidence. Suggest starting a matching lab lesson (list_lab_lessons) if the user is doing a starter-kit build. Do not invent a full circuit from the photo. Visible evidence cannot establish hidden connectivity, continuity, voltage, current, polarity, or safety.
</circuit-harness-request-routing>`;
  }

  // Advanced freeform path (non-default): ESP32 Pomodoro product sketch
  if (ESP32_PATTERN.test(text) && POMODORO_PATTERN.test(text) && CREATE_PATTERN.test(text)) {
    return `<circuit-harness-request-routing>
Advanced sandbox path (not Mode A default): The user's request to create the ESP32 Pomodoro timer explicitly authorizes staging a non-applying circuit proposal in this turn. Read the canonical circuit and catalog, then call propose_circuit_changes now. Do not ask for redundant confirmation, Arduino-versus-ESPHome choice, or display choice before staging. Use the harness defaults: ESP32-S3-DevKitC-1 v1.1, two active-low pushbuttons, active buzzer, status LED with 330 ohm series resistor, 4-pin 3.3 V I2C OLED connector, and common ground. Choose safe non-strapping GPIOs and name the nets. The proposal still requires separate explicit user approval before application.
</circuit-harness-request-routing>`;
  }

  return undefined;
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
    .replace(/\n\n<circuit-harness-lab-coach>[\s\S]*?<\/circuit-harness-lab-coach>/g, "")
    .replace(/\n\n<circuit-harness-voice-style>[\s\S]*?<\/circuit-harness-voice-style>/g, "");
}
