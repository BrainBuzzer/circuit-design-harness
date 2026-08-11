import { applyCircuitOperations, createEmptyCircuitDocument } from "@domain/circuit";
import { describe, expect, it } from "vitest";
import { compileAgentOperations, createPublicationLayoutOperations } from "./agent-circuit-tools";

describe("compileAgentOperations", () => {
  it("resolves human-readable references across a multi-operation proposal", () => {
    const operations = compileAgentOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        reference: "R1",
        kind: "resistor",
        value: "330 Ω",
        position: { x: 100, y: 100 },
      },
      {
        type: "add_component",
        reference: "D1",
        kind: "led",
        value: "red",
        position: { x: 260, y: 100 },
      },
      {
        type: "connect_terminals",
        name: "LED_CURRENT",
        terminals: [
          { componentReference: "R1", pinId: "2" },
          { componentReference: "D1", pinId: "anode" },
        ],
      },
    ]);

    const result = applyCircuitOperations(createEmptyCircuitDocument(), operations);
    expect(result.document.components.map((component) => component.reference)).toEqual([
      "R1",
      "D1",
    ]);
    expect(result.document.nets[0]?.terminals).toHaveLength(2);
    expect(result.document.revision).toBe(1);
  });

  it("rejects references that are not in the canonical design", () => {
    expect(() =>
      compileAgentOperations(createEmptyCircuitDocument(), [
        {
          type: "set_component_value",
          componentReference: "R99",
          value: "1 kΩ",
        },
      ]),
    ).toThrow("R99 does not exist");
  });

  it("supports common relay parts, net renaming, and publication metadata", () => {
    const initialOperations = compileAgentOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        reference: "K1",
        kind: "relay",
        value: "5 V SPDT",
        position: { x: 220, y: 160 },
      },
      {
        type: "add_component",
        reference: "V1",
        kind: "dc_source",
        value: "5 V",
        position: { x: 80, y: 160 },
      },
      {
        type: "connect_terminals",
        name: "COIL_POWER",
        terminals: [
          { componentReference: "V1", pinId: "positive" },
          { componentReference: "K1", pinId: "coil_a" },
        ],
      },
    ]);
    const initial = applyCircuitOperations(
      createEmptyCircuitDocument(),
      initialOperations,
    ).document;
    const refinement = compileAgentOperations(initial, [
      { type: "rename_net", netNameOrId: "COIL_POWER", name: "RELAY_COIL_5V" },
      {
        type: "set_schematic_metadata",
        title: "Relay driver",
        author: "A. Engineer",
        documentNumber: "PAPER-FIG-2",
      },
    ]);
    const result = applyCircuitOperations(initial, refinement).document;
    expect(result.nets[0]?.name).toBe("RELAY_COIL_5V");
    expect(result.schematic.metadata).toMatchObject({
      title: "Relay driver",
      author: "A. Engineer",
      documentNumber: "PAPER-FIG-2",
    });
    expect(result.components.find((component) => component.reference === "K1")?.pins).toHaveLength(
      5,
    );
  });

  it("lets Pi place and wire the typed ESP32-S3 development board", () => {
    const operations = compileAgentOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        reference: "MCU1",
        kind: "esp32s3_devkitc_1",
        value: "ESP32-S3-DevKitC-1 v1.1",
        position: { x: 220, y: 260 },
      },
      {
        type: "add_component",
        reference: "SW1",
        kind: "pushbutton_no",
        value: "Start / pause",
        position: { x: 480, y: 180 },
      },
      {
        type: "connect_terminals",
        name: "START_BUTTON",
        terminals: [
          { componentReference: "MCU1", pinId: "GPIO4" },
          { componentReference: "SW1", pinId: "1" },
        ],
      },
    ]);

    const result = applyCircuitOperations(createEmptyCircuitDocument(), operations).document;
    expect(
      result.components.find((component) => component.reference === "MCU1")?.pins,
    ).toHaveLength(44);
    expect(result.nets[0]?.name).toBe("START_BUTTON");
  });

  it("resolves a net created and renamed within the same agent proposal", () => {
    const operations = compileAgentOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        reference: "R1",
        kind: "resistor",
        position: { x: 100, y: 100 },
      },
      {
        type: "add_component",
        reference: "D1",
        kind: "led",
        position: { x: 260, y: 100 },
      },
      {
        type: "connect_terminals",
        name: "LED_NET",
        terminals: [
          { componentReference: "R1", pinId: "2" },
          { componentReference: "D1", pinId: "anode" },
        ],
      },
      { type: "rename_net", netNameOrId: "LED_NET", name: "STATUS_LED" },
    ]);

    const result = applyCircuitOperations(createEmptyCircuitDocument(), operations).document;
    expect(result.nets[0]?.name).toBe("STATUS_LED");
  });

  it("creates deterministic grid-aligned publication layout proposals", () => {
    const document = applyCircuitOperations(
      createEmptyCircuitDocument(),
      compileAgentOperations(createEmptyCircuitDocument(), [
        {
          type: "add_component",
          reference: "R10",
          kind: "resistor",
          position: { x: 900, y: 900 },
        },
        {
          type: "add_component",
          reference: "R2",
          kind: "resistor",
          position: { x: 800, y: 800 },
        },
      ]),
    ).document;
    const operations = createPublicationLayoutOperations(document, {
      columns: 2,
      horizontalSpacing: 180,
      verticalSpacing: 150,
    });
    expect(operations.map((operation) => operation.type)).toEqual([
      "move_component",
      "move_component",
    ]);
    expect(
      operations.map((operation) =>
        operation.type === "move_component" ? operation.position : undefined,
      ),
    ).toEqual([
      { x: 140, y: 120 },
      { x: 320, y: 120 },
    ]);
  });
});
