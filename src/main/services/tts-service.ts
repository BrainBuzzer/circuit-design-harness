import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatterboxModelPaths } from "./voice-asset-service";

const MAX_SPEECH_CHARS = 500;
const SYNTH_TIMEOUT_MS = 180_000;
const MAX_WAV_BYTES = 8 * 1024 * 1024;

export interface SpeakRequest {
  readonly text: string;
  readonly exaggeration?: number | undefined;
}

export interface SpeakResult {
  readonly provider: "chatterbox";
  readonly model: string;
  readonly sampleRateHz: number;
  readonly wavBytes: Uint8Array;
  readonly spokenText: string;
}

export interface TtsCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type TtsCommandRunner = (
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  },
) => Promise<TtsCommandResult>;

export type ResolveChatterboxModel = () => Promise<ChatterboxModelPaths | undefined>;

/**
 * Local Chatterbox (Resemble AI open-source TTS) synthesis adapter.
 * Requires hash-verified model files from VoiceAssetService; does not use
 * browser speechSynthesis.
 */
export class TtsService {
  private active: AbortController | undefined;

  constructor(
    private readonly resolveModel: ResolveChatterboxModel,
    private readonly sidecarScriptPath: string,
    private readonly pythonExecutable: string = "python3",
    private readonly runCommand: TtsCommandRunner = runTtsCommand,
    private readonly modelId: string = "chatterbox-nano-v1",
  ) {}

  async isReady(): Promise<boolean> {
    return Boolean(await this.resolveModel());
  }

  cancel(): void {
    this.active?.abort();
    this.active = undefined;
  }

  async speak(input: SpeakRequest): Promise<SpeakResult> {
    const spokenText = input.text.replaceAll(/\s+/g, " ").trim();
    if (!spokenText) {
      throw new Error("Spoken text is empty.");
    }
    if (spokenText.length > MAX_SPEECH_CHARS) {
      throw new Error(`Spoken text exceeds ${MAX_SPEECH_CHARS} characters.`);
    }

    const model = await this.resolveModel();
    if (!model) {
      throw new Error(
        "Chatterbox TTS model is not ready. Wait for the first-start voice download to finish, or check Settings.",
      );
    }

    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "circuit-harness-tts-"));

    try {
      const textPath = path.join(temporaryDirectory, "speech.txt");
      const wavPath = path.join(temporaryDirectory, "speech.wav");
      await writeFile(textPath, spokenText, { mode: 0o600, flag: "wx" });
      const exaggeration = clamp(input.exaggeration ?? 0.5, 0, 1);
      const result = await this.runCommand(
        this.pythonExecutable,
        [
          this.sidecarScriptPath,
          "--model-dir",
          model.modelDir,
          "--text-file",
          textPath,
          "--output",
          wavPath,
          "--device",
          "cpu",
          "--variant",
          model.variant,
          "--exaggeration",
          String(exaggeration),
        ],
        {
          cwd: model.modelDir,
          signal: controller.signal,
          timeoutMs: SYNTH_TIMEOUT_MS,
        },
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Chatterbox synthesis failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
        );
      }
      const wavBytes = new Uint8Array(await readFile(wavPath));
      if (wavBytes.byteLength < 44 || wavBytes.byteLength > MAX_WAV_BYTES) {
        throw new Error("Chatterbox produced an invalid WAV payload.");
      }
      const header = Buffer.from(wavBytes.subarray(0, 12)).toString("ascii");
      if (!header.startsWith("RIFF") || !header.endsWith("WAVE")) {
        throw new Error("Chatterbox output is not a PCM WAV file.");
      }
      return {
        provider: "chatterbox",
        model: this.modelId,
        sampleRateHz: model.sampleRateHz,
        wavBytes,
        spokenText,
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      if (this.active === controller) {
        this.active = undefined;
      }
    }
  }

  dispose(): void {
    this.cancel();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function runTtsCommand(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly signal: AbortSignal;
    readonly timeoutMs: number;
  },
): Promise<TtsCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
        signal: options.signal,
        shell: false,
      },
      (error, stdout, stderr) => {
        if (error && !("code" in error)) {
          reject(new Error(`Chatterbox TTS process failed: ${stderr.trim() || error.message}`));
          return;
        }
        const exitCode =
          error && "code" in error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}
