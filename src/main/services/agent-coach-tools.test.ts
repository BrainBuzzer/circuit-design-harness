import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentCoachTools, matchStarterLessonId } from "./agent-coach-tools";
import { CoachService } from "./coach-service";
import { FirmwareService } from "./firmware-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createCoach(): Promise<{
  projectId: string;
  coach: CoachService;
  firmware: FirmwareService;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cdh-coach-tools-"));
  temporaryDirectories.push(root);
  const projects = new ProjectService(
    path.join(root, "settings.json"),
    path.join(root, "projects"),
  );
  await projects.initialize();
  const state = await projects.createProject("Tools");
  const projectId = state.activeProjectId;
  if (!projectId) {
    throw new Error("expected project");
  }
  const firmware = new FirmwareService(projects, async () => ({
    outcome: "passed",
    output: "mock arduino-cli ok",
  }));
  return { projectId, coach: new CoachService(projects), firmware };
}

async function executeTool(
  tools: ReturnType<typeof createAgentCoachTools>,
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ text: string; details: unknown }> {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing tool ${name}`);
  }
  // ToolDefinition.execute requires signal/onUpdate/ctx; unit tests invoke the real
  // tool bodies with empty session context.
  const result = await tool.execute("call-1", params as never, undefined, undefined, {} as never);
  const textPart = result.content.find((part) => part.type === "text");
  if (textPart?.type !== "text") {
    throw new Error("expected text content");
  }
  return { text: textPart.text, details: result.details };
}

describe("createAgentCoachTools", () => {
  it("lists lessons, starts, explains, advances, and returns step-bound status", async () => {
    const { projectId, coach, firmware } = await createCoach();
    const tools = createAgentCoachTools(projectId, coach, firmware);

    const listed = await executeTool(tools, "list_lab_lessons");
    const listJson = JSON.parse(listed.text) as { lessons: { id: string; board: string }[] };
    expect(listJson.lessons.length).toBeGreaterThanOrEqual(5);
    expect(listJson.lessons.some((lesson) => lesson.board === "arduino_uno_r3")).toBe(true);
    expect(listJson.lessons.some((lesson) => lesson.board === "esp32s3")).toBe(true);

    const started = await executeTool(tools, "start_lab_lesson", {
      lessonId: "uno-led-series-resistor",
    });
    expect(JSON.parse(started.text).lessonId).toBe("uno-led-series-resistor");

    const status = await executeTool(tools, "get_lab_coach_status");
    const statusJson = JSON.parse(status.text) as {
      active: { stepId: string; cameraChecklist: string[]; lessonId: string };
    };
    expect(statusJson.active.lessonId).toBe("uno-led-series-resistor");
    expect(statusJson.active.cameraChecklist.length).toBeGreaterThan(0);
    expect(statusJson.active.stepId).toBeTruthy();

    const explained = await executeTool(tools, "explain_lab_step", {});
    const explainedJson = JSON.parse(explained.text) as {
      instruction: string;
      cameraChecklist: string[];
      teachingMode: string;
    };
    expect(explainedJson.teachingMode).toBe("lab_coach_golden_step");
    expect(explainedJson.instruction.length).toBeGreaterThan(10);
    expect(explainedJson.cameraChecklist).toEqual(statusJson.active.cameraChecklist);

    await executeTool(tools, "advance_lab_lesson_step");
    const after = await executeTool(tools, "get_lab_coach_status");
    expect(JSON.parse(after.text).active.stepId).not.toBe(statusJson.active.stepId);

    const esp = await executeTool(tools, "start_lab_lesson", {
      lessonId: "esp32s3-hcsr04-ultrasonic",
    });
    expect(JSON.parse(esp.text).lessonId).toBe("esp32s3-hcsr04-ultrasonic");

    const golden = await executeTool(tools, "get_lab_lesson_firmware", {
      lessonId: "uno-led-series-resistor",
    });
    const goldenJson = JSON.parse(golden.text) as { source: string; targetId: string };
    expect(goldenJson.targetId).toBe("arduino_uno_r3");
    expect(goldenJson.source).toMatch(/LED_PIN\s*=\s*13/);

    const applied = await executeTool(tools, "apply_lab_lesson_firmware", {
      lessonId: "uno-led-series-resistor",
      compile: true,
    });
    const appliedJson = JSON.parse(applied.text) as {
      applied: boolean;
      successCheck: string;
      result: { compilation: { outcome: string }; savedRelativePath: string };
    };
    expect(appliedJson.applied).toBe(true);
    expect(appliedJson.successCheck.length).toBeGreaterThan(10);
    expect(appliedJson.result.compilation.outcome).toBe("passed");
    expect(appliedJson.result.savedRelativePath).toContain("CircuitHarness.ino");
  });

  it("matchStarterLessonId uses golden fixtures", () => {
    expect(matchStarterLessonId("wire LED on uno")).toBe("uno-led-series-resistor");
    expect(matchStarterLessonId("esp32 ultrasonic sensor")).toBe("esp32s3-hcsr04-ultrasonic");
  });
});
