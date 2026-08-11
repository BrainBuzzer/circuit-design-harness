import { describe, expect, it } from "vitest";
import { buildAgentRequestRouting, stripHarnessInjectedContext } from "./agent-request-routing";

describe("buildAgentRequestRouting", () => {
  it("routes the exact natural-language ESP32 Pomodoro creation intent", () => {
    const routing = buildAgentRequestRouting("I need you to use ESP32 to create a Pomodoro timer.");
    expect(routing).toContain("call propose_circuit_changes now");
    expect(routing).toContain("requires separate explicit user approval");
  });

  it("does not force a proposal for unrelated or explanatory prompts", () => {
    expect(buildAgentRequestRouting("Explain how a Pomodoro timer works.")).toBeUndefined();
    expect(buildAgentRequestRouting("Create an Arduino LED circuit.")).toBeUndefined();
  });

  it("keeps harness-only routing and voice context out of the visible transcript", () => {
    expect(
      stripHarnessInjectedContext(
        "Create it.\n\n<circuit-harness-request-routing>internal</circuit-harness-request-routing>\n\n<circuit-harness-voice-style>focused</circuit-harness-voice-style>",
      ),
    ).toBe("Create it.");
  });
});
