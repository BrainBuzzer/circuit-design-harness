import { matchLessonFromText, resolveActiveLessonStep, toLessonSummary } from "@domain/lesson";
import { listLessonFirmwareSummaries, requireLessonFirmware } from "@domain/lesson-firmware";
import { getStarterLessons } from "@domain/lesson-fixtures";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CoachService } from "./coach-service";
import type { FirmwareService } from "./firmware-service";

export function createAgentCoachTools(
  projectId: string,
  coach: CoachService,
  firmware: FirmwareService,
): ToolDefinition[] {
  const listLessons = defineTool({
    name: "list_lab_lessons",
    label: "List lab coach lessons",
    description:
      "Returns the hand-authored starter-kit lab lessons (Mode A) for Arduino Uno R3 and ESP32-S3. Use this for beginners instead of inventing a freeform circuit.",
    promptSnippet: "List golden lab lessons before inventing a circuit for a beginner kit build.",
    promptGuidelines: [
      "Prefer list_lab_lessons + start_lab_lesson for starter LED/button/sensor kit requests.",
      "Do not invent a new netlist when a shipped lesson covers the request.",
      "Sandbox propose_circuit_changes remains for advanced freeform design only.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const lessons = coach.getLessons().map(toLessonSummary);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mode: "lab_coach",
                lessons,
                note: "Lessons are golden fixtures. Teach and check against them; do not rewrite them.",
              },
              null,
              2,
            ),
          },
        ],
        details: { count: lessons.length },
      };
    },
  });

  const getLesson = defineTool({
    name: "get_lab_lesson",
    label: "Get lab lesson details",
    description:
      "Returns one golden lab lesson including parts allowlist, pin map, steps, common mistakes, and limitations.",
    promptSnippet: "Read the full golden lesson before teaching or checking a step.",
    promptGuidelines: [
      "Use exact lesson ids from list_lab_lessons.",
      "Repeat lesson limitations when making electrical or camera claims.",
    ],
    parameters: Type.Object({
      lessonId: Type.String({ description: "Lesson id, e.g. uno-led-series-resistor" }),
    }),
    execute: async (_toolCallId, params) => {
      const lesson = coach.getLessons().find((entry) => entry.id === params.lessonId);
      if (!lesson) {
        throw new Error(`Unknown lesson id: ${params.lessonId}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(lesson, null, 2) }],
        details: { lessonId: lesson.id },
      };
    },
  });

  const startLesson = defineTool({
    name: "start_lab_lesson",
    label: "Start lab lesson",
    description:
      "Starts or restarts a golden lab lesson for this project at step 0. Persists coach progress in coach.json.",
    promptSnippet: "Start a matching golden lesson for beginner kit builds.",
    promptGuidelines: [
      "Call start_lab_lesson when the user wants to learn/build a covered starter pattern.",
      "After starting, teach the current step with get_lab_coach_status; do not propose freeform CAD first.",
    ],
    parameters: Type.Object({
      lessonId: Type.String({ description: "Lesson id to start" }),
    }),
    execute: async (_toolCallId, params) => {
      const snapshot = await coach.startLesson(projectId, params.lessonId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                started: true,
                lessonId: snapshot.progress.lessonId,
                stepIndex: snapshot.stepIndex,
                step: snapshot.activeStep,
                totalSteps: snapshot.totalSteps,
                message:
                  "Lesson started at step 0. Teach this step; camera checks bind to this step checklist.",
              },
              null,
              2,
            ),
          },
        ],
        details: { lessonId: params.lessonId, stepIndex: 0 },
      };
    },
  });

  const status = defineTool({
    name: "get_lab_coach_status",
    label: "Get lab coach status",
    description:
      "Returns the project's active lesson, current step, reference wiring summary, and camera checklist for Mode A coaching.",
    promptSnippet: "Read active lab step before teaching or checking the physical build.",
    promptGuidelines: [
      "When a lesson is active, coach against that step only.",
      "If no lesson is active, list lessons or match the user's kit request to a lesson id.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await coach.getSnapshot(projectId);
      const payload = await coach.getActiveStepContextPayload(projectId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                progress: snapshot.progress,
                active: payload ?? null,
                availableLessonIds: snapshot.lessons.map((lesson) => lesson.id),
              },
              null,
              2,
            ),
          },
        ],
        details: {
          lessonId: snapshot.progress.lessonId,
          stepIndex: snapshot.stepIndex,
        },
      };
    },
  });

  const advance = defineTool({
    name: "advance_lab_lesson_step",
    label: "Advance lab lesson step",
    description:
      "Advances the active lesson to the next step after the learner completes the current physical step. Stays on the last step if already finished.",
    promptSnippet: "Advance only after the learner is ready for the next physical step.",
    promptGuidelines: [
      "Do not skip ahead without teaching the current step.",
      "On the last step, summarize learning goals instead of inventing new circuitry.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await coach.advance(projectId);
      const payload = await coach.getActiveStepContextPayload(projectId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                advanced: true,
                isLastStep: snapshot.isLastStep,
                active: payload,
              },
              null,
              2,
            ),
          },
        ],
        details: {
          lessonId: snapshot.progress.lessonId,
          stepIndex: snapshot.stepIndex,
        },
      };
    },
  });

  const explain = defineTool({
    name: "explain_lab_step",
    label: "Explain lab step",
    description:
      "Returns structured teaching content for the active step (or a named lesson/step): instruction, why, reference, mistakes, and camera checklist.",
    promptSnippet:
      "Explain the golden step with why + common mistakes; do not invent alternate wiring.",
    promptGuidelines: [
      "Stay inside the lesson parts allowlist and pin map.",
      "Never claim camera or explanation proves electrical safety.",
    ],
    parameters: Type.Object({
      lessonId: Type.Optional(
        Type.String({ description: "Optional lesson id; defaults to active" }),
      ),
      stepIndex: Type.Optional(
        Type.Integer({ minimum: 0, description: "Optional step index; defaults to active" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const lessons = coach.getLessons();
      let lessonId = params.lessonId as string | undefined;
      let stepIndex = params.stepIndex as number | undefined;
      if (lessonId === undefined || stepIndex === undefined) {
        const snapshot = await coach.getSnapshot(projectId);
        lessonId = lessonId ?? snapshot.progress.lessonId ?? undefined;
        stepIndex = stepIndex ?? snapshot.stepIndex;
      }
      if (!lessonId) {
        throw new Error("No active lesson. Start a lesson or pass lessonId.");
      }
      const lesson = lessons.find((entry) => entry.id === lessonId);
      if (!lesson) {
        throw new Error(`Unknown lesson id: ${lessonId}`);
      }
      const index = stepIndex ?? 0;
      const step = lesson.steps[index];
      if (!step) {
        throw new Error(`Step index ${index} out of range for ${lessonId}.`);
      }
      const active = resolveActiveLessonStep(lessons, {
        schemaVersion: 1,
        lessonId,
        stepIndex: index,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                lessonId,
                stepIndex: index,
                stepId: step.id,
                title: step.title,
                instruction: step.instruction,
                why: step.why,
                referenceSummary: step.referenceSummary,
                cameraChecklist: step.cameraChecklist,
                commonMistakes: lesson.commonMistakes,
                pinMap: lesson.pinMap,
                parts: lesson.parts,
                limitations: lesson.limitations,
                teachingMode: "lab_coach_golden_step",
                stepNumber: index + 1,
                totalSteps: lesson.steps.length,
                isLastStep: active?.isLastStep ?? false,
              },
              null,
              2,
            ),
          },
        ],
        details: { lessonId, stepIndex: index, stepId: step.id },
      };
    },
  });

  const getFirmware = defineTool({
    name: "get_lab_lesson_firmware",
    label: "Get golden lab lesson firmware",
    description:
      "Returns the hand-authored Arduino sketch for a lab lesson (or the active lesson). Prefer this over inventing firmware so the learner can focus on wiring.",
    promptSnippet: "Load golden lesson firmware instead of writing a new sketch during Mode A.",
    promptGuidelines: [
      "Never invent alternate pins for a golden lesson sketch.",
      "Explain successCheck in plain language; do not claim compile equals correct wiring.",
    ],
    parameters: Type.Object({
      lessonId: Type.Optional(
        Type.String({ description: "Lesson id; defaults to active lab lesson" }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      let lessonId = params.lessonId as string | undefined;
      if (!lessonId) {
        const snapshot = await coach.getSnapshot(projectId);
        lessonId = snapshot.progress.lessonId ?? undefined;
      }
      if (!lessonId) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                available: listLessonFirmwareSummaries(),
                note: "No active lesson. Pass lessonId or start_lab_lesson first.",
              }),
            },
          ],
          details: { lessonId: "", targetId: "" },
        };
      }
      const entry = requireLessonFirmware(lessonId);
      return {
        content: [{ type: "text", text: JSON.stringify(entry, null, 2) }],
        details: { lessonId: entry.lessonId, targetId: entry.targetId },
      };
    },
  });

  const applyFirmware = defineTool({
    name: "apply_lab_lesson_firmware",
    label: "Apply golden lab lesson firmware",
    description:
      "Writes the golden Arduino sketch for the lesson into the project and optionally compiles it with allowlisted arduino-cli for Uno or ESP32-S3. Use this so beginners do not author code.",
    promptSnippet:
      "After wiring is ready, apply golden firmware and compile; do not freeform-author a sketch for covered lessons.",
    promptGuidelines: [
      "Default compile=true when the user wants to try the circuit.",
      "Report arduino-cli not_available clearly and point them at scripts/setup-arduino-cli.sh.",
      "Compilation is not proof of correct wiring or safety.",
      "Do not call propose_circuit_changes as a substitute for golden firmware.",
    ],
    parameters: Type.Object({
      lessonId: Type.Optional(
        Type.String({ description: "Lesson id; defaults to active lab lesson" }),
      ),
      compile: Type.Optional(
        Type.Boolean({ description: "Compile with arduino-cli after save (default true)" }),
      ),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      let lessonId = params.lessonId as string | undefined;
      const shouldCompile = params.compile !== false;
      if (!lessonId) {
        const snapshot = await coach.getSnapshot(projectId);
        lessonId = snapshot.progress.lessonId ?? undefined;
      }
      if (!lessonId) {
        throw new Error("No active lesson. Start a lesson or pass lessonId.");
      }
      const entry = requireLessonFirmware(lessonId);
      if (!shouldCompile) {
        // Save only by compiling path with validation — use compile path for atomic save.
        // FirmwareService.compileArduino always saves; we still call it for a real compile when requested.
      }
      const result = await firmware.compileArduino({
        projectId,
        targetId: entry.targetId,
        source: entry.source,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                applied: true,
                lessonId: entry.lessonId,
                targetId: entry.targetId,
                title: entry.title,
                successCheck: entry.successCheck,
                firmwareLimitations: entry.limitations,
                compileRequested: shouldCompile,
                result: shouldCompile
                  ? result
                  : {
                      savedRelativePath: result.savedRelativePath,
                      note: "Sketch saved via compile pipeline; treat structural validity from result.sourceValid.",
                      sourceValid: result.sourceValid,
                      issues: result.issues,
                      compilation: result.compilation,
                    },
                learnerFocus:
                  "If compile passed and behavior is wrong, debug wiring/power/polarity—not the golden sketch pins.",
                setupHelp:
                  result.compilation.outcome === "not_available"
                    ? "Run bash scripts/setup-arduino-cli.sh then restart the app so arduino-cli is on PATH."
                    : undefined,
              },
              null,
              2,
            ),
          },
        ],
        details: {
          lessonId: entry.lessonId,
          targetId: entry.targetId,
          compileOutcome: result.compilation.outcome,
        },
      };
    },
  });

  return [
    listLessons,
    getLesson,
    startLesson,
    status,
    advance,
    explain,
    getFirmware,
    applyFirmware,
  ];
}

export function matchStarterLessonId(text: string): string | undefined {
  return matchLessonFromText(getStarterLessons(), text)?.id;
}
