import { describe, expect, it } from "vitest";
import { SimulationModelProposalSchema } from "./simulation-model";
import { evaluateSimulationModel } from "./simulation-model-runtime";

const base = {
  schemaVersion: 1,
  id: "fixture",
  revision: 1,
  name: "Fixture",
  partNumber: "FIX-1",
  targets: ["arduino_uno_r3"],
  electrical: {},
  limitations: ["Fixture limitation."],
  provenance: [
    {
      attachmentId: "00000000-0000-4000-8000-000000000001",
      pageNumber: 1,
      claim: "Fixture claim.",
      confidence: "high",
    },
  ],
} as const;

describe("declarative simulation model runtime", () => {
  it("evaluates complete digital truth tables and returns x for unmatched input", () => {
    const model = SimulationModelProposalSchema.parse({
      ...base,
      pins: [
        { id: "A", name: "A", role: "digital_input" },
        { id: "Y", name: "Y", role: "digital_output" },
      ],
      behavior: {
        kind: "digital_gpio",
        inputPins: ["A"],
        outputPins: ["Y"],
        truthTable: [
          { when: { A: 0 }, outputs: { Y: 1 } },
          { when: { A: 1 }, outputs: { Y: 0 } },
        ],
      },
    });
    expect(
      evaluateSimulationModel(model, { kind: "digital_gpio", pins: { A: 1 } }).outputs?.Y,
    ).toBe(0);
    expect(evaluateSimulationModel(model, { kind: "digital_gpio", pins: {} }).outputs?.Y).toBe("x");
  });

  it("interpolates and clamps analog curves", () => {
    const model = SimulationModelProposalSchema.parse({
      ...base,
      pins: [
        { id: "IN", name: "In", role: "analog_input" },
        { id: "OUT", name: "Out", role: "analog_output" },
      ],
      behavior: {
        kind: "analog_curve",
        inputPin: "IN",
        outputPin: "OUT",
        points: [
          { input: 0, output: 0 },
          { input: 10, output: 100 },
        ],
      },
    });
    expect(evaluateSimulationModel(model, { kind: "analog_curve", input: 2.5 }).output).toBe(25);
    expect(evaluateSimulationModel(model, { kind: "analog_curve", input: 20 }).output).toBe(100);
  });

  it("maintains bounded I2C register state and enforces access", () => {
    const model = SimulationModelProposalSchema.parse({
      ...base,
      pins: [
        { id: "SDA", name: "SDA", role: "i2c_sda" },
        { id: "SCL", name: "SCL", role: "i2c_scl" },
      ],
      behavior: {
        kind: "i2c_registers",
        sdaPin: "SDA",
        sclPin: "SCL",
        addresses: [0x40],
        registers: [
          { address: 1, name: "CONFIG", widthBits: 8, access: "read_write", resetValue: 3 },
        ],
      },
    });
    const written = evaluateSimulationModel(model, {
      kind: "i2c_registers",
      deviceAddress: 0x40,
      registerAddress: 1,
      operation: "write",
      value: 9,
    });
    expect(written.state?.["1"]).toBe(9);
    expect(
      evaluateSimulationModel(model, {
        kind: "i2c_registers",
        deviceAddress: 0x40,
        registerAddress: 1,
        operation: "read",
        ...(written.state ? { state: written.state } : {}),
      }).value,
    ).toBe(9);
  });

  it("recognizes SPI commands only within declared mode and clock limits", () => {
    const model = SimulationModelProposalSchema.parse({
      ...base,
      pins: [
        { id: "SCLK", name: "SCLK", role: "spi_clock" },
        { id: "MOSI", name: "MOSI", role: "spi_mosi" },
        { id: "MISO", name: "MISO", role: "spi_miso" },
        { id: "CS", name: "CS", role: "spi_chip_select" },
      ],
      behavior: {
        kind: "spi_commands",
        clockPin: "SCLK",
        mosiPin: "MOSI",
        misoPin: "MISO",
        chipSelectPin: "CS",
        modes: [0],
        maxClockHz: 1_000_000,
        commands: [{ opcode: 0x9f, name: "JEDEC ID", direction: "read", responseBytes: [1, 2, 3] }],
      },
    });
    expect(
      evaluateSimulationModel(model, {
        kind: "spi_commands",
        mode: 0,
        clockHz: 500_000,
        opcode: 0x9f,
      }).responseBytes,
    ).toEqual([1, 2, 3]);
    expect(() =>
      evaluateSimulationModel(model, {
        kind: "spi_commands",
        mode: 3,
        clockHz: 500_000,
        opcode: 0x9f,
      }),
    ).toThrow("SPI mode 3");
  });
});
