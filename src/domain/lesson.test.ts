import { describe, expect, it } from "vitest";
import {
  advanceLessonProgress,
  buildCoachStepContextPayload,
  clearLessonProgress,
  goToLessonStep,
  isBeginnerBuildIntent,
  LessonSchema,
  matchLessonFromText,
  parseLesson,
  resolveActiveLessonStep,
  startLessonProgress,
  validateLessonCatalog,
} from "./lesson";
import { getStarterLessonById, getStarterLessons, STARTER_LESSONS } from "./lesson-fixtures";

describe("lesson fixtures", () => {
  it("validates every shipped starter lesson through the real schema", () => {
    expect(STARTER_LESSONS.length).toBeGreaterThanOrEqual(5);
    validateLessonCatalog(STARTER_LESSONS);

    const boards = new Set(STARTER_LESSONS.map((lesson) => lesson.board));
    expect(boards.has("arduino_uno_r3")).toBe(true);
    expect(boards.has("esp32s3")).toBe(true);

    for (const lesson of getStarterLessons()) {
      expect(lesson.parts.length).toBeGreaterThanOrEqual(1);
      expect(lesson.commonMistakes.length).toBeGreaterThanOrEqual(1);
      expect(lesson.steps.length).toBeGreaterThanOrEqual(1);
      for (const step of lesson.steps) {
        expect(step.cameraChecklist.length).toBeGreaterThanOrEqual(1);
        expect(step.instruction.length).toBeGreaterThan(10);
        expect(step.referenceSummary.length).toBeGreaterThan(5);
      }
    }
  });

  it("rejects invalid lessons", () => {
    expect(() =>
      parseLesson({
        schemaVersion: 1,
        id: "bad",
        title: "Bad",
        summary: "x",
        board: "arduino_uno_r3",
        difficulty: "starter",
        learningGoals: ["g"],
        parts: [{ id: "p", name: "Part", quantity: 1 }],
        pinMap: [{ signal: "s", boardPin: "D1" }],
        breadboardIntent: "intent",
        commonMistakes: ["m"],
        limitations: ["l"],
        steps: [],
        keywords: ["led"],
      }),
    ).toThrow();

    expect(() =>
      parseLesson({
        ...STARTER_LESSONS[0],
        id: "Not Valid",
      }),
    ).toThrow();
  });

  it("rejects duplicate lesson ids in a catalog", () => {
    const first = STARTER_LESSONS[0];
    expect(first).toBeDefined();
    expect(() => validateLessonCatalog([first!, first!])).toThrow(/Duplicate lesson id/);
  });
});

describe("coach progress helpers", () => {
  const lessons = getStarterLessons();
  const unoLed = getStarterLessonById("uno-led-series-resistor");
  const espLed = getStarterLessonById("esp32s3-led-series-resistor");

  it("starts, resolves, and advances steps on Uno and ESP32-S3 lessons", () => {
    expect(unoLed).toBeDefined();
    expect(espLed).toBeDefined();

    let progress = startLessonProgress(lessons, "uno-led-series-resistor");
    let active = resolveActiveLessonStep(lessons, progress);
    expect(active?.lesson.board).toBe("arduino_uno_r3");
    expect(active?.stepIndex).toBe(0);
    expect(active?.step.id).toBe(unoLed!.steps[0]!.id);

    progress = advanceLessonProgress(lessons, progress);
    active = resolveActiveLessonStep(lessons, progress);
    expect(active?.stepIndex).toBe(1);
    expect(active?.stepNumber).toBe(2);

    progress = startLessonProgress(lessons, "esp32s3-led-series-resistor");
    active = resolveActiveLessonStep(lessons, progress);
    expect(active?.lesson.board).toBe("esp32s3");
    expect(active?.step.cameraChecklist.length).toBeGreaterThan(0);

    const payload = buildCoachStepContextPayload(active!);
    expect(payload.mode).toBe("lab_coach");
    expect(payload.lessonId).toBe("esp32s3-led-series-resistor");
    expect(payload.stepId).toBe(espLed!.steps[0]!.id);
    expect(payload.cameraChecklist).toEqual(espLed!.steps[0]!.cameraChecklist);
    expect(String(payload.claimBoundary)).toMatch(/cannot prove hidden connectivity/i);
  });

  it("stays on the last step when advancing at end of lesson", () => {
    let progress = startLessonProgress(lessons, "uno-pushbutton-input");
    const lesson = getStarterLessonById("uno-pushbutton-input")!;
    progress = goToLessonStep(lessons, progress, lesson.steps.length - 1);
    const before = progress.stepIndex;
    progress = advanceLessonProgress(lessons, progress);
    expect(progress.stepIndex).toBe(before);
    expect(resolveActiveLessonStep(lessons, progress)?.isLastStep).toBe(true);
  });

  it("rejects bad lesson and step ids", () => {
    expect(() => startLessonProgress(lessons, "no-such-lesson")).toThrow(/Unknown lesson/);
    const progress = startLessonProgress(lessons, "uno-led-series-resistor");
    expect(() => goToLessonStep(lessons, progress, 99)).toThrow(/out of range/);
    expect(() => advanceLessonProgress(lessons, clearLessonProgress())).toThrow(
      /No active lesson step/,
    );
  });

  it("clears progress", () => {
    const cleared = clearLessonProgress();
    expect(cleared.lessonId).toBeNull();
    expect(resolveActiveLessonStep(lessons, cleared)).toBeUndefined();
  });
});

describe("lesson matching and beginner intent", () => {
  const lessons = getStarterLessons();

  it("matches beginner prompts to golden lessons for both boards", () => {
    expect(matchLessonFromText(lessons, "Help me wire an LED blink on Arduino Uno")?.id).toBe(
      "uno-led-series-resistor",
    );
    expect(matchLessonFromText(lessons, "ESP32-S3 button and buzzer please")?.id).toBe(
      "esp32s3-button-active-buzzer",
    );
    expect(matchLessonFromText(lessons, "uno potentiometer on A0")?.id).toBe(
      "uno-potentiometer-analog",
    );
    expect(matchLessonFromText(lessons, "esp32 ultrasonic hc-sr04")?.id).toBe(
      "esp32s3-hcsr04-ultrasonic",
    );
  });

  it("does not invent a match for unrelated text", () => {
    expect(matchLessonFromText(lessons, "What is the weather in Paris?")).toBeUndefined();
  });

  it("detects beginner build intent without treating Pomodoro as coach-default invent", () => {
    expect(isBeginnerBuildIntent("teach me to wire an LED")).toBe(true);
    expect(isBeginnerBuildIntent("check my build")).toBe(true);
    expect(isBeginnerBuildIntent("I need you to use ESP32 to create a Pomodoro timer")).toBe(false);
  });

  it("round-trips schema parse on fixture JSON clones", () => {
    for (const lesson of lessons) {
      const clone = JSON.parse(JSON.stringify(lesson));
      expect(LessonSchema.parse(clone).id).toBe(lesson.id);
    }
  });
});
