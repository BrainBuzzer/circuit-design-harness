import { describe, expect, it } from "vitest";
import { BUILTIN_IC_MODELS, evaluateBuiltinIc } from "./ic-models";

describe("built-in IC models", () => {
  it("ships ten unique, manufacturer-sourced models with ordered physical pins", () => {
    expect(BUILTIN_IC_MODELS).toHaveLength(10);
    expect(new Set(BUILTIN_IC_MODELS.map((model) => model.id)).size).toBe(10);
    for (const model of BUILTIN_IC_MODELS) {
      expect(model.datasheetUrl).toMatch(/^https:\/\/www\.ti\.com\/lit\/ds\//);
      expect(model.pins.map((pin) => pin.number)).toEqual(
        Array.from({ length: model.pins.length }, (_, index) => index + 1),
      );
      expect(model.limitations.length).toBeGreaterThan(0);
    }
  });

  it("evaluates the combinational logic adapters deterministically", () => {
    expect(evaluateBuiltinIc("sn74hc00", { pins: { "1A": 1, "1B": 1 } }).outputs["1Y"]).toBe(0);
    expect(evaluateBuiltinIc("sn74hc00", { pins: { "1A": 0, "1B": 1 } }).outputs["1Y"]).toBe(1);
    expect(evaluateBuiltinIc("sn74hc04", { pins: { "1A": 0 } }).outputs["1Y"]).toBe(1);
    expect(evaluateBuiltinIc("uln2003a", { pins: { "1B": 1 } }).outputs["1C"]).toBe(0);
    expect(evaluateBuiltinIc("l293d", { pins: { EN12: 0, "1A": 1 } }).outputs["1Y"]).toBe("z");
  });

  it("models 595 shift, latch, cascade, and output-enable state", () => {
    const shifted = evaluateBuiltinIc("sn74hc595", {
      pins: { SRCLR_N: 1, SER: 1, OE_N: 0 },
      risingEdgePin: "SRCLK",
    });
    expect(shifted.outputs.QH_PRIME).toBe(0);
    const latched = evaluateBuiltinIc("sn74hc595", {
      pins: { SRCLR_N: 1, OE_N: 0 },
      state: shifted.state,
      risingEdgePin: "RCLK",
    });
    expect(latched.outputs.QA).toBe(1);
    expect(
      evaluateBuiltinIc("sn74hc595", {
        pins: { SRCLR_N: 1, OE_N: 1 },
        state: latched.state,
      }).outputs.QA,
    ).toBe("z");
  });

  it("models 165 parallel load and serial shift", () => {
    const loaded = evaluateBuiltinIc("sn74hc165", {
      pins: { SH_LD_N: 0, A: 1, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0, H: 1 },
    });
    expect(loaded.outputs.QH).toBe(1);
    const shifted = evaluateBuiltinIc("sn74hc165", {
      pins: { SH_LD_N: 1, CLK_INH: 0, SER: 0 },
      state: loaded.state,
      risingEdgePin: "CLK",
    });
    expect(shifted.outputs.QH).toBe(0);
  });

  it("models the 4017 reset and inhibited/rising clock behavior", () => {
    const clocked = evaluateBuiltinIc("cd4017b", {
      pins: { RESET: 0, CLOCK_INHIBIT: 0 },
      risingEdgePin: "CLOCK",
    });
    expect(clocked.outputs.Q1).toBe(1);
    expect(clocked.outputs.Q0).toBe(0);
    const reset = evaluateBuiltinIc("cd4017b", {
      pins: { RESET: 1, CLOCK_INHIBIT: 0 },
      state: clocked.state,
    });
    expect(reset.outputs.Q0).toBe(1);
  });

  it("models idealized 555, op-amp, and open-collector comparator state", () => {
    const set = evaluateBuiltinIc("ne555", {
      pins: { VCC: 5, RESET: 1, TRIG: 1, THRES: 1 },
    });
    expect(set.outputs.OUT).toBe(1);
    expect(
      evaluateBuiltinIc("ne555", {
        pins: { VCC: 5, RESET: 1, TRIG: 5, THRES: 4 },
        state: set.state,
      }).outputs.OUT,
    ).toBe(0);
    expect(
      evaluateBuiltinIc("lm358b", {
        pins: { "V+": 5, "V-": 0, "1IN+": 3, "1IN-": 2 },
      }).outputs["1OUT"],
    ).toBe(3.5);
    expect(evaluateBuiltinIc("lm393", { pins: { "1IN+": 3, "1IN-": 2 } }).outputs["1OUT"]).toBe(
      "z",
    );
  });
});
