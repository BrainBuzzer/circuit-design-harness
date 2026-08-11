import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TranscriptionResult } from "@shared/voice-contract";

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MIN_DURATION_MS = 250;
const MAX_DURATION_MS = 60_000;
const TRANSCRIPTION_MODEL = "whisper-small-multilingual-q5_1" as const;

export interface TranscriptionRequest {
  readonly projectId: string;
  readonly wavBytes: Uint8Array;
  readonly durationMs: number;
}

export interface LocalWhisperRuntime {
  readonly executablePath: string;
  readonly modelPath: string;
}

export interface LocalWhisperCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type LocalWhisperCommandRunner = (
  executablePath: string,
  args: readonly string[],
  signal: AbortSignal,
) => Promise<LocalWhisperCommandResult>;

export class TranscriptionService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(
    private readonly resolveRuntime: () => Promise<LocalWhisperRuntime | undefined>,
    private readonly isProjectActive: (projectId: string) => boolean,
    private readonly runCommand: LocalWhisperCommandRunner = runWhisperCommand,
  ) {}

  async transcribe(input: TranscriptionRequest): Promise<TranscriptionResult> {
    assertAudioInput(input);
    if (!this.isProjectActive(input.projectId)) {
      throw new Error("Voice input belongs to a project that is no longer active.");
    }

    this.cancel(input.projectId);
    const controller = new AbortController();
    this.activeRequests.set(input.projectId, controller);
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "circuit-harness-stt-"));

    try {
      const runtime = await this.resolveRuntime();
      if (!runtime) {
        throw new Error(
          "The verified local Whisper runtime is unavailable. Rebuild or reinstall the app voice bundle.",
        );
      }
      const audioPath = path.join(temporaryDirectory, "voice-input.wav");
      await writeFile(audioPath, input.wavBytes, { mode: 0o600, flag: "wx" });
      const result = await this.runCommand(
        runtime.executablePath,
        [
          "--model",
          runtime.modelPath,
          "--file",
          audioPath,
          "--language",
          "en",
          "--no-timestamps",
          "--no-prints",
          "--threads",
          String(Math.max(1, Math.min(8, os.availableParallelism() - 1))),
        ],
        controller.signal,
      );
      const text = result.stdout.replaceAll(/\s+/g, " ").trim();
      if (!text) {
        throw new Error("Local Whisper did not detect any speech in this recording.");
      }
      if (!this.isProjectActive(input.projectId)) {
        throw new Error("The active project changed before transcription completed.");
      }
      return { text, provider: "local_whisper", model: TRANSCRIPTION_MODEL };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
      if (this.activeRequests.get(input.projectId) === controller) {
        this.activeRequests.delete(input.projectId);
      }
    }
  }

  cancel(projectId: string): void {
    this.activeRequests.get(projectId)?.abort();
    this.activeRequests.delete(projectId);
  }

  dispose(): void {
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }
}

function assertAudioInput(input: TranscriptionRequest): void {
  if (input.durationMs < MIN_DURATION_MS || input.durationMs > MAX_DURATION_MS) {
    throw new Error("Voice recordings must be between 0.25 and 60 seconds.");
  }
  if (input.wavBytes.byteLength < 44 || input.wavBytes.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("Voice recording size is invalid.");
  }
  const header = Buffer.from(input.wavBytes.subarray(0, 12)).toString("ascii");
  if (!header.startsWith("RIFF") || !header.endsWith("WAVE")) {
    throw new Error("Voice recording is not a recognized PCM WAV file.");
  }
}

async function runWhisperCommand(
  executablePath: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<LocalWhisperCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executablePath,
      args,
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
        windowsHide: true,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`Local Whisper transcription failed: ${stderr.trim() || error.message}`),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
