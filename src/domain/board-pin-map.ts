import type { EmbeddedTargetId } from "./embedded";

export interface BoardDigitalPin {
  readonly id: string;
  readonly label: string;
  readonly processorSignal: string;
  readonly usableForCircuitBridge: boolean;
  readonly notes?: string;
}

export interface BoardPinMap {
  readonly targetId: EmbeddedTargetId;
  readonly boardName: string;
  readonly pins: readonly BoardDigitalPin[];
  readonly limitations: readonly string[];
}

const unoPortPins = [
  ["D0", "PD0"],
  ["D1", "PD1"],
  ["D2", "PD2"],
  ["D3", "PD3"],
  ["D4", "PD4"],
  ["D5", "PD5"],
  ["D6", "PD6"],
  ["D7", "PD7"],
  ["D8", "PB0"],
  ["D9", "PB1"],
  ["D10", "PB2"],
  ["D11", "PB3"],
  ["D12", "PB4"],
  ["D13", "PB5"],
  ["A0", "PC0"],
  ["A1", "PC1"],
  ["A2", "PC2"],
  ["A3", "PC3"],
  ["A4", "PC4"],
  ["A5", "PC5"],
] as const;

export const ARDUINO_UNO_R3_PIN_MAP: BoardPinMap = {
  targetId: "arduino_uno_r3",
  boardName: "Arduino Uno R3",
  pins: unoPortPins.map(([id, processorSignal]) => ({
    id,
    label: id,
    processorSignal,
    usableForCircuitBridge: true,
    ...(id === "D0" || id === "D1" ? { notes: "Shared with hardware UART0." } : {}),
  })),
  limitations: [
    "The functional bridge observes digital output state only; analog voltage, PWM averaging, drive current, pull-ups, and contention with physical loads are not modeled.",
    "A4/A5 are also SDA/SCL and D10-D13 are also SPI pins; the trace reports digital pin levels, not decoded bus transactions.",
  ],
};

const s3Unavailable = new Set([22, 23, 24, 25]);
const s3Pins = Array.from({ length: 49 }, (_, gpio) => gpio)
  .filter((gpio) => !s3Unavailable.has(gpio))
  .map((gpio): BoardDigitalPin => {
    const notes: string[] = [];
    if ([0, 3, 45, 46].includes(gpio)) notes.push("Strapping pin.");
    if (gpio >= 26 && gpio <= 32) notes.push("Commonly reserved for flash/PSRAM.");
    if (gpio >= 33 && gpio <= 37) notes.push("May be reserved by octal flash/PSRAM modules.");
    if (gpio === 19 || gpio === 20) notes.push("Shared with USB/JTAG on common modules.");
    return {
      id: `GPIO${gpio}`,
      label: `GPIO${gpio}`,
      processorSignal: `GPIO${gpio}`,
      usableForCircuitBridge: false,
      ...(notes.length > 0 ? { notes: notes.join(" ") } : {}),
    };
  });

export const ESP32_S3_PIN_MAP: BoardPinMap = {
  targetId: "esp32s3",
  boardName: "ESP32-S3 chip-level GPIO reference",
  pins: s3Pins,
  limitations: [
    "This is a chip-level identity map. DevKit and module variants expose different subsets and reserve different flash/PSRAM pins.",
    "The pinned Espressif QEMU ESP32-S3 GPIO peripheral is a stub, so no pin is currently eligible for firmware-to-circuit bridging.",
  ],
};

export const BOARD_PIN_MAPS: Readonly<Record<EmbeddedTargetId, BoardPinMap>> = {
  arduino_uno_r3: ARDUINO_UNO_R3_PIN_MAP,
  esp32s3: ESP32_S3_PIN_MAP,
};

export function getBoardPinMap(targetId: EmbeddedTargetId): BoardPinMap {
  return BOARD_PIN_MAPS[targetId];
}

export function isBridgeableFirmwarePin(targetId: EmbeddedTargetId, pin: string): boolean {
  return BOARD_PIN_MAPS[targetId].pins.some(
    (candidate) => candidate.id === pin && candidate.usableForCircuitBridge,
  );
}
