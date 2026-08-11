import { describe, expect, it } from "vitest";
import { downsample, float32ToPcm16, rmsLevel } from "./audio";

describe("audio helpers", () => {
  it("downsamples 48 kHz mono to 16 kHz without inventing energy", () => {
    const sourceRate = 48_000;
    const targetRate = 16_000;
    // 30 ms of a pure tone at 48 kHz → 10 ms at 16 kHz after 3:1 average.
    const samples = new Float32Array(1_440);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / sourceRate);
    }
    const out = downsample(samples, sourceRate, targetRate);
    expect(out.length).toBe(480);
    // Peak should stay near the original amplitude (averaging same-phase samples).
    let peak = 0;
    for (const sample of out) {
      peak = Math.max(peak, Math.abs(sample));
    }
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("is a no-op when rates match", () => {
    const samples = new Float32Array([0.1, -0.2, 0.3]);
    expect(downsample(samples, 16_000, 16_000)).toBe(samples);
  });

  it("encodes float32 to pcm16 with clamping", () => {
    const pcm = float32ToPcm16(new Float32Array([0, 1, -1, 2, -2]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(0x7fff);
    expect(pcm[2]).toBe(-0x8000);
    expect(pcm[3]).toBe(0x7fff);
    expect(pcm[4]).toBe(-0x8000);
  });

  it("reports low RMS for silence and higher for loud frames", () => {
    expect(rmsLevel(new Float32Array(100))).toBe(0);
    const loud = new Float32Array(100).fill(0.5);
    expect(rmsLevel(loud)).toBeGreaterThan(0.5);
  });
});
