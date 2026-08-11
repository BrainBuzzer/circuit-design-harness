import { describe, expect, it } from "vitest";
import { parseSimavrTraceOutput, prepareFirmwareCircuitScenario } from "./firmware-trace";

const payload = {
  schemaVersion: 1,
  targetId: "arduino_uno_r3",
  engine: "simavr",
  clockHz: 16_000_000,
  requestedDurationMicros: 250_000,
  cyclesExecuted: 4_000_000,
  termination: "duration_reached",
  pinEvents: [
    { cycle: 20, pin: "D13", level: 0 },
    { cycle: 30, pin: "D13", level: 1 },
  ],
  finalPins: { D13: 1 },
  uartEvents: [{ cycle: 40, uart: "UART0", byte: 65 }],
  pinEventsTruncated: false,
  uartEventsTruncated: false,
} as const;

describe("firmware signal traces", () => {
  it("parses the last versioned runner record from mixed process output", () => {
    const trace = parseSimavrTraceOutput(
      `Loaded firmware\nCDH_TRACE_V1 ${JSON.stringify(payload)}\n`,
    );
    expect(trace?.finalPins.D13).toBe(1);
    expect(trace?.uartEvents[0]?.byte).toBe(65);
  });

  it("maps observed final output levels into a circuit scenario", () => {
    const trace = parseSimavrTraceOutput(`CDH_TRACE_V1 ${JSON.stringify(payload)}`);
    if (!trace) throw new Error("Expected trace fixture to parse.");
    const prepared = prepareFirmwareCircuitScenario(trace, {
      pinBridges: [{ firmwarePin: "D13", net: "LED" }],
      scenario: {
        stimuli: {},
        risingEdges: [],
        initialState: {},
        assertions: [{ net: "LED", equals: 1 }],
      },
    });
    expect(prepared.outcome).toBe("ready");
    expect(prepared.scenario?.stimuli).toEqual({ LED: 1 });
  });

  it("blocks unobserved outputs and conflicting manual stimuli", () => {
    const trace = parseSimavrTraceOutput(`CDH_TRACE_V1 ${JSON.stringify(payload)}`);
    if (!trace) throw new Error("Expected trace fixture to parse.");
    const prepared = prepareFirmwareCircuitScenario(trace, {
      pinBridges: [
        { firmwarePin: "D13", net: "LED" },
        { firmwarePin: "D12", net: "CLOCK" },
      ],
      scenario: {
        stimuli: { LED: 0 },
        risingEdges: [],
        initialState: {},
        assertions: [],
      },
    });
    expect(prepared.outcome).toBe("blocked");
    expect(prepared.diagnostics).toHaveLength(2);
  });
});
