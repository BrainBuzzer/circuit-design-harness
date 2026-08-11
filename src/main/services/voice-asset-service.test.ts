import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AssetBytesFetcher,
  VoiceAssetService,
  type VoiceSources,
} from "./voice-asset-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("VoiceAssetService", () => {
  it("downloads missing Whisper and Chatterbox assets, verifies SHA-256, then reports ready", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-assets-"));
    temporaryDirectories.push(root);
    const whisperBytes = Buffer.from("whisper-model-fixture-bytes");
    const ttsFiles = fixtureTtsFiles();
    const wakeBytes = Buffer.from("wake-onnx-fixture");
    const sourcesWithWake = fixtureSources(whisperBytes, ttsFiles, wakeBytes);
    const fetchBytes = vi.fn<AssetBytesFetcher>(async (url) => {
      if (url.includes("ggml")) return new Uint8Array(whisperBytes);
      if (url.includes("hey_livekit")) return new Uint8Array(wakeBytes);
      const match = ttsFiles.find((file) => url.endsWith(file.relativePath));
      if (match) return new Uint8Array(match.bytes);
      throw new Error(`unexpected url ${url}`);
    });
    const statuses: Array<ReturnType<VoiceAssetService["getStatus"]>> = [];
    const service = new VoiceAssetService({
      assetsRoot: path.join(root, "assets"),
      sources: sourcesWithWake,
      resolveWhisperExecutable: async () => "/voice/whisper-cli",
      fetchBytes,
      onStatus: (status) => statuses.push(status),
    });

    expect(service.getStatus().whisper.ready).toBe(false);
    await service.ensureAssets();

    expect(fetchBytes).toHaveBeenCalled();
    const runtime = await service.resolveWhisperRuntime();
    expect(runtime).toEqual({
      executablePath: "/voice/whisper-cli",
      modelPath: path.join(root, "assets", "whisper", "models", "ggml-small-q5_1.bin"),
    });
    expect(await readFile(runtime?.modelPath ?? "")).toEqual(whisperBytes);

    const chatterbox = await service.resolveChatterboxModel();
    expect(chatterbox?.modelDir).toContain(`${path.sep}chatterbox`);
    expect(chatterbox?.variant).toBe("nano");
    const wake = await service.resolveWakeWordModel();
    expect(wake?.modelPath).toContain("hey_livekit.onnx");
    expect(service.getStatus().modelsReady).toBe(true);
    expect(statuses.some((status) => status.whisper.downloading)).toBe(true);
    expect(statuses.at(-1)?.modelsReady).toBe(true);
  });

  it("rejects tampered hashes and leaves readiness false", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-assets-tamper-"));
    temporaryDirectories.push(root);
    const good = Buffer.from("good-bytes");
    const ttsFiles = fixtureTtsFiles().map((file) => ({ ...file, bytes: good }));
    const sources = fixtureSources(good, ttsFiles, good);
    const service = new VoiceAssetService({
      assetsRoot: path.join(root, "assets"),
      sources,
      resolveWhisperExecutable: async () => "/voice/whisper-cli",
      fetchBytes: async () => new Uint8Array(Buffer.from("tampered-content-xxxx")),
    });

    await service.ensureAssets();
    expect(service.getStatus().whisper.ready).toBe(false);
    expect(service.getStatus().whisper.error).toMatch(/hash mismatch|size mismatch/i);
    await expect(service.resolveWhisperRuntime()).resolves.toBeUndefined();
    await expect(service.resolveChatterboxModel()).resolves.toBeUndefined();
  });

  it("reuses a verified on-disk download without re-fetching", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-assets-cache-"));
    temporaryDirectories.push(root);
    const whisperBytes = Buffer.from("cached-whisper");
    const ttsFiles = fixtureTtsFiles();
    const wakeBytes = Buffer.from("cached-wake");
    const sources = fixtureSources(whisperBytes, ttsFiles, wakeBytes);
    const modelPath = path.join(root, "assets", "whisper", "models", "ggml-small-q5_1.bin");
    await mkdir(path.dirname(modelPath), { recursive: true });
    await writeFile(modelPath, whisperBytes);
    await mkdir(path.join(root, "assets", "chatterbox"), { recursive: true });
    for (const file of ttsFiles) {
      await writeFile(path.join(root, "assets", "chatterbox", file.relativePath), file.bytes);
    }
    await mkdir(path.join(root, "assets", "wakeword"), { recursive: true });
    await writeFile(path.join(root, "assets", "wakeword", "hey_livekit.onnx"), wakeBytes);

    const fetchBytes = vi.fn<AssetBytesFetcher>(async () => {
      throw new Error("network should not be used");
    });
    const service = new VoiceAssetService({
      assetsRoot: path.join(root, "assets"),
      sources,
      resolveWhisperExecutable: async () => "/voice/whisper-cli",
      fetchBytes,
    });
    await service.ensureAssets();
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(service.getStatus().modelsReady).toBe(true);
  });
});

function fixtureTtsFiles(): Array<{ relativePath: string; bytes: Buffer }> {
  return [
    { relativePath: "ve.safetensors", bytes: Buffer.from("ve-fixture") },
    { relativePath: "t3_nano_v1.safetensors", bytes: Buffer.from("t3-fixture") },
    { relativePath: "s3gen_meanflow.safetensors", bytes: Buffer.from("s3-fixture") },
    { relativePath: "conds.pt", bytes: Buffer.from("conds-fixture") },
    { relativePath: "vocab.json", bytes: Buffer.from("{}") },
  ];
}

function fixtureSources(
  whisper: Buffer,
  ttsFiles: Array<{ relativePath: string; bytes: Buffer }>,
  wakeBytes: Buffer = Buffer.from("wake-default"),
): VoiceSources {
  return {
    schemaVersion: 2,
    engine: { id: "whisper.cpp", commit: "test" },
    model: {
      id: "whisper-small-multilingual-q5_1",
      relativePath: "models/ggml-small-q5_1.bin",
      url: "https://example.test/ggml-small-q5_1.bin",
      byteSize: whisper.byteLength,
      sha256: sha(whisper),
    },
    tts: {
      id: "chatterbox-nano-v1",
      engine: "chatterbox",
      variant: "nano",
      sampleRateHz: 24_000,
      files: ttsFiles.map((file) => ({
        relativePath: file.relativePath,
        url: `https://example.test/${file.relativePath}`,
        byteSize: file.bytes.byteLength,
        sha256: sha(file.bytes),
      })),
    },
    wakeword: {
      id: "hey_livekit",
      engine: "livekit-wakeword",
      threshold: 0.5,
      sampleRateHz: 16_000,
      windowSamples: 32_000,
      hopSamples: 1_280,
      files: [
        {
          relativePath: "hey_livekit.onnx",
          url: "https://example.test/hey_livekit.onnx",
          byteSize: wakeBytes.byteLength,
          sha256: sha(wakeBytes),
        },
      ],
    },
  };
}

function sha(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
