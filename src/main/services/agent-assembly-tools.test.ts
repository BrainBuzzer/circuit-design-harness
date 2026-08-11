import { applyCircuitOperations, createEmptyCircuitDocument } from "@domain/circuit";
import { describe, expect, it } from "vitest";
import { compileAgentAssemblyOperations } from "./agent-assembly-tools";
import { compileAgentOperations } from "./agent-circuit-tools";

describe("compileAgentAssemblyOperations", () => {
  it("resolves visible component references into bounded canonical assembly operations", () => {
    const circuit = applyCircuitOperations(
      createEmptyCircuitDocument(),
      compileAgentOperations(createEmptyCircuitDocument(), [
        {
          type: "add_component",
          reference: "R1",
          kind: "resistor",
          value: "330 Ω",
          position: { x: 100, y: 100 },
        },
      ]),
    ).document;

    const operations = compileAgentAssemblyOperations(circuit, [
      { type: "place_component_pin", componentReference: "R1", pinId: "1", hole: "a1" },
      { type: "add_jumper", from: "b1", to: "b2", color: "blue" },
    ]);
    expect(operations[0]).toMatchObject({
      type: "place_component_pin",
      componentId: circuit.components[0]?.id,
      pinId: "1",
      hole: "a1",
    });
    expect(operations[1]).toMatchObject({ type: "add_jumper", from: "b1", to: "b2" });
    expect(operations[1]).toHaveProperty("jumperId");
  });

  it("rejects an assembly edit for an unknown circuit reference", () => {
    expect(() =>
      compileAgentAssemblyOperations(createEmptyCircuitDocument(), [
        { type: "remove_component_placement", componentReference: "U99" },
      ]),
    ).toThrow("Component reference U99 does not exist");
  });
});
