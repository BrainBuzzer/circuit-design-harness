import { z } from "zod";

export const BUILTIN_IC_MODEL_IDS = [
  "ne555",
  "lm358b",
  "lm393",
  "sn74hc00",
  "sn74hc04",
  "sn74hc595",
  "sn74hc165",
  "cd4017b",
  "uln2003a",
  "l293d",
] as const;

export const BuiltinIcModelIdSchema = z.enum(BUILTIN_IC_MODEL_IDS);
export type BuiltinIcModelId = z.infer<typeof BuiltinIcModelIdSchema>;
export type LogicLevel = 0 | 1 | "x" | "z";

const IcPinSchema = z
  .object({
    id: z.string().min(1).max(40),
    name: z.string().min(1).max(80),
    number: z.int().positive().max(64),
    electricalType: z.enum(["passive", "power_in", "power_out"]),
  })
  .strict();

const BuiltinIcModelSchema = z
  .object({
    id: BuiltinIcModelIdSchema,
    manufacturer: z.literal("Texas Instruments"),
    partNumber: z.string().min(1),
    name: z.string().min(1),
    package: z.string().min(1),
    adapter: z.enum([
      "timer_555",
      "dual_op_amp",
      "dual_comparator",
      "quad_nand",
      "hex_inverter",
      "shift_register_595",
      "shift_register_165",
      "decade_counter_4017",
      "darlington_array_2003",
      "motor_driver_293",
    ]),
    fidelity: z.enum(["digital_functional", "idealized_mixed_signal"]),
    supply: z
      .object({
        minimumVolts: z.number().nonnegative(),
        maximumVolts: z.number().positive(),
        secondaryMaximumVolts: z.number().positive().optional(),
      })
      .strict(),
    pins: z.array(IcPinSchema).min(1).max(64),
    datasheetUrl: z.url(),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type BuiltinIcModel = z.infer<typeof BuiltinIcModelSchema>;

const input = (number: number, id: string, name = id) => ({
  number,
  id,
  name,
  electricalType: "power_in" as const,
});
const output = (number: number, id: string, name = id) => ({
  number,
  id,
  name,
  electricalType: "power_out" as const,
});
const passive = (number: number, id: string, name = id) => ({
  number,
  id,
  name,
  electricalType: "passive" as const,
});

export const BUILTIN_IC_MODELS: readonly BuiltinIcModel[] = z
  .array(BuiltinIcModelSchema)
  .length(10)
  .parse([
    {
      id: "ne555",
      manufacturer: "Texas Instruments",
      partNumber: "NE555",
      name: "Precision timer",
      package: "PDIP-8",
      adapter: "timer_555",
      fidelity: "idealized_mixed_signal",
      supply: { minimumVolts: 4.5, maximumVolts: 16 },
      pins: [
        input(1, "GND"),
        input(2, "TRIG"),
        output(3, "OUT"),
        input(4, "RESET"),
        passive(5, "CONT"),
        input(6, "THRES"),
        output(7, "DISCH"),
        input(8, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/ne555.pdf",
      limitations: [
        "Functional latch thresholds are modeled; propagation delay, output drive, discharge resistance, tolerances, and analog RC integration are not.",
      ],
    },
    {
      id: "lm358b",
      manufacturer: "Texas Instruments",
      partNumber: "LM358B",
      name: "Dual operational amplifier",
      package: "PDIP-8 pin-compatible model",
      adapter: "dual_op_amp",
      fidelity: "idealized_mixed_signal",
      supply: { minimumVolts: 3, maximumVolts: 36 },
      pins: [
        output(1, "1OUT"),
        input(2, "1IN-"),
        input(3, "1IN+"),
        input(4, "V-"),
        input(5, "2IN+"),
        input(6, "2IN-"),
        output(7, "2OUT"),
        input(8, "V+"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/lm358b.pdf",
      limitations: [
        "Idealized saturated comparison only; gain, bandwidth, slew, offset, common-mode behavior, stability, noise, and output loading are not modeled.",
      ],
    },
    {
      id: "lm393",
      manufacturer: "Texas Instruments",
      partNumber: "LM393",
      name: "Dual differential comparator",
      package: "PDIP-8",
      adapter: "dual_comparator",
      fidelity: "idealized_mixed_signal",
      supply: { minimumVolts: 2, maximumVolts: 36 },
      pins: [
        output(1, "1OUT"),
        input(2, "1IN-"),
        input(3, "1IN+"),
        input(4, "GND"),
        input(5, "2IN+"),
        input(6, "2IN-"),
        output(7, "2OUT"),
        input(8, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/lm393.pdf",
      limitations: [
        "The open-collector truth behavior is modeled as low or high impedance; delay, offset, hysteresis, input range, pull-up loading, and saturation voltage are not.",
      ],
    },
    {
      id: "sn74hc00",
      manufacturer: "Texas Instruments",
      partNumber: "SN74HC00",
      name: "Quadruple 2-input NAND gate",
      package: "PDIP-14",
      adapter: "quad_nand",
      fidelity: "digital_functional",
      supply: { minimumVolts: 2, maximumVolts: 6 },
      pins: [
        input(1, "1A"),
        input(2, "1B"),
        output(3, "1Y"),
        input(4, "2A"),
        input(5, "2B"),
        output(6, "2Y"),
        input(7, "GND"),
        output(8, "3Y"),
        input(9, "3A"),
        input(10, "3B"),
        output(11, "4Y"),
        input(12, "4A"),
        input(13, "4B"),
        input(14, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/sn74hc00.pdf",
      limitations: [
        "Logic truth tables are modeled; voltage thresholds, timing, loading, and power behavior are not.",
      ],
    },
    {
      id: "sn74hc04",
      manufacturer: "Texas Instruments",
      partNumber: "SN74HC04",
      name: "Hex inverter",
      package: "PDIP-14",
      adapter: "hex_inverter",
      fidelity: "digital_functional",
      supply: { minimumVolts: 2, maximumVolts: 6 },
      pins: [
        input(1, "1A"),
        output(2, "1Y"),
        input(3, "2A"),
        output(4, "2Y"),
        input(5, "3A"),
        output(6, "3Y"),
        input(7, "GND"),
        output(8, "4Y"),
        input(9, "4A"),
        output(10, "5Y"),
        input(11, "5A"),
        output(12, "6Y"),
        input(13, "6A"),
        input(14, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/sn74hc04.pdf",
      limitations: [
        "Logic inversion is modeled; voltage thresholds, timing, loading, oscillator use, and power behavior are not.",
      ],
    },
    {
      id: "sn74hc595",
      manufacturer: "Texas Instruments",
      partNumber: "SN74HC595",
      name: "8-bit serial-in, parallel-out shift register",
      package: "PDIP-16",
      adapter: "shift_register_595",
      fidelity: "digital_functional",
      supply: { minimumVolts: 2, maximumVolts: 6 },
      pins: [
        output(1, "QB"),
        output(2, "QC"),
        output(3, "QD"),
        output(4, "QE"),
        output(5, "QF"),
        output(6, "QG"),
        output(7, "QH"),
        input(8, "GND"),
        output(9, "QH_PRIME", "QH′"),
        input(10, "SRCLR_N", "SRCLR̅"),
        input(11, "SRCLK"),
        input(12, "RCLK"),
        input(13, "OE_N", "OE̅"),
        input(14, "SER"),
        output(15, "QA"),
        input(16, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/sn74hc595.pdf",
      limitations: [
        "Edge-triggered shift, latch, clear, cascade, and output-enable behavior are modeled without propagation timing or electrical loading.",
      ],
    },
    {
      id: "sn74hc165",
      manufacturer: "Texas Instruments",
      partNumber: "SN74HC165",
      name: "8-bit parallel-load shift register",
      package: "PDIP-16",
      adapter: "shift_register_165",
      fidelity: "digital_functional",
      supply: { minimumVolts: 2, maximumVolts: 6 },
      pins: [
        input(1, "SH_LD_N", "SH/LD̅"),
        input(2, "CLK"),
        input(3, "E"),
        input(4, "F"),
        input(5, "G"),
        input(6, "H"),
        output(7, "QH_N", "QH̅"),
        input(8, "GND"),
        output(9, "QH"),
        input(10, "SER"),
        input(11, "A"),
        input(12, "B"),
        input(13, "C"),
        input(14, "D"),
        input(15, "CLK_INH"),
        input(16, "VCC"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/sn74hc165.pdf",
      limitations: [
        "Parallel load, clock inhibit, serial shift, and complementary outputs are modeled without propagation timing or electrical loading.",
      ],
    },
    {
      id: "cd4017b",
      manufacturer: "Texas Instruments",
      partNumber: "CD4017B",
      name: "Decade counter with 10 decoded outputs",
      package: "PDIP-16",
      adapter: "decade_counter_4017",
      fidelity: "digital_functional",
      supply: { minimumVolts: 3, maximumVolts: 18 },
      pins: [
        output(1, "Q5"),
        output(2, "Q1"),
        output(3, "Q0"),
        output(4, "Q2"),
        output(5, "Q6"),
        output(6, "Q7"),
        output(7, "Q3"),
        input(8, "VSS"),
        output(9, "Q8"),
        output(10, "Q4"),
        output(11, "Q9"),
        output(12, "CARRY"),
        input(13, "CLOCK_INHIBIT"),
        input(14, "CLOCK"),
        input(15, "RESET"),
        input(16, "VDD"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/cd4022b.pdf",
      limitations: [
        "Decoded count, reset, inhibit, and carry state are modeled without clock timing, analog thresholds, or electrical loading.",
      ],
    },
    {
      id: "uln2003a",
      manufacturer: "Texas Instruments",
      partNumber: "ULN2003A",
      name: "7-channel Darlington transistor array",
      package: "PDIP-16",
      adapter: "darlington_array_2003",
      fidelity: "digital_functional",
      supply: { minimumVolts: 0, maximumVolts: 50 },
      pins: [
        input(1, "1B"),
        input(2, "2B"),
        input(3, "3B"),
        input(4, "4B"),
        input(5, "5B"),
        input(6, "6B"),
        input(7, "7B"),
        input(8, "E", "GND"),
        passive(9, "COM"),
        output(10, "7C"),
        output(11, "6C"),
        output(12, "5C"),
        output(13, "4C"),
        output(14, "3C"),
        output(15, "2C"),
        output(16, "1C"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/uln2003a.pdf",
      limitations: [
        "Each channel is modeled as an inverting low-side open collector; current, dissipation, saturation voltage, inductive transients, and clamp-diode dynamics are not.",
      ],
    },
    {
      id: "l293d",
      manufacturer: "Texas Instruments",
      partNumber: "L293D",
      name: "Quadruple half-H motor driver",
      package: "PDIP-16",
      adapter: "motor_driver_293",
      fidelity: "digital_functional",
      supply: { minimumVolts: 4.5, maximumVolts: 7, secondaryMaximumVolts: 36 },
      pins: [
        input(1, "EN12", "1,2EN"),
        input(2, "1A"),
        output(3, "1Y"),
        input(4, "GND1", "GND"),
        input(5, "GND2", "GND"),
        output(6, "2Y"),
        input(7, "2A"),
        input(8, "VCC2"),
        input(9, "EN34", "3,4EN"),
        input(10, "3A"),
        output(11, "3Y"),
        input(12, "GND3", "GND"),
        input(13, "GND4", "GND"),
        output(14, "4Y"),
        input(15, "4A"),
        input(16, "VCC1"),
      ],
      datasheetUrl: "https://www.ti.com/lit/ds/symlink/l293.pdf",
      limitations: [
        "Enable and driver truth behavior are modeled; motor mechanics, flyback, current, voltage drop, thermal shutdown, shoot-through, and supply dynamics are not.",
      ],
    },
  ]);

export interface IcEvaluationInput {
  readonly pins: Readonly<Record<string, LogicLevel | number | undefined>>;
  readonly state?: Readonly<Record<string, unknown>>;
  readonly risingEdgePin?: string;
}

export interface IcEvaluationResult {
  readonly outputs: Readonly<Record<string, LogicLevel | number>>;
  readonly state: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

export function getBuiltinIcModel(id: string): BuiltinIcModel | undefined {
  return BUILTIN_IC_MODELS.find((model) => model.id === id);
}

export function evaluateBuiltinIc(
  modelId: BuiltinIcModelId,
  inputState: IcEvaluationInput,
): IcEvaluationResult {
  const model = getBuiltinIcModel(modelId);
  if (!model) {
    throw new Error(`Unknown built-in IC model ${modelId}.`);
  }
  const pins = inputState.pins;
  const state = { ...(inputState.state ?? {}) };
  const warnings = [...model.limitations];
  const logic = (id: string): LogicLevel => toLogic(pins[id]);
  const analog = (id: string, fallback = 0): number =>
    typeof pins[id] === "number" ? pins[id] : fallback;

  switch (model.adapter) {
    case "quad_nand":
      return result(
        Object.fromEntries(
          [1, 2, 3, 4].map((channel) => [
            `${channel}Y`,
            nand(logic(`${channel}A`), logic(`${channel}B`)),
          ]),
        ),
        state,
        warnings,
      );
    case "hex_inverter":
      return result(
        Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map((channel) => [`${channel}Y`, invert(logic(`${channel}A`))]),
        ),
        state,
        warnings,
      );
    case "dual_comparator":
      return result(
        {
          "1OUT": analog("1IN+") > analog("1IN-") ? "z" : 0,
          "2OUT": analog("2IN+") > analog("2IN-") ? "z" : 0,
        },
        state,
        warnings,
      );
    case "dual_op_amp": {
      const low = analog("V-");
      const high = Math.max(low, analog("V+", 5) - 1.5);
      return result(
        {
          "1OUT": analog("1IN+") >= analog("1IN-") ? high : low,
          "2OUT": analog("2IN+") >= analog("2IN-") ? high : low,
        },
        state,
        warnings,
      );
    }
    case "timer_555": {
      const vcc = analog("VCC", 5);
      let latch = state.latch === 1 ? 1 : 0;
      if (logic("RESET") === 0 || analog("THRES") > (2 * vcc) / 3) {
        latch = 0;
      } else if (analog("TRIG", vcc) < vcc / 3) {
        latch = 1;
      }
      return result({ OUT: latch, DISCH: latch ? "z" : 0 }, { ...state, latch }, warnings);
    }
    case "shift_register_595": {
      let shift = bits(state.shift);
      let latch = bits(state.latch);
      if (logic("SRCLR_N") === 0) {
        shift = emptyBits();
      } else if (inputState.risingEdgePin === "SRCLK") {
        shift = [logicBit(logic("SER")), ...shift.slice(0, 7)];
      }
      if (inputState.risingEdgePin === "RCLK") {
        latch = [...shift];
      }
      const enabled = logic("OE_N") === 0;
      const outputs: Record<string, LogicLevel | number> = Object.fromEntries(
        ["QA", "QB", "QC", "QD", "QE", "QF", "QG", "QH"].map((id, index) => [
          id,
          enabled ? (latch[index] ?? 0) : "z",
        ]),
      );
      outputs.QH_PRIME = shift[7] ?? 0;
      return result(outputs, { ...state, shift, latch }, warnings);
    }
    case "shift_register_165": {
      let shift = bits(state.shift);
      if (logic("SH_LD_N") === 0) {
        shift = ["A", "B", "C", "D", "E", "F", "G", "H"].map((id) => logicBit(logic(id)));
      } else if (inputState.risingEdgePin === "CLK" && logic("CLK_INH") === 0) {
        shift = [logicBit(logic("SER")), ...shift.slice(0, 7)];
      }
      const qh = shift[7] ?? 0;
      return result({ QH: qh, QH_N: qh ? 0 : 1 }, { ...state, shift }, warnings);
    }
    case "decade_counter_4017": {
      let count = typeof state.count === "number" ? Math.trunc(state.count) % 10 : 0;
      if (logic("RESET") === 1) {
        count = 0;
      } else if (inputState.risingEdgePin === "CLOCK" && logic("CLOCK_INHIBIT") === 0) {
        count = (count + 1) % 10;
      }
      return result(
        {
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, index) => [`Q${index}`, index === count ? 1 : 0]),
          ),
          CARRY: count < 5 ? 1 : 0,
        },
        { ...state, count },
        warnings,
      );
    }
    case "darlington_array_2003":
      return result(
        Object.fromEntries(
          Array.from({ length: 7 }, (_, index) => {
            const channel = index + 1;
            return [`${channel}C`, logic(`${channel}B`) === 1 ? 0 : "z"];
          }),
        ),
        state,
        warnings,
      );
    case "motor_driver_293":
      return result(
        Object.fromEntries(
          [1, 2, 3, 4].map((channel) => {
            const enabled = logic(channel < 3 ? "EN12" : "EN34") === 1;
            return [`${channel}Y`, enabled ? logic(`${channel}A`) : "z"];
          }),
        ),
        state,
        warnings,
      );
  }
}

function result(
  outputs: Readonly<Record<string, LogicLevel | number>>,
  state: Readonly<Record<string, unknown>>,
  warnings: readonly string[],
): IcEvaluationResult {
  return { outputs, state, warnings };
}

function toLogic(value: LogicLevel | number | undefined): LogicLevel {
  return value === 0 || value === 1 || value === "x" || value === "z" ? value : "x";
}

function logicBit(value: LogicLevel): 0 | 1 {
  return value === 1 ? 1 : 0;
}

function invert(value: LogicLevel): LogicLevel {
  return value === 0 ? 1 : value === 1 ? 0 : "x";
}

function nand(left: LogicLevel, right: LogicLevel): LogicLevel {
  if (left === 0 || right === 0) return 1;
  if (left === 1 && right === 1) return 0;
  return "x";
}

function emptyBits(): (0 | 1)[] {
  return Array.from({ length: 8 }, () => 0);
}

function bits(raw: unknown): (0 | 1)[] {
  return Array.isArray(raw) && raw.length === 8
    ? raw.map((value) => (value === 1 ? 1 : 0))
    : emptyBits();
}
