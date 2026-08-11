import { describe, expect, it } from "vitest";
import type { CircuitDocument } from "./circuit";
import { runCircuitModelScenario } from "./circuit-simulation";

const NAND_ID = "00000000-0000-4000-8000-000000000001";
const INVERTER_ID = "00000000-0000-4000-8000-000000000002";

describe("circuit functional model scenarios", () => {
  it("propagates signals through connected built-in ICs and passes assertions", () => {
    const result = runCircuitModelScenario(circuit(), {
      stimuli: { A: 1, B: 1 },
      risingEdges: [],
      initialState: {},
      assertions: [{ net: "OUT", equals: 1, label: "double inversion" }],
    });
    expect(result.outcome).toBe("passed");
    expect(result.converged).toBe(true);
    expect(result.signals).toMatchObject({ A: 1, B: 1, NAND_OUT: 0, OUT: 1 });
    expect(result.assertions[0]?.passed).toBe(true);
    expect(result.evaluatedComponents).toEqual(["U1", "U2"]);
  });

  it("reports conflicting drivers and failed expectations", () => {
    const result = runCircuitModelScenario(circuit(), {
      stimuli: { A: 1, B: 1, OUT: 0 },
      risingEdges: [],
      initialState: {},
      assertions: [{ net: "OUT", equals: 1 }],
    });
    expect(result.outcome).toBe("failed");
    expect(result.signals.OUT).toBe("x");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "conflicting_drivers",
    );
  });

  it("blocks unknown nets and edge terminals before evaluation", () => {
    const result = runCircuitModelScenario(circuit(), {
      stimuli: { MISSING: 1 },
      risingEdges: [{ componentReference: "U1", pinId: "MISSING" }],
      initialState: {},
      assertions: [],
    });
    expect(result.outcome).toBe("blocked");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["unknown_stimulus_net", "unknown_edge_pin"]),
    );
  });
});

function circuit(): CircuitDocument {
  return {
    schemaVersion: 3,
    revision: 1,
    components: [
      {
        id: NAND_ID,
        reference: "U1",
        kind: "ic",
        value: "SN74HC00",
        modelId: "sn74hc00",
        pins: [
          { id: "1A", name: "1A", electricalType: "power_in" },
          { id: "1B", name: "1B", electricalType: "power_in" },
          { id: "1Y", name: "1Y", electricalType: "power_out" },
        ],
      },
      {
        id: INVERTER_ID,
        reference: "U2",
        kind: "ic",
        value: "SN74HC04",
        modelId: "sn74hc04",
        pins: [
          { id: "1A", name: "1A", electricalType: "power_in" },
          { id: "1Y", name: "1Y", electricalType: "power_out" },
        ],
      },
    ],
    nets: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        name: "A",
        terminals: [{ componentId: NAND_ID, pinId: "1A" }],
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        name: "B",
        terminals: [{ componentId: NAND_ID, pinId: "1B" }],
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        name: "NAND_OUT",
        terminals: [
          { componentId: NAND_ID, pinId: "1Y" },
          { componentId: INVERTER_ID, pinId: "1A" },
        ],
      },
      {
        id: "00000000-0000-4000-8000-000000000014",
        name: "OUT",
        terminals: [{ componentId: INVERTER_ID, pinId: "1Y" }],
      },
    ],
    constraints: [],
    schematic: {
      metadata: {
        title: "Logic scenario",
        subtitle: "",
        author: "",
        documentNumber: "",
        paperSize: "a4",
        orientation: "landscape",
      },
      placements: [
        { componentId: NAND_ID, position: { x: 100, y: 100 }, rotation: 0 },
        { componentId: INVERTER_ID, position: { x: 300, y: 100 }, rotation: 0 },
      ],
    },
  };
}
