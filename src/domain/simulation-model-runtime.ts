import { z } from "zod";
import type { InstalledSimulationModel, SimulationModelProposal } from "./simulation-model";

type SimulationModel = InstalledSimulationModel | SimulationModelProposal;
type DigitalValue = 0 | 1 | "x" | "z";

export const DeclarativeSimulationEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("digital_gpio"),
      pins: z.record(z.string().min(1).max(40), z.union([z.literal(0), z.literal(1)])),
    })
    .strict(),
  z.object({ kind: z.literal("analog_curve"), input: z.number().finite() }).strict(),
  z
    .object({
      kind: z.literal("i2c_registers"),
      deviceAddress: z.int().min(0x03).max(0x77),
      registerAddress: z.int().min(0).max(0xffff),
      operation: z.enum(["read", "write"]),
      value: z.int().nonnegative().max(0xffff_ffff).optional(),
      state: z.record(z.string(), z.int().nonnegative().max(0xffff_ffff)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("spi_commands"),
      mode: z.int().min(0).max(3),
      clockHz: z.int().positive().max(1_000_000_000),
      opcode: z.int().min(0).max(255),
    })
    .strict(),
]);

export type DeclarativeSimulationEvent = z.infer<typeof DeclarativeSimulationEventSchema>;

export interface DeclarativeSimulationResult {
  readonly behaviorKind: DeclarativeSimulationEvent["kind"];
  readonly outputs?: Readonly<Record<string, DigitalValue>>;
  readonly output?: number;
  readonly value?: number;
  readonly responseBytes?: readonly number[];
  readonly state?: Readonly<Record<string, number>>;
  readonly warnings: readonly string[];
}

export function evaluateSimulationModel(
  model: SimulationModel,
  rawEvent: DeclarativeSimulationEvent,
): DeclarativeSimulationResult {
  const event = DeclarativeSimulationEventSchema.parse(rawEvent);
  const behavior = model.behavior;
  if (behavior.kind !== event.kind) {
    throw new Error(`Model ${model.id} requires a ${behavior.kind} event.`);
  }
  const warnings = [
    ...model.limitations,
    "Declarative evaluation does not establish timing, electrical loading, thermal behavior, or physical safety.",
  ];

  switch (event.kind) {
    case "digital_gpio": {
      if (behavior.kind !== "digital_gpio") throw new Error("Digital behavior mismatch.");
      const row = behavior.truthTable.find((candidate) =>
        behavior.inputPins.every((pinId) => candidate.when[pinId] === event.pins[pinId]),
      );
      const outputs: Record<string, DigitalValue> = {};
      for (const pinId of behavior.outputPins) {
        outputs[pinId] = row?.outputs[pinId] ?? "x";
      }
      return { behaviorKind: behavior.kind, outputs, warnings };
    }
    case "analog_curve": {
      if (behavior.kind !== "analog_curve") throw new Error("Analog behavior mismatch.");
      if (!Number.isFinite(event.input)) throw new Error("Analog input must be finite.");
      const points = behavior.points;
      const first = points[0];
      const last = points.at(-1);
      if (!first || !last) throw new Error("Analog model has no curve points.");
      if (event.input <= first.input) {
        return { behaviorKind: behavior.kind, output: first.output, warnings };
      }
      if (event.input >= last.input) {
        return { behaviorKind: behavior.kind, output: last.output, warnings };
      }
      const upperIndex = points.findIndex((point) => point.input >= event.input);
      const upper = points[upperIndex];
      const lower = points[upperIndex - 1];
      if (!lower || !upper) throw new Error("Analog curve segment could not be resolved.");
      const ratio = (event.input - lower.input) / (upper.input - lower.input);
      return {
        behaviorKind: behavior.kind,
        output: lower.output + ratio * (upper.output - lower.output),
        warnings,
      };
    }
    case "i2c_registers": {
      if (behavior.kind !== "i2c_registers") throw new Error("I2C behavior mismatch.");
      if (!behavior.addresses.includes(event.deviceAddress)) {
        throw new Error(`I2C address 0x${event.deviceAddress.toString(16)} is not declared.`);
      }
      const register = behavior.registers.find(
        (candidate) => candidate.address === event.registerAddress,
      );
      if (!register) {
        throw new Error(`I2C register 0x${event.registerAddress.toString(16)} is not declared.`);
      }
      const key = String(register.address);
      const state: Record<string, number> = Object.fromEntries(
        behavior.registers.map((candidate) => [
          String(candidate.address),
          event.state?.[String(candidate.address)] ?? candidate.resetValue ?? 0,
        ]),
      );
      if (event.operation === "read") {
        if (register.access === "write_only") throw new Error(`${register.name} is write-only.`);
        return { behaviorKind: behavior.kind, value: state[key] ?? 0, state, warnings };
      }
      if (register.access === "read_only") throw new Error(`${register.name} is read-only.`);
      if (event.value === undefined || !Number.isInteger(event.value) || event.value < 0) {
        throw new Error("I2C writes require a non-negative integer value.");
      }
      const maximum = register.widthBits === 32 ? 0xffff_ffff : 2 ** register.widthBits - 1;
      if (event.value > maximum) {
        throw new Error(`${register.name} accepts at most ${register.widthBits} bits.`);
      }
      state[key] = event.value;
      return { behaviorKind: behavior.kind, value: event.value, state, warnings };
    }
    case "spi_commands": {
      if (behavior.kind !== "spi_commands") throw new Error("SPI behavior mismatch.");
      if (!behavior.modes.includes(event.mode)) {
        throw new Error(`SPI mode ${event.mode} is not declared.`);
      }
      if (
        !Number.isInteger(event.clockHz) ||
        event.clockHz <= 0 ||
        event.clockHz > behavior.maxClockHz
      ) {
        throw new Error(`SPI clock must be within 1..${behavior.maxClockHz} Hz.`);
      }
      const command = behavior.commands.find((candidate) => candidate.opcode === event.opcode);
      if (!command) throw new Error(`SPI opcode 0x${event.opcode.toString(16)} is not declared.`);
      return {
        behaviorKind: behavior.kind,
        ...(command.responseBytes ? { responseBytes: command.responseBytes } : {}),
        warnings,
      };
    }
  }
}
