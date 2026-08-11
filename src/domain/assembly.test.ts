import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyAssemblyOperations,
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
});

async function representativeCircuit() {
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../tests/fixtures/circuits/led-current-limiter.json",
  );
  return CircuitDocumentSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
}
