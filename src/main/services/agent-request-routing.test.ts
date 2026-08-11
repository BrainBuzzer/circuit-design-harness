import { describe, expect, it } from "vitest";
import { startLessonProgress } from "@domain/lesson";
import { getStarterLessons } from "@domain/lesson-fixtures";
import { buildAgentRequestRouting, stripHarnessInjectedContext } from "./agent-request-routing";

describe("buildAgentRequestRouting", () => {
  it("routes beginner LED/button prompts to Mode A lab coach, not freeform invent", () => {
    const led = buildAgentRequestRouting("Help me wire an LED blink on Arduino Uno");
    expect(led).toContain("Mode A lab coach");
    expect(led).toContain("uno-led-series-resistor");
    expect(led).toContain("start_lab_lesson");
    expect(led).not.toContain("call propose_circuit_changes now");

    const button = buildAgentRequestRouting("teach me esp32 button and buzzer");
    expect(button).toContain("esp32s3-button-active-buzzer");
    expect(button).toMatch(/Do NOT call propose_circuit_changes/i);
  });

  it("routes firmware requests on an active lesson to golden apply, not invent", () => {
    const progress = startLessonProgress(getStarterLessons(), "uno-led-series-resistor");
    const routing = buildAgentRequestRouting({
      text: "load the golden sketch and compile",
      progress,
    });
    expect(routing).toContain("apply_lab_lesson_firmware");
    expect(routing).toContain("uno-led-series-resistor");
    expect(routing).toMatch(/Do NOT invent/i);
    expect(routing).toContain("setup-arduino-cli");
  });

  it("binds check-my-build to the active lesson step checklist", () => {
    const progress = startLessonProgress(getStarterLessons(), "uno-led-series-resistor");
    const routing = buildAgentRequestRouting({
      text: "check my build",
      progress,
      visualRequest: true,
    });
    expect(routing).toContain("Mode A lab coach is active");
    expect(routing).toContain("uno-led-series-resistor");
    expect(routing).toContain("cameraChecklist");
    expect(routing).toContain("Do not call propose_circuit_changes");
    expect(routing).toMatch(/cannot establish hidden connectivity/i);
    const step0 = getStarterLessons().find((l) => l.id === "uno-led-series-resistor")!.steps[0]!;
    expect(routing).toContain(step0.id);
  });

  it("keeps ESP32 Pomodoro as advanced freeform path when no coach lesson is active", () => {
    const routing = buildAgentRequestRouting("I need you to use ESP32 to create a Pomodoro timer.");
    expect(routing).toContain("call propose_circuit_changes now");
    expect(routing).toContain("Advanced sandbox path");
    expect(routing).toContain("requires separate explicit user approval");
  });

  it("does not force a proposal for unrelated or explanatory prompts", () => {
    expect(buildAgentRequestRouting("Explain how a Pomodoro timer works.")).toBeUndefined();
    expect(buildAgentRequestRouting("What is Ohm's law?")).toBeUndefined();
  });

  it("prefers active coach over Pomodoro invent when a lesson is already active", () => {
    const progress = startLessonProgress(getStarterLessons(), "esp32s3-led-series-resistor");
    const routing = buildAgentRequestRouting({
      text: "I need you to use ESP32 to create a Pomodoro timer.",
      progress,
    });
    expect(routing).toContain("lab coach is active");
    expect(routing).toContain("esp32s3-led-series-resistor");
    expect(routing).not.toContain("call propose_circuit_changes now");
  });

  it("keeps harness-only routing and voice context out of the visible transcript", () => {
    expect(
      stripHarnessInjectedContext(
        "Create it.\n\n<circuit-harness-request-routing>internal</circuit-harness-request-routing>\n\n<circuit-harness-voice-style>focused</circuit-harness-voice-style>",
      ),
    ).toBe("Create it.");
  });
});
