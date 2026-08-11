import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAssemblyOperations,
  buildBreadboardOccupancy,
  createEmptyAssemblyDocument,
  migrateAssemblyDocument,
  validateAssembly,
} from "./assembly";
import { CircuitDocumentSchema } from "./circuit";

const V1 = "00000000-0000-4000-8000-000000000001";
const R1 = "00000000-0000-4000-8000-000000000002";
const D1 = "00000000-0000-4000-8000-000000000003";
const GND1 = "00000000-0000-4000-8000-000000000004";

describe("assembly domain", () => {
  it("maps the representative circuit onto breadboard terminal strips", async () => {
    const circuit = await representativeCircuit();
    const operations = [
      [V1, "positive", "a1"],
      [R1, "1", "b1"],
      [R1, "2", "a2"],
      [D1, "anode", "b2"],
      [D1, "cathode", "a3"],
      [V1, "negative", "b3"],
      [GND1, "ground", "c3"],
    ].map(([componentId, pinId, hole]) => ({
      type: "place_component_pin" as const,
      componentId: componentId ?? "",
      pinId: pinId ?? "",
      hole: hole ?? "",
    }));
    const result = applyAssemblyOperations(createEmptyAssemblyDocument(), circuit, operations);
    expect(result.document.revision).toBe(1);
    expect(result.document.circuitRevision).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });

  it("detects physical shorts and incomplete logical connectivity", async () => {
    const circuit = await representativeCircuit();
    const shorted = {
      ...createEmptyAssemblyDocument(1),
      placements: [
        { componentId: V1, pins: [{ pinId: "positive", hole: "a1" }] },
        { componentId: R1, pins: [{ pinId: "2", hole: "b1" }] },
      ],
    };
    expect(validateAssembly(shorted, circuit).map((diagnostic) => diagnostic.code)).toContain(
      "physical_short",
    );

    const disconnected = {
      ...createEmptyAssemblyDocument(1),
      placements: [
        { componentId: V1, pins: [{ pinId: "positive", hole: "a1" }] },
        { componentId: R1, pins: [{ pinId: "1", hole: "a2" }] },
      ],
    };
    expect(validateAssembly(disconnected, circuit).map((diagnostic) => diagnostic.code)).toContain(
      "logical_net_not_connected",
    );
  });

  it("migrates the empty version-one placeholder", () => {
    expect(
      migrateAssemblyDocument({
        schemaVersion: 1,
        circuitRevision: 7,
        placements: [],
        observations: [],
      }),
    ).toMatchObject({
      schemaVersion: 2,
      revision: 0,
      circuitRevision: 7,
      placements: [],
      jumpers: [],
    });
  });

  it("places pins and jumpers, then rejects occupied holes and missing jumper removal", async () => {
    const circuit = await representativeCircuit();
    const jumperId = "00000000-0000-4000-8000-0000000000aa";
    const placed = applyAssemblyOperations(createEmptyAssemblyDocument(1), circuit, [
      { type: "place_component_pin", componentId: V1, pinId: "positive", hole: "a1" },
      { type: "place_component_pin", componentId: R1, pinId: "1", hole: "b1" },
      {
        type: "add_jumper",
        jumperId,
        from: "a5",
        to: "top+5",
        color: "red",
      },
    ]);
    expect(placed.document.placements).toHaveLength(2);
    expect(placed.document.jumpers).toEqual([
      { id: jumperId, from: "a5", to: "top+5", color: "red" },
    ]);

    expect(() =>
      applyAssemblyOperations(placed.document, circuit, [
        { type: "place_component_pin", componentId: D1, pinId: "anode", hole: "a1" },
      ]),
    ).toThrow(/already occupied/i);

    expect(() =>
      applyAssemblyOperations(placed.document, circuit, [
        {
          type: "remove_jumper",
          jumperId: "00000000-0000-4000-8000-0000000000bb",
        },
      ]),
    ).toThrow(/does not exist/i);

    const removed = applyAssemblyOperations(placed.document, circuit, [
      { type: "remove_jumper", jumperId },
    ]);
    expect(removed.document.jumpers).toEqual([]);
  });

  it("builds an occupancy map the breadboard editor uses for pins and jumpers", async () => {
    const circuit = await representativeCircuit();
    const jumperId = "00000000-0000-4000-8000-0000000000aa";
    const placed = applyAssemblyOperations(createEmptyAssemblyDocument(1), circuit, [
      { type: "place_component_pin", componentId: V1, pinId: "positive", hole: "a1" },
      { type: "place_component_pin", componentId: R1, pinId: "1", hole: "b1" },
      { type: "add_jumper", jumperId, from: "a5", to: "top+5", color: "red" },
    ]);
    const occupied = buildBreadboardOccupancy(placed.document, circuit);
    expect(occupied.get("a1")).toBe("V1.positive");
    expect(occupied.get("b1")).toBe("R1.1");
    expect(occupied.get("a5")).toBe("J1");
    expect(occupied.get("top+5")).toBe("J1");
  });
});

async function representativeCircuit() {
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../tests/fixtures/circuits/led-current-limiter.json",
  );
  return CircuitDocumentSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
}
