import type { EmbeddedTargetId } from "@domain/embedded";
import type { CoachProgress, Lesson, LessonStep, LessonSummary } from "@domain/lesson";
import type { CompileArduinoResult } from "./firmware-contract";

export interface CoachSnapshot {
  readonly progress: CoachProgress;
  readonly lessons: readonly LessonSummary[];
  readonly activeLesson: Lesson | undefined;
  readonly activeStep: LessonStep | undefined;
  readonly stepIndex: number;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly isLastStep: boolean;
}

export interface StartCoachLessonInput {
  readonly projectId: string;
  readonly lessonId: string;
}

export interface AdvanceCoachLessonInput {
  readonly projectId: string;
}

export interface GoToCoachStepInput {
  readonly projectId: string;
  readonly stepIndex: number;
}

export interface ClearCoachLessonInput {
  readonly projectId: string;
}

export interface ApplyCoachFirmwareInput {
  readonly projectId: string;
  readonly lessonId?: string;
}

export interface CoachFirmwarePreview {
  readonly lessonId: string;
  readonly targetId: EmbeddedTargetId;
  readonly title: string;
  readonly description: string;
  readonly successCheck: string;
  readonly limitations: readonly string[];
  readonly source: string;
}

export interface ApplyCoachFirmwareResult {
  readonly lessonId: string;
  readonly targetId: string;
  readonly successCheck: string;
  readonly result: CompileArduinoResult;
}
