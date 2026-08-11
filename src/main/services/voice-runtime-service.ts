import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface VoiceRuntimeStatus {
  readonly ready: boolean;
  readonly installing: boolean;
  readonly pythonPath?: string | undefined;
  readonly message: string;
  readonly packages: readonly string[];
  readonly logTail: string;
  readonly error?: string | undefined;
}

export type VoiceRuntimeStatusListener = (status: VoiceRuntimeStatus) => void;

const DEFAULT_PACKAGES = [
  "livekit-wakeword==0.2.1",
  "numpy",
  "soundfile",
  "chatterbox-tts",
  "torch",
  "torchaudio",
] as const;

/**
 * Creates a project-local Python venv under userData and installs pinned
 * packages for LiveKit wake-word + Chatterbox TTS. Progress is visible via status.
 */
export class VoiceRuntimeService {
  private ensurePromise: Promise<void> | undefined;
  private status: VoiceRuntimeStatus;
  private readonly logLines: string[] = [];

  constructor(
    private readonly runtimeRoot: string,
    private readonly systemPython: string = "python3",
    private readonly packages: readonly string[] = DEFAULT_PACKAGES,
    private readonly onStatus?: VoiceRuntimeStatusListener,
  ) {
    this.status = {
      ready: false,
      installing: false,
      message: "Python voice runtime not checked yet.",
      packages: [...packages],
      logTail: "",
    };
  }

  getStatus(): VoiceRuntimeStatus {
    return { ...this.status, logTail: this.logLines.slice(-40).join("\n") };
  }

  getPythonExecutable(): string | undefined {
    return this.status.ready ? this.status.pythonPath : undefined;
  }

  ensureRuntime(): Promise<void> {
    if (!this.ensurePromise) {
      this.ensurePromise = this.runEnsure().finally(() => {
        this.ensurePromise = undefined;
      });
    }
    return this.ensurePromise;
  }

  private async runEnsure(): Promise<void> {
    await mkdir(this.runtimeRoot, { recursive: true, mode: 0o700 });
    const venvDir = path.join(this.runtimeRoot, "venv");
    const pythonPath =
      process.platform === "win32"
        ? path.join(venvDir, "Scripts", "python.exe")
        : path.join(venvDir, "bin", "python");
    const markerPath = path.join(this.runtimeRoot, "install-marker.json");

    this.setStatus({
      ready: false,
      installing: true,
      pythonPath,
      message: "Preparing local Python voice runtime…",
      packages: [...this.packages],
      logTail: "",
    });

    try {
      const markerOk = await this.markerSatisfied(markerPath, pythonPath);
      if (markerOk) {
        await this.verifyImports(pythonPath);
        this.setStatus({
          ready: true,
          installing: false,
          pythonPath,
          message: "Python voice runtime ready (LiveKit wake word + Chatterbox).",
          packages: [...this.packages],
          logTail: this.logLines.slice(-40).join("\n"),
        });
        return;
      }

      const venvExists = await pathExists(pythonPath);
      if (!venvExists) {
        this.appendLog(`Creating venv with ${this.systemPython}…`);
        this.setStatus({
          ...this.getStatus(),
          installing: true,
          message: "Creating Python virtual environment…",
        });
        await this.runProcess(this.systemPython, ["-m", "venv", venvDir], this.runtimeRoot);
      }

      this.appendLog("Upgrading pip…");
      this.setStatus({
        ...this.getStatus(),
        message: "Upgrading pip in voice runtime…",
      });
      await this.runProcess(pythonPath, ["-m", "pip", "install", "--upgrade", "pip"], venvDir);

      for (const pkg of this.packages) {
        this.appendLog(`Installing ${pkg}…`);
        this.setStatus({
          ...this.getStatus(),
          message: `Installing ${pkg}… (this can take several minutes for torch)`,
        });
        await this.runProcess(
          pythonPath,
          ["-m", "pip", "install", "--disable-pip-version-check", pkg],
          venvDir,
        );
      }

      await this.verifyImports(pythonPath);
      await writeFile(
        markerPath,
        `${JSON.stringify(
          {
            packages: this.packages,
            installedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        { mode: 0o600 },
      );

      this.setStatus({
        ready: true,
        installing: false,
        pythonPath,
        message: "Python voice runtime ready (LiveKit wake word + Chatterbox).",
        packages: [...this.packages],
        logTail: this.logLines.slice(-40).join("\n"),
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      this.appendLog(`ERROR: ${message}`);
      this.setStatus({
        ready: false,
        installing: false,
        pythonPath: undefined,
        message: "Python voice runtime setup failed.",
        packages: [...this.packages],
        logTail: this.logLines.slice(-40).join("\n"),
        error: message,
      });
      throw reason instanceof Error ? reason : new Error(message);
    }
  }

  private async markerSatisfied(markerPath: string, pythonPath: string): Promise<boolean> {
    try {
      if (!(await pathExists(pythonPath))) return false;
      const raw = JSON.parse(await readFile(markerPath, "utf8")) as { packages?: string[] };
      const installed = new Set(raw.packages ?? []);
      return this.packages.every((pkg) => installed.has(pkg));
    } catch {
      return false;
    }
  }

  private async verifyImports(pythonPath: string): Promise<void> {
    this.appendLog("Verifying imports…");
    await this.runProcess(
      pythonPath,
      [
        "-c",
        [
          "from livekit.wakeword import WakeWordModel",
          "from chatterbox.tts_turbo import ChatterboxTurboTTS",
          "print('ok')",
        ].join("; "),
      ],
      this.runtimeRoot,
    );
  }

  private runProcess(executable: string, args: readonly string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: false,
      });
      const onChunk = (chunk: Buffer): void => {
        const text = chunk.toString("utf8");
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) this.appendLog(trimmed);
        }
        this.setStatus({
          ...this.getStatus(),
          installing: true,
          logTail: this.logLines.slice(-40).join("\n"),
        });
      };
      child.stdout.on("data", onChunk);
      child.stderr.on("data", onChunk);
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `${executable} ${args.join(" ")} failed (${signal ?? `code ${code}`}). See voice runtime log.`,
            ),
          );
      });
    });
  }

  private appendLog(line: string): void {
    this.logLines.push(line.slice(0, 500));
    if (this.logLines.length > 200) {
      this.logLines.splice(0, this.logLines.length - 200);
    }
  }

  private setStatus(status: VoiceAssetStatusLike): void {
    this.status = {
      ready: status.ready,
      installing: status.installing,
      pythonPath: status.pythonPath,
      message: status.message,
      packages: status.packages,
      logTail: status.logTail,
      error: status.error,
    };
    this.onStatus?.(this.getStatus());
  }
}

type VoiceAssetStatusLike = VoiceRuntimeStatus;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
