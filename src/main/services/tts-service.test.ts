import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsService } from "./tts-service";
import type { ChatterboxModelPaths } from "./voice-asset-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const WAV_BYTES = (() => {
  const bytes = new Uint8Array(48);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
})();

describe("TtsService", () => {
  it("synthesizes through the Chatterbox sidecar when the model is ready", async () => {
    const modelDir = await mkdtemp(path.join(os.tmpdir(), "chatterbox-model-"));
    temporaryDirectories.push(modelDir);
    const model: ChatterboxModelPaths = {
      modelDir,
      variant: "nano",
      sampleRateHz: 24_000,
    };
    const runner = vi.fn(async (_exe, args) => {
      const outputIndex = args.indexOf("--output");
      const outputPath = args[outputIndex + 1];
      if (!outputPath) throw new Error("missing output");
      await writeFile(outputPath, WAV_BYTES);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const service = new TtsService(
      async () => model,
      "/app/scripts/chatterbox-speak.py",
      () => "python3",
      runner,
    );

    const result = await service.speak({ text: "Board proposal is ready for approval." });
    expect(result.provider).toBe("chatterbox");
    expect(result.spokenText).toBe("Board proposal is ready for approval.");
    expect(result.wavBytes.byteLength).toBe(WAV_BYTES.byteLength);
    expect(runner).toHaveBeenCalledWith(
      "python3",
      expect.arrayContaining([
        "/app/scripts/chatterbox-speak.py",
        "--model-dir",
        model.modelDir,
        "--variant",
        "nano",
      ]),
      expect.objectContaining({ cwd: modelDir }),
    );
  });

  it("gates synthesis on verified model readiness", async () => {
    const service = new TtsService(async () => undefined, "/app/scripts/chatterbox-speak.py");
    await expect(service.speak({ text: "Hello" })).rejects.toThrow(/not ready/i);
    await expect(service.isReady()).resolves.toBe(false);
  });

  it("rejects empty or oversized spoken text", async () => {
    const service = new TtsService(
      async () => ({
        modelDir: "/m",
        variant: "nano",
        sampleRateHz: 24_000,
      }),
      "/app/scripts/chatterbox-speak.py",
      () => "python3",
      vi.fn(),
    );
    await expect(service.speak({ text: "   " })).rejects.toThrow(/empty/i);
    await expect(service.speak({ text: "x".repeat(501) })).rejects.toThrow(/exceeds/i);
  });
});
