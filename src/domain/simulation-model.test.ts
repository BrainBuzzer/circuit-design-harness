import { describe, expect, it } from "vitest";
import { SimulationModelProposalSchema } from "./simulation-model";

const validProposal = {
  schemaVersion: 1,
  id: "example-sensor",
  revision: 1,
  name: "Example sensor",
  manufacturer: "Example",
  partNumber: "EX-1",
  targets: ["arduino_uno_r3"],
  pins: [
    { id: "IN", name: "Input", role: "digital_input" },
    { id: "OUT", name: "Output", role: "digital_output" },
  ],
  electrical: { recommendedMinVoltage: 3, recommendedMaxVoltage: 5, absoluteMaxVoltage: 5.5 },
  behavior: {
    kind: "digital_gpio",
    inputPins: ["IN"],
    outputPins: ["OUT"],
    truthTable: [
      { when: { IN: 0 }, outputs: { OUT: 1 } },
      { when: { IN: 1 }, outputs: { OUT: 0 } },
    ],
  },
  limitations: ["Timing is not modeled."],
  provenance: [
    {
      attachmentId: "00000000-0000-4000-8000-000000000001",
      pageNumber: 1,
      claim: "Pin and voltage table.",
      confidence: "high",
    },
  ],
} as const;

describe("simulation model pack schema", () => {
  it("accepts a strict declarative model", () => {
    expect(SimulationModelProposalSchema.parse(validProposal).id).toBe("example-sensor");
  });

  it("rejects executable and network-bearing extensions", () => {
    expect(
      SimulationModelProposalSchema.safeParse({
        ...validProposal,
        script: "fetch('https://example.com/model.js')",
      }).success,
    ).toBe(false);
  });

  it("rejects behavior references to unknown pins and invalid voltage ranges", () => {
    const parsed = SimulationModelProposalSchema.safeParse({
      ...validProposal,
      electrical: { recommendedMinVoltage: 6, recommendedMaxVoltage: 5 },
      behavior: {
        kind: "digital_gpio",
        inputPins: ["MISSING"],
        outputPins: ["OUT"],
        truthTable: [{ when: { MISSING: 0 }, outputs: { OUT: 1 } }],
      },
    });
    expect(parsed.success).toBe(false);
  });
});
