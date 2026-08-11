import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCircuitOperations,
  CircuitDocumentSchema,
  CircuitTransactionError,
  createEmptyCircuitDocument,
  migrateCircuitDocument,
  validateCircuit,
} from "./circuit";

const SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const RESISTOR_ID = "00000000-0000-4000-8000-000000000002";
const LED_ID = "00000000-0000-4000-8000-000000000003";

describe("circuit domain", () => {
  it("adds a built-in IC with its manufacturer pin map", () => {
    const result = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: "00000000-0000-4000-8000-000000000099",
        reference: "U1",
        kind: "ic",
        value: "SN74HC595",
        modelId: "sn74hc595",
        position: { x: 100, y: 100 },
        rotation: 0,
      },
    ]);
    expect(result.document.components[0]?.modelId).toBe("sn74hc595");
    expect(result.document.components[0]?.pins).toHaveLength(16);
    expect(result.document.components[0]?.pins[13]?.id).toBe("SER");
  });

  it("accepts the representative current-limited LED circuit", async () => {
    const fixturePath = path.resolve(
      import.meta.dirname,
      "../../tests/fixtures/circuits/led-current-limiter.json",
    );
    const document = CircuitDocumentSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));

    expect(validateCircuit(document)).toEqual([]);
  });

  it("applies typed operations as one revision and rejects a shorted source", () => {
    const { document } = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: SOURCE_ID,
        reference: "V1",
        kind: "dc_source",
        value: "5 V",
        position: { x: 100, y: 100 },
        rotation: 0,
      },
      {
        type: "add_component",
        componentId: RESISTOR_ID,
        reference: "R1",
        kind: "resistor",
        value: "330 Ω",
        position: { x: 300, y: 100 },
        rotation: 0,
      },
      {
        type: "add_component",
        componentId: LED_ID,
        reference: "D1",
        kind: "led",
        value: "red",
        position: { x: 500, y: 100 },
        rotation: 0,
      },
    ]);

    expect(document.revision).toBe(1);
    expect(document.components.map((component) => component.reference)).toEqual(["V1", "R1", "D1"]);

    expect(() =>
      applyCircuitOperations(document, [
        {
          type: "connect_terminals",
          netId: "10000000-0000-4000-8000-000000000001",
          name: "SHORT",
          terminals: [
            { componentId: SOURCE_ID, pinId: "positive" },
            { componentId: SOURCE_ID, pinId: "negative" },
          ],
        },
      ]),
    ).toThrowError(CircuitTransactionError);
  });

  it("reports open pins, duplicate references, and invalid pin IDs", () => {
    const openCircuit = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: RESISTOR_ID,
        reference: "R1",
        kind: "resistor",
        value: "1 kΩ",
        position: { x: 100, y: 100 },
        rotation: 0,
      },
    ]).document;
    expect(validateCircuit(openCircuit).map((diagnostic) => diagnostic.code)).toEqual([
      "unconnected_pin",
      "unconnected_pin",
    ]);

    const invalidDocument = CircuitDocumentSchema.parse({
      ...openCircuit,
      components: [
        ...openCircuit.components,
        {
          ...openCircuit.components[0],
          id: LED_ID,
          reference: "R1",
        },
      ],
      nets: [
        {
          id: "10000000-0000-4000-8000-000000000005",
          name: "INVALID",
          terminals: [
            { componentId: RESISTOR_ID, pinId: "not-a-pin" },
            { componentId: LED_ID, pinId: "1" },
          ],
        },
      ],
      schematic: {
        ...openCircuit.schematic,
        placements: [
          ...openCircuit.schematic.placements,
          { componentId: LED_ID, position: { x: 300, y: 100 }, rotation: 0 },
        ],
      },
    });
    const codes = validateCircuit(invalidDocument).map((diagnostic) => diagnostic.code);
    expect(codes).toContain("duplicate_reference");
    expect(codes).toContain("unknown_pin");
  });

  it("merges existing nets without dropping their other terminals", () => {
    const fixture = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: SOURCE_ID,
        reference: "V1",
        kind: "dc_source",
        value: "5 V",
        position: { x: 100, y: 100 },
        rotation: 0,
      },
      {
        type: "add_component",
        componentId: RESISTOR_ID,
        reference: "R1",
        kind: "resistor",
        value: "330 Ω",
        position: { x: 300, y: 100 },
        rotation: 0,
      },
      {
        type: "add_component",
        componentId: LED_ID,
        reference: "D1",
        kind: "led",
        value: "red",
        position: { x: 500, y: 100 },
        rotation: 0,
      },
      {
        type: "connect_terminals",
        netId: "10000000-0000-4000-8000-000000000010",
        terminals: [
          { componentId: SOURCE_ID, pinId: "positive" },
          { componentId: RESISTOR_ID, pinId: "1" },
        ],
      },
    ]).document;

    const merged = applyCircuitOperations(fixture, [
      {
        type: "connect_terminals",
        netId: "10000000-0000-4000-8000-000000000011",
        terminals: [
          { componentId: RESISTOR_ID, pinId: "1" },
          { componentId: LED_ID, pinId: "anode" },
        ],
      },
    ]).document;
    expect(merged.nets).toHaveLength(1);
    expect(merged.nets[0]?.terminals).toHaveLength(3);
  });

  it("migrates the empty version-one foundation without changing its revision", () => {
    expect(
      migrateCircuitDocument({
        schemaVersion: 1,
        revision: 7,
        components: [],
        nets: [],
        constraints: [],
      }),
    ).toEqual({
      schemaVersion: 3,
      revision: 7,
      components: [],
      nets: [],
      constraints: [],
      schematic: {
        placements: [],
        metadata: {
          title: "Untitled circuit",
          subtitle: "",
          author: "",
          documentNumber: "",
          paperSize: "a4",
          orientation: "landscape",
        },
      },
    });
  });

  it("backs up schema evolution by migrating a populated version-two design", () => {
    const resistor = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: RESISTOR_ID,
        reference: "R1",
        kind: "resistor",
        value: "10 kΩ",
        position: { x: 120, y: 80 },
        rotation: 90,
      },
    ]).document;
    const migrated = migrateCircuitDocument({
      ...resistor,
      schemaVersion: 2,
      schematic: { placements: resistor.schematic.placements },
    });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.components[0]?.reference).toBe("R1");
    expect(migrated.schematic.placements[0]?.rotation).toBe(90);
    expect(migrated.schematic.metadata.title).toBe("Untitled circuit");
  });

  it("creates explicit passive pins for the expanded generic component catalog", () => {
    const kinds = [
      ["capacitor", "C1", "100 nF", ["1", "2"]],
      ["inductor", "L1", "10 µH", ["1", "2"]],
      ["diode", "D1", "generic", ["anode", "cathode"]],
      ["switch", "SW1", "SPST", ["1", "2"]],
    ] as const;
    const operations = kinds.map(([kind, reference, value], index) => ({
      type: "add_component" as const,
      componentId: `00000000-0000-4000-8000-00000000001${index}`,
      reference,
      kind,
      value,
      position: { x: 100 + index * 120, y: 100 },
      rotation: 0 as const,
    }));
    const { document } = applyCircuitOperations(createEmptyCircuitDocument(), operations);

    expect(
      document.components.map((component) => [
        component.kind,
        component.reference,
        component.pins.map((pin) => pin.id),
      ]),
    ).toEqual(kinds.map(([kind, reference, , pins]) => [kind, reference, pins]));
  });
});
