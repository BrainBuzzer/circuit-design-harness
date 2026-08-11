import { describe, expect, it } from "vitest";
import { applyCircuitOperations, createEmptyCircuitDocument } from "./circuit";
import { COMPONENT_CATALOG, PART_KIND_IDS } from "./component-catalog";
import { buildSchematicScene } from "./schematic-geometry";

describe("component catalog", () => {
  it("keeps every kind unique, documented, pinned, and renderable", () => {
    expect(new Set(PART_KIND_IDS).size).toBe(PART_KIND_IDS.length);
    expect(COMPONENT_CATALOG.map((entry) => entry.id)).toEqual(PART_KIND_IDS);
    expect(COMPONENT_CATALOG.length).toBeGreaterThanOrEqual(40);

    const genericEntries = COMPONENT_CATALOG.filter((entry) => entry.id !== "ic");
    const operations = genericEntries.map((entry, index) => ({
      type: "add_component" as const,
      componentId: `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000001`,
      reference: `${entry.referencePrefix}${index + 1}`,
      kind: entry.id,
      ...(entry.defaultValue ? { value: entry.defaultValue } : {}),
      position: { x: 120 + (index % 6) * 160, y: 100 + Math.floor(index / 6) * 140 },
      rotation: ((index % 4) * 90) as 0 | 90 | 180 | 270,
    }));
    const document = applyCircuitOperations(createEmptyCircuitDocument(), operations).document;
    expect(document.components).toHaveLength(genericEntries.length);
    for (const [index, component] of document.components.entries()) {
      expect(component.pins.map((pin) => pin.id)).toEqual(
        genericEntries[index]?.pins.map((pin) => pin.id),
      );
    }
    const scene = buildSchematicScene(document);
    expect(scene.components).toHaveLength(genericEntries.length);
    expect(JSON.stringify(scene)).not.toContain("NaN");
  });

  it("states an explicit structural limitation for every catalog entry", () => {
    for (const entry of COMPONENT_CATALOG) {
      expect(entry.limitations.length).toBeGreaterThan(40);
    }
  });

  it("exposes the official ESP32-S3-DevKitC-1 v1.1 headers as a typed board symbol", () => {
    const board = COMPONENT_CATALOG.find((entry) => entry.id === "esp32s3_devkitc_1");
    expect(board?.pins).toHaveLength(44);
    expect(board?.pins.map((pin) => pin.id)).toEqual(
      expect.arrayContaining(["GPIO0", "GPIO4", "GPIO19", "GPIO20", "GPIO38", "GPIO48"]),
    );
    expect(board?.pins.map((pin) => pin.id)).not.toContain("GPIO22");
    expect(board?.sourceUrl).toContain("docs.espressif.com");
    expect(board?.limitations).toContain("GPIO35–GPIO37");
    expect(board?.limitations).toContain("QEMU GPIO device is unsupported");

    const document = applyCircuitOperations(createEmptyCircuitDocument(), [
      {
        type: "add_component",
        componentId: "00000000-0000-4000-8000-000000000099",
        reference: "MCU1",
        kind: "esp32s3_devkitc_1",
        value: "ESP32-S3-DevKitC-1 v1.1",
        position: { x: 300, y: 300 },
        rotation: 0,
      },
    ]).document;
    const geometry = buildSchematicScene(document).components[0];
    expect(geometry?.localPins.GPIO4?.x).toBe(-90);
    expect(geometry?.localPins.GPIO43?.x).toBe(90);
    expect(geometry?.primitives).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text", text: "ESP32-S3" })]),
    );
  });
});
