import { describe, expect, it, vi } from "vitest";
import { TranscriptionService } from "./transcription-service";

const WAV_BYTES = (() => {
  const bytes = new Uint8Array(48);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return bytes;
})();

describe("TranscriptionService", () => {
  it("runs the verified local multilingual Whisper model without provider credentials", async () => {
    const runner = vi.fn().mockResolvedValue({
      stdout: "  Set the resistor to 330 ohms.\n",
      stderr: "",
    });
    const service = new TranscriptionService(
      async () => ({ executablePath: "/voice/whisper-cli", modelPath: "/voice/model.bin" }),
      (projectId) => projectId === "project-1",
      runner,
    );

    await expect(
      service.transcribe({ projectId: "project-1", wavBytes: WAV_BYTES, durationMs: 1_000 }),
    ).resolves.toEqual({
      text: "Set the resistor to 330 ohms.",
      provider: "local_whisper",
      model: "whisper-small-multilingual-q5_1",
    });
    expect(runner).toHaveBeenCalledWith(
      "/voice/whisper-cli",
      expect.arrayContaining(["--model", "/voice/model.bin", "--language", "en"]),
      expect.any(AbortSignal),
    );
  });

  it("rejects unavailable runtimes, malformed audio, and stale projects", async () => {
    const unavailable = new TranscriptionService(
      async () => undefined,
      () => true,
    );
    await expect(
      unavailable.transcribe({ projectId: "project-1", wavBytes: WAV_BYTES, durationMs: 500 }),
    ).rejects.toThrow(/Whisper runtime is unavailable.*downloading|verification/i);

    const malformed = new TranscriptionService(
      async () => ({ executablePath: "whisper", modelPath: "model" }),
      () => true,
    );
    await expect(
      malformed.transcribe({
        projectId: "project-1",
        wavBytes: new Uint8Array(48),
        durationMs: 500,
      }),
    ).rejects.toThrow("not a recognized PCM WAV");

    const stale = new TranscriptionService(
      async () => ({ executablePath: "whisper", modelPath: "model" }),
      () => false,
    );
    await expect(
      stale.transcribe({ projectId: "project-1", wavBytes: WAV_BYTES, durationMs: 500 }),
    ).rejects.toThrow("no longer active");
  });
});
