import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptionService } from "./transcription-service";
import { VoiceAssetService, type VoiceSources } from "./voice-asset-service";

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

describe("Whisper download readiness → transcription", () => {
  it("fails while assets are missing, then succeeds after ensureAssets verifies the model", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "whisper-integration-"));
    temporaryDirectories.push(root);
    const whisperBytes = Buffer.from("whisper-model-fixture-for-integration");
    const ttsPayload = Buffer.from("chatterbox-fixture");
    const sources = fixtureSources(whisperBytes, ttsPayload);

    const assets = new VoiceAssetService({
      assetsRoot: path.join(root, "assets"),
      sources,
      resolveWhisperExecutable: async () => "/voice/whisper-cli",
      fetchBytes: async (url) => {
        if (url.includes("ggml")) return new Uint8Array(whisperBytes);
        return new Uint8Array(ttsPayload);
      },
    });

    const unavailable = new TranscriptionService(
      () => assets.resolveWhisperRuntime(),
      () => true,
      vi.fn(),
    );
    await expect(
      unavailable.transcribe({ projectId: "p1", wavBytes: WAV_BYTES, durationMs: 500 }),
    ).rejects.toThrow(/Whisper runtime is unavailable/i);

    await assets.ensureAssets();
    expect(assets.getStatus().whisper.ready).toBe(true);

    const runner = vi.fn().mockResolvedValue({
      stdout: "Set the resistor to 330 ohms.\n",
      stderr: "",
    });
    const ready = new TranscriptionService(
      () => assets.resolveWhisperRuntime(),
      () => true,
      runner,
    );
    await expect(
      ready.transcribe({ projectId: "p1", wavBytes: WAV_BYTES, durationMs: 1_000 }),
    ).resolves.toMatchObject({
      text: "Set the resistor to 330 ohms.",
      provider: "local_whisper",
    });
    expect(runner).toHaveBeenCalledWith(
      "/voice/whisper-cli",
      expect.arrayContaining([
        "--model",
        path.join(root, "assets", "whisper", "models", "ggml-small-q5_1.bin"),
      ]),
      expect.any(AbortSignal),
    );
  });
});

function fixtureSources(whisper: Buffer, tts: Buffer): VoiceSources {
  return {
    schemaVersion: 2,
    engine: { id: "whisper.cpp", commit: "test" },
    model: {
      id: "whisper-small-multilingual-q5_1",
      relativePath: "models/ggml-small-q5_1.bin",
      url: "https://example.test/ggml-small-q5_1.bin",
      byteSize: whisper.byteLength,
      sha256: createHash("sha256").update(whisper).digest("hex"),
    },
    tts: {
      id: "chatterbox-nano-v1",
      engine: "chatterbox",
      variant: "nano",
      sampleRateHz: 24_000,
      files: [
        {
          relativePath: "ve.safetensors",
          url: "https://example.test/ve.safetensors",
          byteSize: tts.byteLength,
          sha256: createHash("sha256").update(tts).digest("hex"),
        },
      ],
    },
    wakeword: {
      id: "hey_eve",
      engine: "livekit-wakeword",
      threshold: 0.5,
      sampleRateHz: 16_000,
      windowSamples: 32_000,
      hopSamples: 1_280,
      files: [
        {
          relativePath: "hey_eve.onnx",
          url: "https://example.test/hey_eve.onnx",
          byteSize: tts.byteLength,
          sha256: createHash("sha256").update(tts).digest("hex"),
        },
      ],
    },
  };
}
