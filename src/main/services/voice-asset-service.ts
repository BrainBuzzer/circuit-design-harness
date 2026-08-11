import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const DownloadableFileSchema = z.object({
  relativePath: z.string().min(1),
  url: z.string().url(),
  byteSize: z.number().int().positive(),
  sha256: Sha256Schema,
});

export const VoiceSourcesSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  engine: z
    .object({
      id: z.literal("whisper.cpp"),
      commit: z.string().min(1),
    })
    .passthrough(),
  model: z.object({
    id: z.literal("whisper-small-multilingual-q5_1"),
    relativePath: z.string().min(1).default("models/ggml-small-q5_1.bin"),
    url: z.string().url(),
    byteSize: z.number().int().positive(),
    sha256: Sha256Schema,
  }),
  tts: z
    .object({
      id: z.string().min(1),
      engine: z.literal("chatterbox"),
      variant: z.enum(["nano", "turbo", "original"]).default("nano"),
      sampleRateHz: z.number().int().positive(),
      files: z.array(DownloadableFileSchema).min(1),
    })
    .passthrough()
    .optional(),
  wakeword: z
    .object({
      id: z.string().min(1),
      engine: z.literal("livekit-wakeword"),
      threshold: z.number().finite().min(0).max(1).default(0.5),
      sampleRateHz: z.number().int().positive().default(16_000),
      windowSamples: z.number().int().positive().default(32_000),
      hopSamples: z.number().int().positive().default(1_280),
      files: z.array(DownloadableFileSchema).min(1),
    })
    .passthrough()
    .optional(),
});

export type VoiceSources = z.infer<typeof VoiceSourcesSchema>;
export type DownloadableFile = z.infer<typeof DownloadableFileSchema>;

export type VoiceAssetKind = "whisper_model" | "chatterbox_tts" | "wakeword_model";

export interface VoiceAssetComponentStatus {
  readonly kind: VoiceAssetKind;
  readonly label: string;
  readonly ready: boolean;
  readonly downloading: boolean;
  readonly error?: string | undefined;
  readonly bytesDownloaded?: number | undefined;
  readonly bytesTotal?: number | undefined;
  readonly percent?: number | undefined;
  readonly currentFile?: string | undefined;
  readonly message?: string | undefined;
}

export interface VoiceModelAssetsStatus {
  readonly whisper: VoiceAssetComponentStatus;
  readonly chatterbox: VoiceAssetComponentStatus;
  readonly wakeword: VoiceAssetComponentStatus;
  readonly modelsReady: boolean;
}

export interface LocalWhisperPaths {
  readonly executablePath: string;
  readonly modelPath: string;
}

export interface ChatterboxModelPaths {
  readonly modelDir: string;
  readonly variant: "nano" | "turbo" | "original";
  readonly sampleRateHz: number;
}

export interface WakeWordModelPaths {
  readonly modelPath: string;
  readonly modelId: string;
  readonly threshold: number;
  readonly sampleRateHz: number;
  readonly windowSamples: number;
  readonly hopSamples: number;
}

export type AssetBytesFetcher = (
  url: string,
  signal: AbortSignal,
  onProgress?: (bytesReceived: number, bytesTotal: number | undefined) => void,
) => Promise<Uint8Array>;

export interface VoiceAssetServiceOptions {
  readonly assetsRoot: string;
  readonly sources: VoiceSources;
  readonly resolveWhisperExecutable: () => Promise<string | undefined>;
  /** Optional packaged/dev fallback for the Whisper model (not used after userData is ready). */
  readonly resolvePackagedWhisperModel?: () => Promise<string | undefined>;
  /** Optional packaged/dev fallback for the LiveKit/openWakeWord classifier ONNX. */
  readonly resolvePackagedWakewordModel?: () => Promise<string | undefined>;
  readonly fetchBytes?: AssetBytesFetcher;
  readonly onStatus?: ((status: VoiceModelAssetsStatus) => void) | undefined;
  readonly now?: () => number;
}

/**
 * Downloads and hash-verifies large voice model weights into the app userData
 * directory on first start. Models are not required inside the installer bundle.
 */
export class VoiceAssetService {
  private readonly fetchBytes: AssetBytesFetcher;
  private readonly onStatus: ((status: VoiceModelAssetsStatus) => void) | undefined;
  private readonly now: () => number;
  private readonly whisperState: MutableComponentState;
  private readonly chatterboxState: MutableComponentState;
  private readonly wakewordState: MutableComponentState;
  private ensurePromise: Promise<void> | undefined;
  private readonly abort = new AbortController();

  constructor(private readonly options: VoiceAssetServiceOptions) {
    this.fetchBytes = options.fetchBytes ?? defaultFetchBytes;
    this.onStatus = options.onStatus;
    this.now = options.now ?? Date.now;
    this.whisperState = {
      kind: "whisper_model",
      label: "Whisper STT model",
      ready: false,
      downloading: false,
    };
    this.chatterboxState = {
      kind: "chatterbox_tts",
      label: "Chatterbox TTS weights",
      ready: false,
      downloading: false,
    };
    this.wakewordState = {
      kind: "wakeword_model",
      label: "LiveKit wake-word model",
      ready: false,
      downloading: false,
    };
  }

  getStatus(): VoiceModelAssetsStatus {
    return {
      whisper: toPublicComponent(this.whisperState),
      chatterbox: toPublicComponent(this.chatterboxState),
      wakeword: toPublicComponent(this.wakewordState),
      modelsReady:
        this.whisperState.ready && this.chatterboxState.ready && this.wakewordState.ready,
    };
  }

  /**
   * Idempotent: verifies existing downloads, then downloads any missing/tampered assets.
   */
  ensureAssets(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = this.runEnsure().finally(() => {
        this.ensurePromise = undefined;
      });
    }
    return this.ensurePromise;
  }

  async resolveWhisperRuntime(): Promise<LocalWhisperPaths | undefined> {
    const executablePath = await this.options.resolveWhisperExecutable();
    if (!executablePath) {
      return undefined;
    }
    const modelPath = await this.resolveWhisperModelPath();
    if (!modelPath) {
      return undefined;
    }
    return { executablePath, modelPath };
  }

  async resolveChatterboxModel(): Promise<ChatterboxModelPaths | undefined> {
    const tts = this.options.sources.tts;
    if (!tts) {
      return undefined;
    }
    const modelDir = this.chatterboxDir();
    for (const file of tts.files) {
      const ok = await this.isFileVerified(path.join(modelDir, file.relativePath), file);
      if (!ok) {
        this.chatterboxState.ready = false;
        this.emitStatus();
        return undefined;
      }
    }
    this.chatterboxState.ready = true;
    this.chatterboxState.error = undefined;
    this.emitStatus();
    return {
      modelDir,
      variant: tts.variant ?? "nano",
      sampleRateHz: tts.sampleRateHz,
    };
  }

  async resolveWakeWordModel(): Promise<WakeWordModelPaths | undefined> {
    const wake = this.options.sources.wakeword;
    if (!wake) {
      return undefined;
    }
    const file = wake.files[0];
    if (!file) {
      return undefined;
    }
    const modelPath = path.join(this.wakewordDir(), file.relativePath);
    if (!(await this.isFileVerified(modelPath, file))) {
      this.wakewordState.ready = false;
      this.emitStatus();
      return undefined;
    }
    this.wakewordState.ready = true;
    this.wakewordState.error = undefined;
    this.emitStatus();
    return {
      modelPath,
      modelId: wake.id,
      threshold: wake.threshold ?? 0.5,
      sampleRateHz: wake.sampleRateHz ?? 16_000,
      windowSamples: wake.windowSamples ?? 32_000,
      hopSamples: wake.hopSamples ?? 1_280,
    };
  }

  dispose(): void {
    this.abort.abort();
  }

  private async runEnsure(): Promise<void> {
    await mkdir(this.options.assetsRoot, { recursive: true, mode: 0o700 });
    await Promise.all([
      this.ensureWhisperModel(),
      this.ensureChatterboxModels(),
      this.ensureWakeWordModel(),
    ]);
  }

  private async ensureWhisperModel(): Promise<void> {
    const model = this.options.sources.model;
    const relativePath = model.relativePath ?? "models/ggml-small-q5_1.bin";
    const target = path.join(this.whisperDir(), relativePath);
    const record: DownloadableFile = {
      relativePath,
      url: model.url,
      byteSize: model.byteSize,
      sha256: model.sha256,
    };
    if (await this.isFileVerified(target, record)) {
      this.whisperState.ready = true;
      this.whisperState.error = undefined;
      this.emitStatus();
      return;
    }
    const packaged = await this.options.resolvePackagedWhisperModel?.();
    if (packaged) {
      try {
        const bytes = await readFile(packaged);
        if (
          bytes.byteLength === record.byteSize &&
          createHash("sha256").update(bytes).digest("hex") === record.sha256
        ) {
          await this.writeVerifiedFile(target, bytes, record);
          this.whisperState.ready = true;
          this.whisperState.error = undefined;
          this.emitStatus();
          return;
        }
      } catch {
        // Fall through to network download.
      }
    }
    await this.downloadFile(target, record, this.whisperState);
  }

  private async ensureChatterboxModels(): Promise<void> {
    const tts = this.options.sources.tts;
    if (!tts) {
      this.chatterboxState.ready = false;
      this.chatterboxState.error = "Chatterbox TTS sources are not configured.";
      this.emitStatus();
      return;
    }
    const modelDir = this.chatterboxDir();
    let allReady = true;
    for (const file of tts.files) {
      const target = path.join(modelDir, file.relativePath);
      if (await this.isFileVerified(target, file)) {
        continue;
      }
      allReady = false;
      await this.downloadFile(target, file, this.chatterboxState);
      if (!(await this.isFileVerified(target, file))) {
        allReady = false;
        break;
      }
    }
    this.chatterboxState.ready = allReady;
    if (allReady) {
      this.chatterboxState.error = undefined;
    }
    this.emitStatus();
  }

  private async ensureWakeWordModel(): Promise<void> {
    const wake = this.options.sources.wakeword;
    if (!wake) {
      this.wakewordState.ready = false;
      this.wakewordState.error = "Wake word sources are not configured.";
      this.emitStatus();
      return;
    }
    const file = wake.files[0];
    if (!file) {
      this.wakewordState.ready = false;
      this.wakewordState.error = "Wake word model file is not configured.";
      this.emitStatus();
      return;
    }
    const target = path.join(this.wakewordDir(), file.relativePath);
    if (await this.isFileVerified(target, file)) {
      this.wakewordState.ready = true;
      this.wakewordState.error = undefined;
      this.emitStatus();
      return;
    }
    const packaged = await this.options.resolvePackagedWakewordModel?.();
    if (packaged) {
      try {
        const bytes = await readFile(packaged);
        if (
          bytes.byteLength === file.byteSize &&
          createHash("sha256").update(bytes).digest("hex") === file.sha256
        ) {
          await this.writeVerifiedFile(target, bytes, file);
          this.wakewordState.ready = true;
          this.wakewordState.error = undefined;
          this.emitStatus();
          return;
        }
      } catch {
        // Fall through to network download.
      }
    }
    await this.downloadFile(target, file, this.wakewordState);
    if (await this.isFileVerified(target, file)) {
      this.wakewordState.ready = true;
      this.wakewordState.error = undefined;
    }
    this.emitStatus();
  }

  private async downloadFile(
    targetPath: string,
    file: DownloadableFile,
    state: MutableComponentState,
  ): Promise<void> {
    state.downloading = true;
    state.error = undefined;
    state.bytesDownloaded = 0;
    state.bytesTotal = file.byteSize;
    state.currentFile = file.relativePath;
    state.message = `Downloading ${file.relativePath}…`;
    this.emitStatus();
    const temporaryPath = `${targetPath}.partial-${this.now()}`;
    try {
      await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      const bytes = await this.fetchBytes(file.url, this.abort.signal, (received, total) => {
        state.bytesDownloaded = received;
        state.bytesTotal = total ?? file.byteSize;
        state.message = `Downloading ${file.relativePath} (${formatBytes(received)} / ${formatBytes(state.bytesTotal)})…`;
        this.emitStatus();
      });
      if (bytes.byteLength !== file.byteSize) {
        throw new Error(
          `Downloaded size mismatch for ${file.relativePath}: expected ${file.byteSize}, got ${bytes.byteLength}.`,
        );
      }
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== file.sha256) {
        throw new Error(
          `Downloaded hash mismatch for ${file.relativePath}: expected ${file.sha256}, got ${hash}.`,
        );
      }
      await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
      await rename(temporaryPath, targetPath);
      if (state.kind === "whisper_model" || state.kind === "wakeword_model") {
        state.ready = true;
      }
      state.error = undefined;
      state.message = `Verified ${file.relativePath}`;
    } catch (reason) {
      state.ready = false;
      state.error = reason instanceof Error ? reason.message : String(reason);
      state.message = state.error;
      await rm(temporaryPath, { force: true });
    } finally {
      state.downloading = false;
      this.emitStatus();
    }
  }

  private async writeVerifiedFile(
    targetPath: string,
    bytes: Uint8Array,
    file: DownloadableFile,
  ): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${targetPath}.copy-${this.now()}`;
    await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporaryPath, targetPath);
    void file;
  }

  private async resolveWhisperModelPath(): Promise<string | undefined> {
    const model = this.options.sources.model;
    const relativePath = model.relativePath ?? "models/ggml-small-q5_1.bin";
    const downloaded = path.join(this.whisperDir(), relativePath);
    const record: DownloadableFile = {
      relativePath,
      url: model.url,
      byteSize: model.byteSize,
      sha256: model.sha256,
    };
    if (await this.isFileVerified(downloaded, record)) {
      this.whisperState.ready = true;
      this.whisperState.error = undefined;
      this.emitStatus();
      return downloaded;
    }
    const packaged = await this.options.resolvePackagedWhisperModel?.();
    if (packaged && (await this.isFileVerified(packaged, record))) {
      return packaged;
    }
    this.whisperState.ready = false;
    this.emitStatus();
    return undefined;
  }

  private async isFileVerified(filePath: string, file: DownloadableFile): Promise<boolean> {
    try {
      await access(filePath);
      const info = await stat(filePath);
      if (!info.isFile() || info.size !== file.byteSize) {
        return false;
      }
      const content = await readFile(filePath);
      return createHash("sha256").update(content).digest("hex") === file.sha256;
    } catch {
      return false;
    }
  }

  private whisperDir(): string {
    return path.join(this.options.assetsRoot, "whisper");
  }

  private chatterboxDir(): string {
    return path.join(this.options.assetsRoot, "chatterbox");
  }

  private wakewordDir(): string {
    return path.join(this.options.assetsRoot, "wakeword");
  }

  private emitStatus(): void {
    this.onStatus?.(this.getStatus());
  }
}

type MutableComponentState = {
  kind: VoiceAssetKind;
  label: string;
  ready: boolean;
  downloading: boolean;
  error?: string | undefined;
  bytesDownloaded?: number | undefined;
  bytesTotal?: number | undefined;
  currentFile?: string | undefined;
  message?: string | undefined;
};

function toPublicComponent(state: MutableComponentState): VoiceAssetComponentStatus {
  const bytesDownloaded = state.bytesDownloaded;
  const bytesTotal = state.bytesTotal;
  const percent =
    typeof bytesDownloaded === "number" && typeof bytesTotal === "number" && bytesTotal > 0
      ? Math.min(100, Math.round((bytesDownloaded / bytesTotal) * 100))
      : state.ready
        ? 100
        : undefined;
  return {
    kind: state.kind,
    label: state.label,
    ready: state.ready,
    downloading: state.downloading,
    error: state.error,
    bytesDownloaded,
    bytesTotal,
    percent,
    currentFile: state.currentFile,
    message:
      state.message ??
      (state.ready
        ? `${state.label} ready`
        : state.downloading
          ? `Downloading ${state.currentFile ?? state.label}…`
          : state.error
            ? state.error
            : `${state.label} not ready`),
  };
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export async function loadVoiceSources(sourcesPath: string): Promise<VoiceSources> {
  const raw = JSON.parse(await readFile(sourcesPath, "utf8")) as unknown;
  return VoiceSourcesSchema.parse(raw);
}

export async function defaultFetchBytes(
  url: string,
  signal: AbortSignal,
  onProgress?: (bytesReceived: number, bytesTotal: number | undefined) => void,
): Promise<Uint8Array> {
  const allowed = new URL(url);
  if (allowed.protocol !== "https:") {
    throw new Error("Voice asset downloads must use HTTPS.");
  }
  const response = await fetch(url, {
    signal,
    redirect: "follow",
    headers: { Accept: "application/octet-stream,*/*" },
  });
  if (!response.ok) {
    throw new Error(`Voice asset download failed (${response.status}) for ${url}.`);
  }
  const totalHeader = response.headers.get("content-length");
  const total = totalHeader ? Number(totalHeader) : undefined;
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    onProgress?.(buffer.byteLength, total ?? buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.(received, total);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Stream-to-file helper kept for large downloads without holding full buffers in tests that inject fetchBytes. */
export async function writeStreamToFile(
  source: Readable,
  targetPath: string,
  signal: AbortSignal,
): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.partial`;
  try {
    await pipeline(source, createWriteStream(temporaryPath, { mode: 0o600 }), { signal });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export function isWhisperUnavailableMessage(message: string): boolean {
  return /whisper runtime is unavailable|verified local Whisper runtime is unavailable|voice assets are still downloading/i.test(
    message,
  );
}
