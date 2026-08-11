import { z } from "zod";
import { EmbeddedTargetIdSchema } from "./embedded";

export const LESSON_SCHEMA_VERSION = 1 as const;

export const LessonPartSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    quantity: z.int().positive().max(20),
    notes: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const LessonPinMapEntrySchema = z
  .object({
    signal: z.string().trim().min(1).max(80),
    boardPin: z.string().trim().min(1).max(40),
    notes: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const LessonStepSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(120),
    instruction: z.string().trim().min(1).max(2_000),
    why: z.string().trim().min(1).max(2_000),
    referenceSummary: z.string().trim().min(1).max(2_000),
    cameraChecklist: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    completionHint: z.string().trim().min(1).max(400).optional(),
  })
  .strict();

export const LessonSchema = z
  .object({
    schemaVersion: z.literal(LESSON_SCHEMA_VERSION),
    id: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(600),
    board: EmbeddedTargetIdSchema,
    difficulty: z.literal("starter"),
    learningGoals: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    parts: z.array(LessonPartSchema).min(1).max(20),
    pinMap: z.array(LessonPinMapEntrySchema).min(1).max(40),
    breadboardIntent: z.string().trim().min(1).max(2_000),
    commonMistakes: z.array(z.string().trim().min(1).max(400)).min(1).max(20),
    limitations: z.array(z.string().trim().min(1).max(400)).min(1).max(20),
    firmwareHint: z.string().trim().min(1).max(1_200).optional(),
    steps: z.array(LessonStepSchema).min(1).max(30),
    keywords: z.array(z.string().trim().min(1).max(40)).min(1).max(40),
  })
  .strict();

export type Lesson = z.infer<typeof LessonSchema>;
export type LessonStep = z.infer<typeof LessonStepSchema>;
export type LessonPart = z.infer<typeof LessonPartSchema>;

export const CoachProgressSchema = z
  .object({
    schemaVersion: z.literal(1),
    lessonId: z.string().trim().min(1).max(60).nullable(),
    stepIndex: z.int().nonnegative().max(100),
    startedAt: z.iso.datetime().optional(),
    updatedAt: z.iso.datetime().optional(),
  })
  .strict();

export type CoachProgress = z.infer<typeof CoachProgressSchema>;

export const EMPTY_COACH_PROGRESS: CoachProgress = {
  schemaVersion: 1,
  lessonId: null,
  stepIndex: 0,
};

export function parseLesson(raw: unknown): Lesson {
  return LessonSchema.parse(raw);
}

export function parseCoachProgress(raw: unknown): CoachProgress {
  const parsed = CoachProgressSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_COACH_PROGRESS;
}

export function validateLessonCatalog(lessons: readonly Lesson[]): void {
  const ids = new Set<string>();
  for (const lesson of lessons) {
    LessonSchema.parse(lesson);
    if (ids.has(lesson.id)) {
      throw new Error(`Duplicate lesson id: ${lesson.id}`);
    }
    ids.add(lesson.id);
    const stepIds = new Set<string>();
    for (const step of lesson.steps) {
      if (stepIds.has(step.id)) {
        throw new Error(`Duplicate step id ${step.id} in lesson ${lesson.id}`);
      }
      stepIds.add(step.id);
    }
  }
}

export interface LessonSummary {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly board: Lesson["board"];
  readonly difficulty: Lesson["difficulty"];
  readonly stepCount: number;
  readonly keywords: readonly string[];
}

export function toLessonSummary(lesson: Lesson): LessonSummary {
  return {
    id: lesson.id,
    title: lesson.title,
    summary: lesson.summary,
    board: lesson.board,
    difficulty: lesson.difficulty,
    stepCount: lesson.steps.length,
    keywords: lesson.keywords,
  };
}

export interface ActiveLessonStepContext {
  readonly lesson: Lesson;
  readonly step: LessonStep;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly isLastStep: boolean;
  readonly progress: CoachProgress;
}

export function resolveActiveLessonStep(
  lessons: readonly Lesson[],
  progress: CoachProgress,
): ActiveLessonStepContext | undefined {
  if (!progress.lessonId) {
    return undefined;
  }
  const lesson = lessons.find((entry) => entry.id === progress.lessonId);
  if (!lesson) {
    return undefined;
  }
  const step = lesson.steps[progress.stepIndex];
  if (!step) {
    return undefined;
  }
  return {
    lesson,
    step,
    stepIndex: progress.stepIndex,
    stepNumber: progress.stepIndex + 1,
    totalSteps: lesson.steps.length,
    isLastStep: progress.stepIndex >= lesson.steps.length - 1,
    progress,
  };
}

export function startLessonProgress(
  lessons: readonly Lesson[],
  lessonId: string,
  now: Date = new Date(),
): CoachProgress {
  const lesson = lessons.find((entry) => entry.id === lessonId);
  if (!lesson) {
    throw new Error(`Unknown lesson id: ${lessonId}`);
  }
  const timestamp = now.toISOString();
  return CoachProgressSchema.parse({
    schemaVersion: 1,
    lessonId: lesson.id,
    stepIndex: 0,
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

export function advanceLessonProgress(
  lessons: readonly Lesson[],
  progress: CoachProgress,
  now: Date = new Date(),
): CoachProgress {
  const active = resolveActiveLessonStep(lessons, progress);
  if (!active) {
    throw new Error("No active lesson step to advance.");
  }
  if (active.isLastStep) {
    return CoachProgressSchema.parse({
      ...progress,
      updatedAt: now.toISOString(),
    });
  }
  return CoachProgressSchema.parse({
    ...progress,
    stepIndex: progress.stepIndex + 1,
    updatedAt: now.toISOString(),
  });
}

export function goToLessonStep(
  lessons: readonly Lesson[],
  progress: CoachProgress,
  stepIndex: number,
  now: Date = new Date(),
): CoachProgress {
  if (!progress.lessonId) {
    throw new Error("No active lesson.");
  }
  const lesson = lessons.find((entry) => entry.id === progress.lessonId);
  if (!lesson) {
    throw new Error(`Unknown lesson id: ${progress.lessonId}`);
  }
  if (stepIndex < 0 || stepIndex >= lesson.steps.length) {
    throw new Error(
      `Step index ${stepIndex} is out of range for lesson ${lesson.id} (0..${lesson.steps.length - 1}).`,
    );
  }
  return CoachProgressSchema.parse({
    ...progress,
    stepIndex,
    updatedAt: now.toISOString(),
  });
}

export function clearLessonProgress(now: Date = new Date()): CoachProgress {
  return CoachProgressSchema.parse({
    schemaVersion: 1,
    lessonId: null,
    stepIndex: 0,
    updatedAt: now.toISOString(),
  });
}

/**
 * Build structured coach context for the agent and camera path.
 * Golden lesson data only — never invents a new netlist.
 */
export function buildCoachStepContextPayload(
  active: ActiveLessonStepContext,
): Record<string, unknown> {
  return {
    mode: "lab_coach",
    claimBoundary:
      "Coach guidance and camera checks use the golden lesson step only. Visible evidence cannot prove hidden connectivity, continuity, voltage, current, polarity, or safety.",
    lessonId: active.lesson.id,
    lessonTitle: active.lesson.title,
    board: active.lesson.board,
    stepId: active.step.id,
    stepIndex: active.stepIndex,
    stepNumber: active.stepNumber,
    totalSteps: active.totalSteps,
    stepTitle: active.step.title,
    instruction: active.step.instruction,
    why: active.step.why,
    referenceSummary: active.step.referenceSummary,
    cameraChecklist: active.step.cameraChecklist,
    pinMap: active.lesson.pinMap,
    partsAllowlist: active.lesson.parts,
    breadboardIntent: active.lesson.breadboardIntent,
    commonMistakes: active.lesson.commonMistakes,
    limitations: active.lesson.limitations,
    ...(active.step.completionHint ? { completionHint: active.step.completionHint } : {}),
    ...(active.lesson.firmwareHint ? { firmwareHint: active.lesson.firmwareHint } : {}),
  };
}

export function buildCoachStepContextText(active: ActiveLessonStepContext): string {
  return JSON.stringify(buildCoachStepContextPayload(active), null, 2);
}

/**
 * Match beginner natural-language intent to a shipped lesson.
 * Prefer more specific multi-keyword hits; require board keyword when present.
 */
export function matchLessonFromText(lessons: readonly Lesson[], text: string): Lesson | undefined {
  const normalized = text.replaceAll(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  const wantsUno = /\b(?:arduino\s*)?uno\b/.test(normalized) || /\batmega\b/.test(normalized);
  const wantsEsp = /\besp[ -]?32(?:[ -]?s3)?\b/.test(normalized) || /\bdevkit\b/.test(normalized);

  const scored = lessons
    .map((lesson) => {
      if (wantsUno && lesson.board !== "arduino_uno_r3") {
        return { lesson, score: 0 };
      }
      if (wantsEsp && lesson.board !== "esp32s3") {
        return { lesson, score: 0 };
      }
      if (!wantsUno && !wantsEsp) {
        // No board mentioned: still allow match but slightly prefer not inventing wrong board.
      }
      let score = 0;
      for (const keyword of lesson.keywords) {
        const needle = keyword.toLowerCase();
        if (normalized.includes(needle)) {
          score += needle.includes(" ") ? 3 : 2;
        }
      }
      // Soft board bonus when board keyword present
      if (wantsUno && lesson.board === "arduino_uno_r3") {
        score += 1;
      }
      if (wantsEsp && lesson.board === "esp32s3") {
        score += 1;
      }
      return { lesson, score };
    })
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || a.lesson.id.localeCompare(b.lesson.id));

  return scored[0]?.lesson;
}

export function isBeginnerBuildIntent(text: string): boolean {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  // Open advanced product design stays freeform (handled separately).
  if (/\bpomodoro\b/i.test(normalized)) {
    return false;
  }
  const teachOrBuild =
    /\b(?:teach|learn|lesson|start|help|show|guide|wire|wiring|build|make|connect|hook\s*up|blink|light|led|button|buzzer|sensor|potentiometer|pot\b|ultrasonic|dht|oled|check|look)\b/i.test(
      normalized,
    );
  return teachOrBuild;
}
