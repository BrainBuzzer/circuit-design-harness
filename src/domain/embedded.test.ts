import { describe, expect, it } from "vitest";
import { assessSimulation, EMBEDDED_TARGET_CAPABILITIES } from "./embedded";

describe("embedded target capability matrix", () => {
  it("exposes only the product-supported Arduino Uno and ESP32-S3 targets", () => {
    expect(EMBEDDED_TARGET_CAPABILITIES.map((target) => target.id)).toEqual([
      "arduino_uno_r3",
      "esp32s3",
    ]);
  });

  it("selects local QEMU where it covers requested ESP32 execution", () => {
    const assessment = assessSimulation({
      targetId: "esp32s3",
      requiredFeatures: ["cpu", "gpio", "uart"],
    });
    expect(assessment.selectedEngine.engine).toBe("qemu");
    expect(assessment.overall).toBe("partial");
    expect(assessment.unsupportedFeatures).toEqual(["gpio"]);
  });

  it("reports unsupported S3 peripherals instead of treating execution as full simulation", () => {
    const assessment = assessSimulation({
      targetId: "esp32s3",
      requiredFeatures: ["cpu", "wifi", "bluetooth"],
    });
    expect(assessment.overall).toBe("partial");
    expect(assessment.selectedEngine.engine).toBe("qemu");
    expect(assessment.unsupportedFeatures).toEqual(["wifi", "bluetooth"]);
  });

  it("contains only local or non-executing simulation capabilities", () => {
    expect(
      EMBEDDED_TARGET_CAPABILITIES.flatMap((target) => target.engines).every(
        (engine) => engine.execution === "local" || engine.execution === "none",
      ),
    ).toBe(true);
  });

  it("reports features omitted by a selected simulator", () => {
    const assessment = assessSimulation({
      targetId: "esp32s3",
      preferredEngine: "qemu",
      requiredFeatures: ["cpu", "gpio", "bluetooth", "camera"],
    });
    expect(assessment.overall).toBe("partial");
    expect(assessment.unsupportedFeatures).toEqual(["gpio", "bluetooth", "camera"]);
  });
});
