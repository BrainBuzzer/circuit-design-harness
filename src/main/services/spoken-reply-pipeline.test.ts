import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareSpokenReply } from "@domain/speech-summary";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TtsService } from "./tts-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("spoken reply pipeline (summary → Chatterbox TTS)", () => {
  it("synthesizes prepareSpokenReply output, not the raw assistant message", async () => {
    const fullMessage = [
      "I proposed a current-limited LED circuit on the breadboard.",
      "Place R1 (330 Ω) pin 1 in a1 and pin 2 in a2, C1 (10 µF),",
      "and jumpers on pins D2, D3, D4, D5, D6, D7.",
      "Nothing is applied until you approve the build-map proposal.",
    ].join(" ");
    const summary = prepareSpokenReply(fullMessage);
    expect(summary.length).toBeLessThan(fullMessage.length);
    expect(summary).not.toMatch(/330\s*Ω/i);

    const modelDir = await mkdtemp(path.join(os.tmpdir(), "spoken-pipeline-"));
    temporaryDirectories.push(modelDir);
    const wav = new Uint8Array(48);
    wav.set(new TextEncoder().encode("RIFF"), 0);
    wav.set(new TextEncoder().encode("WAVE"), 8);

    const runner = vi.fn(async (_exe: string, args: readonly string[]) => {
      const textFile = args[args.indexOf("--text-file") + 1];
      const output = args[args.indexOf("--output") + 1];
      if (!textFile || !output) throw new Error("missing sidecar args");
      const spoken = await readFile(textFile, "utf8");
      expect(spoken).toBe(summary);
      expect(spoken).not.toBe(fullMessage);
      expect(spoken).not.toMatch(/330\s*Ω/i);
      await writeFile(output, wav);
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const service = new TtsService(
      async () => ({
        modelDir,
        variant: "nano",
        sampleRateHz: 24_000,
      }),
      path.join(process.cwd(), "scripts", "chatterbox-speak.py"),
      () => "python3",
      runner,
    );

    const result = await service.speak({ text: summary });
    expect(result.provider).toBe("chatterbox");
    expect(result.spokenText).toBe(summary);
    expect(runner).toHaveBeenCalledOnce();
  });
});
