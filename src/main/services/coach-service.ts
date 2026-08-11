import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  advanceLessonProgress,
  buildCoachStepContextPayload,
  buildCoachStepContextText,
  clearLessonProgress,
  type CoachProgress,
  EMPTY_COACH_PROGRESS,
  goToLessonStep,
  type Lesson,
  parseCoachProgress,
  resolveActiveLessonStep,
  startLessonProgress,
  toLessonSummary,
} from "@domain/lesson";
import { getStarterLessons } from "@domain/lesson-fixtures";
import { getLessonFirmware, requireLessonFirmware } from "@domain/lesson-firmware";
import type { CoachSnapshot } from "@shared/coach-contract";
import type { CompileArduinoResult } from "@shared/firmware-contract";
import { writeJsonAtomic } from "./json-file";
import type { FirmwareService } from "./firmware-service";
import type { ProjectService } from "./project-service";

export class CoachService {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: ProjectService,
    private readonly firmware?: FirmwareService,
  ) {}

  getLessons(): readonly Lesson[] {
    return getStarterLessons();
  }

  async getSnapshot(projectId: string): Promise<CoachSnapshot> {
    const progress = await this.readProgress(projectId);
    return this.toSnapshot(progress);
  }

  async startLesson(projectId: string, lessonId: string): Promise<CoachSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const progress = startLessonProgress(this.getLessons(), lessonId);
      await this.writeProgress(projectId, progress);
      return this.toSnapshot(progress);
    });
  }

  async advance(projectId: string): Promise<CoachSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const current = await this.readProgress(projectId);
      const progress = advanceLessonProgress(this.getLessons(), current);
      await this.writeProgress(projectId, progress);
      return this.toSnapshot(progress);
    });
  }

  async goToStep(projectId: string, stepIndex: number): Promise<CoachSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const current = await this.readProgress(projectId);
      const progress = goToLessonStep(this.getLessons(), current, stepIndex);
      await this.writeProgress(projectId, progress);
      return this.toSnapshot(progress);
    });
  }

  async clear(projectId: string): Promise<CoachSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const progress = clearLessonProgress();
      await this.writeProgress(projectId, progress);
      return this.toSnapshot(progress);
    });
  }

  async getActiveStepContextText(projectId: string): Promise<string | undefined> {
    const progress = await this.readProgress(projectId);
    const active = resolveActiveLessonStep(this.getLessons(), progress);
    if (!active) {
      return undefined;
    }
    return buildCoachStepContextText(active);
  }

  async getActiveStepContextPayload(
    projectId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const progress = await this.readProgress(projectId);
    const active = resolveActiveLessonStep(this.getLessons(), progress);
    if (!active) {
      return undefined;
    }
    return buildCoachStepContextPayload(active);
  }

  getLessonFirmwareSummary(lessonId: string) {
    const entry = getLessonFirmware(lessonId);
    if (!entry) {
      return undefined;
    }
    return {
      lessonId: entry.lessonId,
      targetId: entry.targetId,
      title: entry.title,
      description: entry.description,
      successCheck: entry.successCheck,
      limitations: entry.limitations,
      source: entry.source,
    };
  }

  async applyLessonFirmware(
    projectId: string,
    lessonId?: string,
  ): Promise<{
    lessonId: string;
    targetId: string;
    successCheck: string;
    result: CompileArduinoResult;
  }> {
    if (!this.firmware) {
      throw new Error("Firmware service is not configured for the lab coach.");
    }
    let id = lessonId;
    if (!id) {
      const progress = await this.readProgress(projectId);
      id = progress.lessonId ?? undefined;
    }
    if (!id) {
      throw new Error("No active lesson. Start a lesson before applying golden firmware.");
    }
    const entry = requireLessonFirmware(id);
    const result = await this.firmware.compileArduino({
      projectId,
      targetId: entry.targetId,
      source: entry.source,
    });
    return {
      lessonId: entry.lessonId,
      targetId: entry.targetId,
      successCheck: entry.successCheck,
      result,
    };
  }

  private toSnapshot(progress: CoachProgress): CoachSnapshot {
    const lessons = this.getLessons();
    const active = resolveActiveLessonStep(lessons, progress);
    return {
      progress,
      lessons: lessons.map(toLessonSummary),
      activeLesson: active?.lesson,
      activeStep: active?.step,
      stepIndex: active?.stepIndex ?? progress.stepIndex,
      stepNumber: active?.stepNumber ?? 0,
      totalSteps: active?.totalSteps ?? 0,
      isLastStep: active?.isLastStep ?? false,
    };
  }

  private async readProgress(projectId: string): Promise<CoachProgress> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const filePath = path.join(projectDirectory, "coach.json");
    try {
      const raw = await readFile(filePath, "utf8");
      return parseCoachProgress(JSON.parse(raw));
    } catch {
      return EMPTY_COACH_PROGRESS;
    }
  }

  private async writeProgress(projectId: string, progress: CoachProgress): Promise<void> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    await writeJsonAtomic(path.join(projectDirectory, "coach.json"), progress);
  }

  private async withProjectWrite<T>(projectId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.writeQueues.set(
      projectId,
      previous.then(() => gate),
    );
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.writeQueues.get(projectId) === gate) {
        this.writeQueues.delete(projectId);
      }
    }
  }
}
