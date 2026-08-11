import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoachService } from "./coach-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(): Promise<{
  projects: ProjectService;
  projectId: string;
  projectDirectory: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cdh-coach-"));
  temporaryDirectories.push(root);
  const settingsPath = path.join(root, "settings.json");
  const projects = new ProjectService(settingsPath, path.join(root, "projects"));
  await projects.initialize();
  const state = await projects.createProject("Coach Lab");
  const projectId = state.activeProjectId;
  if (!projectId) {
    throw new Error("expected active project");
  }
  const projectDirectory = await projects.getProjectDirectory(projectId);
  return { projects, projectId, projectDirectory };
}

describe("CoachService", () => {
  it("lists golden lessons and persists start/advance/goTo/clear for both boards", async () => {
    const fixture = await createFixture();
    const coach = new CoachService(fixture.projects);

    const empty = await coach.getSnapshot(fixture.projectId);
    expect(empty.progress.lessonId).toBeNull();
    expect(empty.lessons.length).toBeGreaterThanOrEqual(5);
    expect(empty.lessons.some((lesson) => lesson.board === "arduino_uno_r3")).toBe(true);
    expect(empty.lessons.some((lesson) => lesson.board === "esp32s3")).toBe(true);

    const started = await coach.startLesson(fixture.projectId, "uno-led-series-resistor");
    expect(started.activeLesson?.id).toBe("uno-led-series-resistor");
    expect(started.activeStep?.id).toBe(started.activeLesson?.steps[0]?.id);
    expect(started.stepNumber).toBe(1);
    expect(started.activeStep?.cameraChecklist.length).toBeGreaterThan(0);

    const onDisk = JSON.parse(
      await readFile(path.join(fixture.projectDirectory, "coach.json"), "utf8"),
    );
    expect(onDisk.lessonId).toBe("uno-led-series-resistor");
    expect(onDisk.stepIndex).toBe(0);

    const advanced = await coach.advance(fixture.projectId);
    expect(advanced.stepIndex).toBe(1);
    expect(advanced.stepNumber).toBe(2);

    const context = await coach.getActiveStepContextPayload(fixture.projectId);
    expect(context?.mode).toBe("lab_coach");
    expect(context?.stepId).toBe(advanced.activeStep?.id);
    expect(context?.cameraChecklist).toEqual(advanced.activeStep?.cameraChecklist);

    const esp = await coach.startLesson(fixture.projectId, "esp32s3-led-series-resistor");
    expect(esp.activeLesson?.board).toBe("esp32s3");
    const jumped = await coach.goToStep(fixture.projectId, 1);
    expect(jumped.stepIndex).toBe(1);

    const cleared = await coach.clear(fixture.projectId);
    expect(cleared.progress.lessonId).toBeNull();
    expect(await coach.getActiveStepContextText(fixture.projectId)).toBeUndefined();
  });

  it("rejects unknown lesson ids on the real service path", async () => {
    const fixture = await createFixture();
    const coach = new CoachService(fixture.projects);
    await expect(coach.startLesson(fixture.projectId, "not-a-lesson")).rejects.toThrow(
      /Unknown lesson/,
    );
  });
});
