import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { WakeWordModelPaths } from "./voice-asset-service";

export type WakeWordEvent =
  | { readonly type: "ready" }
  | { readonly type: "scores"; readonly scores: Readonly<Record<string, number>> }
  | { readonly type: "detection"; readonly name: string; readonly confidence: number }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "stopped" };

export type ResolveWakeWordModel = () => Promise<WakeWordModelPaths | undefined>;

/**
 * Main-process LiveKit wake-word adapter. Spawns a bounded Python sidecar that
 * runs livekit-wakeword ONNX inference on PCM frames (no continuous Whisper).
 */
export class WakeWordService {
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready = false;
  private startPromise: Promise<void> | undefined;
  private readyWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    private readonly resolveModel: ResolveWakeWordModel,
    private readonly sidecarScriptPath: string,
    private readonly pythonExecutable: string = "python3",
    private readonly onEvent: (event: WakeWordEvent) => void = () => undefined,
  ) {}

  isRunning(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  isReady(): boolean {
    return this.ready && this.isRunning();
  }

  async start(): Promise<void> {
    if (this.isReady()) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInner().finally(() => {
      this.startPromise = undefined;
    });
    return this.startPromise;
  }

  async pushPcm16(samples: Int16Array): Promise<void> {
    if (!this.child?.stdin.writable) {
      throw new Error("Wake word detector is not running.");
    }
    if (samples.length === 0) {
      return;
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(samples.length, 0);
    const body = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    await new Promise<void>((resolve, reject) => {
      this.child?.stdin.write(Buffer.concat([header, body]), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  stop(): void {
    this.ready = false;
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Wake word detector stopped."));
    }
    const child = this.child;
    this.child = undefined;
    if (!child) {
      return;
    }
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    child.kill("SIGKILL");
    this.onEvent({ type: "stopped" });
  }

  dispose(): void {
    this.stop();
  }

  private async startInner(): Promise<void> {
    if (this.isRunning()) {
      if (this.ready) return;
      return this.waitUntilReady();
    }
    const model = await this.resolveModel();
    if (!model) {
      const message =
        "LiveKit wake-word model is not ready. Wait for first-start download or check Settings.";
      this.onEvent({ type: "error", message });
      throw new Error(message);
    }

    this.ready = false;
    const child = spawn(
      this.pythonExecutable,
      [
        this.sidecarScriptPath,
        "--model",
        model.modelPath,
        "--threshold",
        String(model.threshold),
        "--name",
        model.modelId,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      },
    );
    this.child = child;

    const stderrChunks: string[] = [];
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrChunks.push(chunk);
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      this.handleLine(line);
    });

    child.once("error", (error) => {
      this.ready = false;
      this.child = undefined;
      const message = `Wake word process failed: ${error.message}`;
      this.failWaiters(message);
      this.onEvent({ type: "error", message });
    });

    child.once("exit", (code, signal) => {
      this.ready = false;
      if (this.child === child) {
        this.child = undefined;
      }
      if (code && code !== 0) {
        const detail = stderrChunks.join("").trim();
        const message = `Wake word process exited (${signal ?? code})${detail ? `: ${detail}` : ""}`;
        this.failWaiters(message);
        this.onEvent({ type: "error", message });
      } else {
        this.onEvent({ type: "stopped" });
      }
    });

    await this.waitUntilReady();
  }

  private waitUntilReady(): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((waiter) => waiter.timer !== timer);
        // Allow slow Python imports; frames can still flow once ready arrives.
        resolve();
      }, 20_000);
      this.readyWaiters.push({ resolve, reject, timer });
    });
  }

  private failWaiters(message: string): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
  }

  private resolveWaiters(): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed) as {
        type?: string;
        scores?: Record<string, number>;
        name?: string;
        confidence?: number;
        message?: string;
      };
      if (parsed.type === "ready") {
        this.ready = true;
        this.resolveWaiters();
        this.onEvent({ type: "ready" });
        return;
      }
      if (parsed.type === "scores" && parsed.scores) {
        this.onEvent({ type: "scores", scores: parsed.scores });
        return;
      }
      if (
        parsed.type === "detection" &&
        typeof parsed.name === "string" &&
        typeof parsed.confidence === "number"
      ) {
        this.onEvent({
          type: "detection",
          name: parsed.name,
          confidence: parsed.confidence,
        });
        return;
      }
      if (parsed.type === "error") {
        const message = parsed.message ?? "Wake word error.";
        this.failWaiters(message);
        this.onEvent({ type: "error", message });
      }
    } catch {
      this.onEvent({
        type: "error",
        message: `Invalid wake word output: ${trimmed.slice(0, 200)}`,
      });
    }
  }
}
