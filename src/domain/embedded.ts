import { z } from "zod";

export const EmbeddedTargetIdSchema = z.enum(["arduino_uno_r3", "esp32s3"]);
export type EmbeddedTargetId = z.infer<typeof EmbeddedTargetIdSchema>;

export const EmbeddedFeatureSchema = z.enum([
  "cpu",
  "gpio",
  "adc",
  "pwm",
  "i2c",
  "spi",
  "uart",
  "wifi",
  "bluetooth",
  "ieee802154",
  "usb",
  "can",
  "camera",
]);
export type EmbeddedFeature = z.infer<typeof EmbeddedFeatureSchema>;

export const SimulationLevelSchema = z.enum(["supported", "partial", "unsupported"]);
export type SimulationLevel = z.infer<typeof SimulationLevelSchema>;

export interface SimulationEngineCapability {
  readonly engine: "simavr" | "qemu" | "compile_only";
  readonly level: SimulationLevel;
  readonly execution: "local" | "none";
  readonly supportedFeatures: readonly EmbeddedFeature[];
  readonly limitations: readonly string[];
}

export interface EmbeddedTargetCapability {
  readonly id: EmbeddedTargetId;
  readonly displayName: string;
  readonly family: "arduino_avr" | "esp32";
  readonly architecture: "avr8" | "xtensa" | "riscv32";
  readonly buildSupported: boolean;
  readonly engines: readonly SimulationEngineCapability[];
  readonly sourceUrl: string;
}

const ESP32S3_QEMU_FEATURES: readonly EmbeddedFeature[] = ["cpu", "uart"];
const ESPRESSIF_MATRIX_SOURCE =
  "https://github.com/espressif/arduino-esp32/blob/master/.github/scripts/socs_config.sh";

export const EMBEDDED_TARGET_CAPABILITIES: readonly EmbeddedTargetCapability[] = [
  {
    id: "arduino_uno_r3",
    displayName: "Arduino Uno R3 (ATmega328P)",
    family: "arduino_avr",
    architecture: "avr8",
    buildSupported: true,
    engines: [
      {
        engine: "simavr",
        level: "partial",
        execution: "local",
        supportedFeatures: ["cpu", "gpio", "adc", "pwm", "i2c", "spi", "uart"],
        limitations: [
          "External parts require explicit simulator models and wiring.",
          "A passing firmware run does not validate electrical ratings or a physical build.",
        ],
      },
    ],
    sourceUrl: "https://github.com/buserror/simavr",
  },
  {
    id: "esp32s3",
    displayName: "ESP32-S3",
    family: "esp32",
    architecture: "xtensa",
    buildSupported: true,
    sourceUrl: ESPRESSIF_MATRIX_SOURCE,
    engines: [
      {
        engine: "qemu",
        level: "partial",
        execution: "local",
        supportedFeatures: ESP32S3_QEMU_FEATURES,
        limitations: [
          "The pinned Espressif QEMU GPIO device implements strap reads only; firmware GPIO state and external circuit bridging are unsupported.",
          "UART console bytes are visible in process output but are not yet a structured, timestamped signal trace.",
          "A passing firmware run does not prove Wi-Fi/Bluetooth radio behavior, analog accuracy, electrical ratings, or a physical build.",
        ],
      },
      {
        engine: "compile_only",
        level: "unsupported",
        execution: "none",
        supportedFeatures: [],
        limitations: [
          "Compilation is not simulation. Use the local QEMU engine or hardware-in-the-loop validation for runtime behavior.",
        ],
      },
    ],
  },
];

export interface DesignSimulationRequest {
  readonly targetId: EmbeddedTargetId;
  readonly requiredFeatures: readonly EmbeddedFeature[];
  readonly preferredEngine?: SimulationEngineCapability["engine"];
}

export interface DesignSimulationAssessment {
  readonly target: EmbeddedTargetCapability;
  readonly overall: SimulationLevel;
  readonly selectedEngine: SimulationEngineCapability;
  readonly supportedFeatures: readonly EmbeddedFeature[];
  readonly unsupportedFeatures: readonly EmbeddedFeature[];
  readonly messages: readonly string[];
}

export function assessSimulation(request: DesignSimulationRequest): DesignSimulationAssessment {
  const parsed = z
    .object({
      targetId: EmbeddedTargetIdSchema,
      requiredFeatures: z.array(EmbeddedFeatureSchema).max(50),
      preferredEngine: z.enum(["simavr", "qemu", "compile_only"]).optional(),
    })
    .parse(request);
  const target = EMBEDDED_TARGET_CAPABILITIES.find((candidate) => candidate.id === parsed.targetId);
  if (!target) {
    throw new Error("Unknown embedded target.");
  }
  const candidates = parsed.preferredEngine
    ? target.engines.filter((engine) => engine.engine === parsed.preferredEngine)
    : target.engines;
  const selectedEngine =
    [...candidates].sort((left, right) => {
      const score = (engine: SimulationEngineCapability): number =>
        parsed.requiredFeatures.filter((feature) => engine.supportedFeatures.includes(feature))
          .length *
          10 +
        (engine.execution === "local" ? 2 : 0);
      return score(right) - score(left);
    })[0] ?? target.engines[target.engines.length - 1];
  if (!selectedEngine) {
    throw new Error("Embedded target has no validation capability record.");
  }
  const supportedFeatures = parsed.requiredFeatures.filter((feature) =>
    selectedEngine.supportedFeatures.includes(feature),
  );
  const unsupportedFeatures = parsed.requiredFeatures.filter(
    (feature) => !selectedEngine.supportedFeatures.includes(feature),
  );
  const overall: SimulationLevel =
    selectedEngine.level === "unsupported"
      ? "unsupported"
      : unsupportedFeatures.length === 0 && selectedEngine.level === "supported"
        ? "supported"
        : "partial";
  return {
    target,
    overall,
    selectedEngine,
    supportedFeatures,
    unsupportedFeatures,
    messages: [
      ...selectedEngine.limitations,
      ...(unsupportedFeatures.length
        ? [`The selected engine does not simulate: ${unsupportedFeatures.join(", ")}.`]
        : []),
    ],
  };
}
