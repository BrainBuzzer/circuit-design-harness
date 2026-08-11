import { describe, expect, it } from "vitest";
import { ARDUINO_UNO_R3_PIN_MAP, ESP32_S3_PIN_MAP, isBridgeableFirmwarePin } from "./board-pin-map";

describe("board pin maps", () => {
  it("maps every Uno header pin used by the trace runner to the ATmega328P port bit", () => {
    expect(ARDUINO_UNO_R3_PIN_MAP.pins).toHaveLength(20);
    expect(ARDUINO_UNO_R3_PIN_MAP.pins.find((pin) => pin.id === "D13")?.processorSignal).toBe(
      "PB5",
    );
    expect(ARDUINO_UNO_R3_PIN_MAP.pins.find((pin) => pin.id === "A5")?.processorSignal).toBe("PC5");
    expect(isBridgeableFirmwarePin("arduino_uno_r3", "D0")).toBe(true);
    expect(isBridgeableFirmwarePin("arduino_uno_r3", "D14")).toBe(false);
  });

  it("keeps ESP32-S3 chip pins visible while refusing an unsupported QEMU GPIO bridge", () => {
    expect(ESP32_S3_PIN_MAP.pins.some((pin) => pin.id === "GPIO48")).toBe(true);
    expect(ESP32_S3_PIN_MAP.pins.some((pin) => pin.id === "GPIO22")).toBe(false);
    expect(isBridgeableFirmwarePin("esp32s3", "GPIO4")).toBe(false);
  });
});
