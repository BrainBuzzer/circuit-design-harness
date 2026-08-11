import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SimulatorFileSchema = z.object({
  sourceId: z.string().min(1),
  relativePath: z.string().min(1),
  byteSize: z.int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const SimulatorManifestSchema = z.object({
  schemaVersion: z.literal(1),
  host: z.object({ platform: z.string().min(1), architecture: z.string().min(1) }),
  sources: z.array(z.object({ id: z.string().min(1), commit: z.string().min(1) }).passthrough()),
  runtimeDependencies: z
    .array(
      z.object({
        id: z.string().min(1),
        version: z.string().min(1),
        license: z.string().min(1),
      }),
    )
    .optional(),
  missingMachineModels: z.array(z.string()).optional(),
  productTargets: z.array(z.string()).optional(),
  files: z.array(SimulatorFileSchema),
});

const VoiceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  host: z.object({ platform: z.string().min(1), architecture: z.string().min(1) }),
  engine: z.object({ id: z.literal("whisper.cpp"), commit: z.string().min(1) }).passthrough(),
  model: z.object({ id: z.literal("whisper-small-multilingual-q5_1") }).passthrough(),
  files: z.array(
    z.object({
      relativePath: z.string().min(1),
      byteSize: z.int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

const SIMULATOR_EXECUTABLES = new Set(["simavr", "circuit-simavr-trace", "qemu-system-xtensa"]);
const VOICE_ASSETS = new Set(["bin/whisper-cli", "models/ggml-small-q5_1.bin"]);

export class LocalSimulatorService {
  private readonly verifiedExecutables = new Map<string, string>();
  private readonly verifiedBundles = new Map<string, Map<string, string>>();

  constructor(
    private readonly packaged: boolean,
    private readonly resourcesPath: string,
    private readonly repositoryRoot: string,
  ) {}

  async resolveExecutable(name: string): Promise<string | undefined> {
    if (!SIMULATOR_EXECUTABLES.has(name)) {
      return name;
    }
    const cached = this.verifiedExecutables.get(name);
    if (cached) {
      return cached;
    }
    const hostId = `${process.platform}-${process.arch}`;
    const hostRoot = this.packaged
      ? path.join(this.resourcesPath, "simulators", hostId)
      : path.join(this.repositoryRoot, "simulator", "dist", hostId);
    const suffix = process.platform === "win32" ? ".exe" : "";
    const relativePath = `bin/${name}${suffix}`;
    const bundled = (await this.verifyBundledHost(hostRoot))?.get(relativePath);
    if (bundled) {
      try {
        await access(bundled, constants.X_OK);
      } catch {
        return this.packaged ? undefined : name;
      }
      this.verifiedExecutables.set(name, bundled);
      return bundled;
    }
    return this.packaged ? undefined : name;
  }

  async resolveVoiceAsset(relativePath: string): Promise<string | undefined> {
    if (!VOICE_ASSETS.has(relativePath)) {
      return undefined;
    }
    const hostId = `${process.platform}-${process.arch}`;
    const hostRoot = this.packaged
      ? path.join(this.resourcesPath, "voice", hostId)
      : path.join(this.repositoryRoot, "voice", "dist", hostId);
    const asset = (await this.verifyVoiceBundledHost(hostRoot))?.get(
      process.platform === "win32" && relativePath === "bin/whisper-cli"
        ? "bin/whisper-cli.exe"
        : relativePath,
    );
    if (asset && relativePath === "bin/whisper-cli") {
      try {
        await access(asset, constants.X_OK);
      } catch {
        return undefined;
      }
    }
    return asset;
  }

  private async verifyVoiceBundledHost(hostRoot: string): Promise<Map<string, string> | undefined> {
    const cacheKey = `voice:${hostRoot}`;
    const cached = this.verifiedBundles.get(cacheKey);
    if (cached) {
      return cached;
    }
    try {
      const manifest = VoiceManifestSchema.parse(
        JSON.parse(await readFile(path.join(hostRoot, "manifest.json"), "utf8")),
      );
      if (
        manifest.host.platform !== process.platform ||
        manifest.host.architecture !== process.arch
      ) {
        return undefined;
      }
      const resolvedRoot = await realpath(hostRoot);
      const verified = new Map<string, string>();
      for (const record of manifest.files) {
        if (!isSafeRelativePath(record.relativePath) || verified.has(record.relativePath)) {
          return undefined;
        }
        const filePath = path.join(hostRoot, ...record.relativePath.split("/"));
        const fileInfo = await lstat(filePath);
        const resolved = await realpath(filePath);
        if (!fileInfo.isFile() || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
          return undefined;
        }
        const content = await readFile(resolved);
        if (
          content.byteLength !== record.byteSize ||
          createHash("sha256").update(content).digest("hex") !== record.sha256
        ) {
          return undefined;
        }
        verified.set(record.relativePath, filePath);
      }
      this.verifiedBundles.set(cacheKey, verified);
      return verified;
    } catch {
      return undefined;
    }
  }

  private async verifyBundledHost(hostRoot: string): Promise<Map<string, string> | undefined> {
    const cached = this.verifiedBundles.get(hostRoot);
    if (cached) {
      return cached;
    }
    try {
      const manifest = SimulatorManifestSchema.parse(
        JSON.parse(await readFile(path.join(hostRoot, "manifest.json"), "utf8")),
      );
      if (
        manifest.host.platform !== process.platform ||
        manifest.host.architecture !== process.arch
      ) {
        return undefined;
      }
      const resolvedRoot = await realpath(hostRoot);
      const verified = new Map<string, string>();
      for (const record of manifest.files) {
        if (!isSafeRelativePath(record.relativePath) || verified.has(record.relativePath)) {
          return undefined;
        }
        const filePath = path.join(hostRoot, ...record.relativePath.split("/"));
        const fileInfo = await lstat(filePath);
        const resolved = await realpath(filePath);
        if (!fileInfo.isFile() || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
          return undefined;
        }
        const content = await readFile(resolved);
        if (
          content.byteLength !== record.byteSize ||
          createHash("sha256").update(content).digest("hex") !== record.sha256
        ) {
          return undefined;
        }
        verified.set(record.relativePath, filePath);
      }
      this.verifiedBundles.set(hostRoot, verified);
      return verified;
    } catch {
      return undefined;
    }
  }
}

function isSafeRelativePath(relativePath: string): boolean {
  return (
    relativePath.length > 0 &&
    !path.posix.isAbsolute(relativePath) &&
    path.posix.normalize(relativePath) === relativePath &&
    relativePath !== ".." &&
    !relativePath.startsWith("../")
  );
}
