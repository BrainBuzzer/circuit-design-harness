import { z } from "zod";
import { isBridgeableFirmwarePin } from "./board-pin-map";
import {
  type CircuitModelScenario,
  CircuitModelScenarioSchema,
  type CircuitSignalValue,
} from "./circuit-simulation";

const TraceLevelSchema = z.union([z.literal(0), z.literal(1)]);

export const FirmwarePinBridgeSchema = z
  .object({
    firmwarePin: z.string().trim().min(1).max(20),
    net: z.string().trim().min(1).max(80),
  })
  .strict();

export const FirmwareCircuitRequestSchema = z
  .object({
    pinBridges: z.array(FirmwarePinBridgeSchema).min(1).max(40),
    scenario: CircuitModelScenarioSchema.default({
      stimuli: {},
      risingEdges: [],
      initialState: {},
      assertions: [],
    }),
  })
  .strict();

export type FirmwareCircuitRequest = z.infer<typeof FirmwareCircuitRequestSchema>;

export const FirmwareSignalTraceSchema = z
  .object({
    schemaVersion: z.literal(1),
    targetId: z.literal("arduino_uno_r3"),
    engine: z.literal("simavr"),
    clockHz: z.literal(16_000_000),
    requestedDurationMicros: z.int().min(1_000).max(5_000_000),
    cyclesExecuted: z.int().nonnegative(),
    termination: z.enum(["duration_reached", "firmware_stopped", "cpu_crashed"]),
    pinEvents: z
      .array(
        z
          .object({
            cycle: z.int().nonnegative(),
            pin: z.string().min(2).max(3),
            level: TraceLevelSchema,
          })
          .strict(),
      )
      .max(8192),
    finalPins: z.record(z.string(), TraceLevelSchema),
    uartEvents: z
      .array(
        z
          .object({
            cycle: z.int().nonnegative(),
            uart: z.literal("UART0"),
            byte: z.int().min(0).max(255),
          })
          .strict(),
      )
      .max(8192),
    pinEventsTruncated: z.boolean(),
    uartEventsTruncated: z.boolean(),
  })
  .strict()
  .superRefine((trace, context) => {
    if (Object.keys(trace.finalPins).length > 20) {
      context.addIssue({
        code: "custom",
        message: "Uno trace has more final pins than the board exposes.",
        path: ["finalPins"],
      });
    }
    for (const [index, event] of trace.pinEvents.entries()) {
      if (!isBridgeableFirmwarePin("arduino_uno_r3", event.pin)) {
        context.addIssue({
          code: "custom",
          message: `Trace contains unknown Uno pin ${event.pin}.`,
          path: ["pinEvents", index, "pin"],
        });
      }
      if (event.cycle > trace.cyclesExecuted) {
        context.addIssue({
          code: "custom",
          message: "Pin event occurs after the reported execution window.",
          path: ["pinEvents", index, "cycle"],
        });
      }
    }
    for (const [index, event] of trace.uartEvents.entries()) {
      if (event.cycle > trace.cyclesExecuted) {
        context.addIssue({
          code: "custom",
          message: "UART event occurs after the reported execution window.",
          path: ["uartEvents", index, "cycle"],
        });
      }
    }
    for (const [pin, value] of Object.entries(trace.finalPins)) {
      if (!isBridgeableFirmwarePin("arduino_uno_r3", pin)) {
        context.addIssue({
          code: "custom",
          message: `Trace contains unknown Uno pin ${pin}.`,
          path: ["finalPins", pin],
        });
      }
      if (value !== 0 && value !== 1) {
        context.addIssue({
          code: "custom",
          message: "Invalid pin level.",
          path: ["finalPins", pin],
        });
      }
    }
  });

export type FirmwareSignalTrace = z.infer<typeof FirmwareSignalTraceSchema>;

const TRACE_PREFIX = "CDH_TRACE_V1 ";

export function parseSimavrTraceOutput(
  output: string | undefined,
): FirmwareSignalTrace | undefined {
  if (!output) return undefined;
  const marker = output.lastIndexOf(TRACE_PREFIX);
  if (marker < 0) return undefined;
  const line = output.slice(marker + TRACE_PREFIX.length).split(/\r?\n/, 1)[0];
  if (!line) return undefined;
  try {
    return FirmwareSignalTraceSchema.parse(JSON.parse(line));
  } catch {
    return undefined;
  }
}

export interface FirmwareBridgePreparation {
  readonly outcome: "ready" | "blocked";
  readonly scenario?: CircuitModelScenario;
  readonly appliedStimuli: Readonly<Record<string, CircuitSignalValue>>;
  readonly diagnostics: readonly string[];
}

export function prepareFirmwareCircuitScenario(
  trace: FirmwareSignalTrace,
  request: FirmwareCircuitRequest,
): FirmwareBridgePreparation {
  const parsed = FirmwareCircuitRequestSchema.parse(request);
  const stimuli: Record<string, CircuitSignalValue> = { ...parsed.scenario.stimuli };
  const diagnostics: string[] = [];
  const appliedStimuli: Record<string, CircuitSignalValue> = {};
  const mappedPins = new Set<string>();

  for (const bridge of parsed.pinBridges) {
    if (!isBridgeableFirmwarePin(trace.targetId, bridge.firmwarePin)) {
      diagnostics.push(`${bridge.firmwarePin} is not a bridgeable ${trace.targetId} output pin.`);
      continue;
    }
    if (mappedPins.has(bridge.firmwarePin)) {
      diagnostics.push(`${bridge.firmwarePin} is mapped more than once.`);
      continue;
    }
    mappedPins.add(bridge.firmwarePin);
    const level = trace.finalPins[bridge.firmwarePin];
    if (level === undefined) {
      diagnostics.push(
        `${bridge.firmwarePin} was not observed in output mode during the requested virtual-time window.`,
      );
      continue;
    }
    if (Object.hasOwn(stimuli, bridge.net) && stimuli[bridge.net] !== level) {
      diagnostics.push(
        `Firmware ${bridge.firmwarePin} conflicts with the existing manual stimulus on ${bridge.net}.`,
      );
      continue;
    }
    stimuli[bridge.net] = level;
    appliedStimuli[bridge.net] = level;
  }

  if (diagnostics.length > 0) {
    return { outcome: "blocked", appliedStimuli, diagnostics };
  }
  return {
    outcome: "ready",
    scenario: { ...parsed.scenario, stimuli },
    appliedStimuli,
    diagnostics: [],
  };
}
