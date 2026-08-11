import { z } from "zod";
import { EmbeddedTargetIdSchema } from "./embedded";

export const SIMULATION_MODEL_SCHEMA_VERSION = 1;

const ModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/);
const PinIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_.+-]+$/);

export const SimulationModelPinSchema = z
  .object({
    id: PinIdSchema,
    name: z.string().trim().min(1).max(80),
    role: z.enum([
      "power",
      "ground",
      "digital_input",
      "digital_output",
      "analog_input",
      "analog_output",
      "i2c_sda",
      "i2c_scl",
      "spi_clock",
      "spi_mosi",
      "spi_miso",
      "spi_chip_select",
      "uart_rx",
      "uart_tx",
      "other",
    ]),
  })
  .strict();

const ElectricalLimitsSchema = z
  .object({
    recommendedMinVoltage: z.number().finite().nonnegative().optional(),
    recommendedMaxVoltage: z.number().finite().positive().optional(),
    absoluteMaxVoltage: z.number().finite().positive().optional(),
    maxPinCurrentMa: z.number().finite().positive().optional(),
  })
  .strict()
  .superRefine((limits, context) => {
    if (
      limits.recommendedMinVoltage !== undefined &&
      limits.recommendedMaxVoltage !== undefined &&
      limits.recommendedMinVoltage > limits.recommendedMaxVoltage
    ) {
      context.addIssue({
        code: "custom",
        message: "recommendedMinVoltage must not exceed recommendedMaxVoltage.",
      });
    }
    if (
      limits.recommendedMaxVoltage !== undefined &&
      limits.absoluteMaxVoltage !== undefined &&
      limits.recommendedMaxVoltage > limits.absoluteMaxVoltage
    ) {
      context.addIssue({
        code: "custom",
        message: "recommendedMaxVoltage must not exceed absoluteMaxVoltage.",
      });
    }
  });

const DigitalBehaviorSchema = z
  .object({
    kind: z.literal("digital_gpio"),
    inputPins: z.array(PinIdSchema).max(10),
    outputPins: z.array(PinIdSchema).max(64),
    truthTable: z
      .array(
        z
          .object({
            when: z.record(PinIdSchema, z.union([z.literal(0), z.literal(1)])),
            outputs: z.record(
              PinIdSchema,
              z.union([z.literal(0), z.literal(1), z.literal("x"), z.literal("z")]),
            ),
          })
          .strict(),
      )
      .min(1)
      .max(1_024),
  })
  .strict();

const I2cBehaviorSchema = z
  .object({
    kind: z.literal("i2c_registers"),
    sdaPin: PinIdSchema,
    sclPin: PinIdSchema,
    addresses: z.array(z.int().min(0x03).max(0x77)).min(1).max(16),
    registers: z
      .array(
        z
          .object({
            address: z.int().min(0).max(0xffff),
            name: z.string().trim().min(1).max(80),
            widthBits: z.union([z.literal(8), z.literal(16), z.literal(24), z.literal(32)]),
            access: z.enum(["read_only", "write_only", "read_write"]),
            resetValue: z.int().nonnegative().max(0xffff_ffff).optional(),
          })
          .strict(),
      )
      .max(2_048),
  })
  .strict();

const SpiBehaviorSchema = z
  .object({
    kind: z.literal("spi_commands"),
    clockPin: PinIdSchema,
    mosiPin: PinIdSchema,
    misoPin: PinIdSchema.optional(),
    chipSelectPin: PinIdSchema,
    modes: z.array(z.int().min(0).max(3)).min(1).max(4),
    maxClockHz: z.int().positive().max(1_000_000_000),
    commands: z
      .array(
        z
          .object({
            opcode: z.int().min(0).max(255),
            name: z.string().trim().min(1).max(80),
            direction: z.enum(["none", "read", "write", "duplex"]),
            responseBytes: z.array(z.int().min(0).max(255)).max(4_096).optional(),
          })
          .strict(),
      )
      .max(256),
  })
  .strict();

const AnalogBehaviorSchema = z
  .object({
    kind: z.literal("analog_curve"),
    inputPin: PinIdSchema,
    outputPin: PinIdSchema,
    points: z
      .array(
        z
          .object({
            input: z.number().finite(),
            output: z.number().finite(),
          })
          .strict(),
      )
      .min(2)
      .max(512),
  })
  .strict();

export const SimulationModelBehaviorSchema = z.discriminatedUnion("kind", [
  DigitalBehaviorSchema,
  I2cBehaviorSchema,
  SpiBehaviorSchema,
  AnalogBehaviorSchema,
]);

export const SimulationModelProvenanceInputSchema = z
  .object({
    attachmentId: z.uuid(),
    pageNumber: z.int().positive(),
    claim: z.string().trim().min(1).max(1_000),
    confidence: z.enum(["high", "medium", "low"]),
  })
  .strict();

const SimulationModelProposalBaseSchema = z
  .object({
    schemaVersion: z.literal(SIMULATION_MODEL_SCHEMA_VERSION),
    id: ModelIdSchema,
    revision: z.int().positive(),
    name: z.string().trim().min(1).max(160),
    manufacturer: z.string().trim().min(1).max(160).optional(),
    partNumber: z.string().trim().min(1).max(160),
    targets: z.array(EmbeddedTargetIdSchema).min(1).max(2),
    pins: z.array(SimulationModelPinSchema).min(1).max(256),
    electrical: ElectricalLimitsSchema,
    behavior: SimulationModelBehaviorSchema,
    limitations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
    provenance: z.array(SimulationModelProvenanceInputSchema).min(1).max(100),
  })
  .strict();

function validatePinReferences(
  model: {
    readonly pins: readonly z.infer<typeof SimulationModelPinSchema>[];
    readonly behavior: z.infer<typeof SimulationModelBehaviorSchema>;
  },
  context: z.RefinementCtx,
): void {
  const pinIds = new Set<string>();
  for (const [index, pin] of model.pins.entries()) {
    if (pinIds.has(pin.id)) {
      context.addIssue({
        code: "custom",
        path: ["pins", index, "id"],
        message: `Duplicate pin ID ${pin.id}.`,
      });
    }
    pinIds.add(pin.id);
  }
  const referencedPins =
    model.behavior.kind === "digital_gpio"
      ? [...model.behavior.inputPins, ...model.behavior.outputPins]
      : model.behavior.kind === "analog_curve"
        ? [model.behavior.inputPin, model.behavior.outputPin]
        : model.behavior.kind === "i2c_registers"
          ? [model.behavior.sdaPin, model.behavior.sclPin]
          : [
              model.behavior.clockPin,
              model.behavior.mosiPin,
              ...(model.behavior.misoPin ? [model.behavior.misoPin] : []),
              model.behavior.chipSelectPin,
            ];
  for (const pinId of referencedPins) {
    if (!pinIds.has(pinId)) {
      context.addIssue({
        code: "custom",
        path: ["behavior"],
        message: `Behavior references unknown pin ${pinId}.`,
      });
    }
  }
  if (model.behavior.kind === "digital_gpio") {
    const inputPins = new Set(model.behavior.inputPins);
    const outputPins = new Set(model.behavior.outputPins);
    const combinations = new Set<string>();
    for (const [rowIndex, row] of model.behavior.truthTable.entries()) {
      if (
        Object.keys(row.when).length !== inputPins.size ||
        Object.keys(row.when).some((pinId) => !inputPins.has(pinId))
      ) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "truthTable", rowIndex, "when"],
          message: "Each truth-table row must assign every input pin exactly once.",
        });
      }
      if (
        Object.keys(row.outputs).length !== outputPins.size ||
        Object.keys(row.outputs).some((pinId) => !outputPins.has(pinId))
      ) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "truthTable", rowIndex, "outputs"],
          message: "Each truth-table row must assign every output pin exactly once.",
        });
      }
      const combination = model.behavior.inputPins.map((pinId) => row.when[pinId]).join("");
      if (combinations.has(combination)) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "truthTable", rowIndex, "when"],
          message: "Truth-table input combinations must be unique.",
        });
      }
      combinations.add(combination);
    }
    const expectedRows = 2 ** inputPins.size;
    if (model.behavior.truthTable.length !== expectedRows) {
      context.addIssue({
        code: "custom",
        path: ["behavior", "truthTable"],
        message: `A complete ${inputPins.size}-input truth table requires ${expectedRows} rows.`,
      });
    }
  }
  if (model.behavior.kind === "analog_curve") {
    for (let index = 1; index < model.behavior.points.length; index += 1) {
      if (
        (model.behavior.points[index]?.input ?? 0) <= (model.behavior.points[index - 1]?.input ?? 0)
      ) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "points", index, "input"],
          message: "Analog curve input points must be strictly increasing.",
        });
      }
    }
  }
  if (model.behavior.kind === "i2c_registers") {
    const addresses = new Set<number>();
    for (const [index, register] of model.behavior.registers.entries()) {
      if (addresses.has(register.address)) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "registers", index, "address"],
          message: "I2C register addresses must be unique.",
        });
      }
      addresses.add(register.address);
    }
  }
  if (model.behavior.kind === "spi_commands") {
    const opcodes = new Set<number>();
    for (const [index, command] of model.behavior.commands.entries()) {
      if (opcodes.has(command.opcode)) {
        context.addIssue({
          code: "custom",
          path: ["behavior", "commands", index, "opcode"],
          message: "SPI command opcodes must be unique.",
        });
      }
      opcodes.add(command.opcode);
    }
  }
}

export const SimulationModelProposalSchema =
  SimulationModelProposalBaseSchema.superRefine(validatePinReferences);

export type SimulationModelProposal = z.infer<typeof SimulationModelProposalSchema>;

const InstalledProvenanceSchema = SimulationModelProvenanceInputSchema.extend({
  attachmentName: z.string().trim().min(1).max(255),
  attachmentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const InstalledSimulationModelSchema = SimulationModelProposalBaseSchema.omit({
  provenance: true,
})
  .extend({
    provenance: z.array(InstalledProvenanceSchema).min(1).max(100),
    runtimeStatus: z.literal("declarative_runtime"),
    installedAt: z.iso.datetime(),
    modelSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine(validatePinReferences);

export type InstalledSimulationModel = z.infer<typeof InstalledSimulationModelSchema>;

export const SIMULATION_MODEL_PACK_GUIDANCE = {
  schemaVersion: SIMULATION_MODEL_SCHEMA_VERSION,
  supportedBehaviorKinds: ["digital_gpio", "i2c_registers", "spi_commands", "analog_curve"],
  rules: [
    "Every electrical value, pin mapping, address, register, and command must cite an attached datasheet page.",
    "Use low or medium confidence when OCR, document ambiguity, or device variants prevent an exact claim.",
    "The pack is declarative JSON; executable code, scripts, expressions, and network references are rejected.",
    "Installation records the attachment hash and requires an explicit user action in the workbench.",
    "Installed models run only inside fixed declarative adapters: truth tables, linear interpolation, I2C register state, or SPI command recognition.",
    "Declarative execution does not model timing, loading, thermal behavior, analog parasitics, protocol framing outside the declared fields, or physical safety.",
  ],
} as const;
