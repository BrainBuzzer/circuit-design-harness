import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalSimulatorService } from "./local-simulator-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("LocalSimulatorService", () => {
  it("resolves only hash-verified host binaries in packaged mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-simulator-test-"));
    temporaryDirectories.push(root);
    const hostRoot = path.join(root, "simulators", `${process.platform}-${process.arch}`);
    const suffix = process.platform === "win32" ? ".exe" : "";
    const relativePath = `bin/simavr${suffix}`;
    const executable = path.join(hostRoot, ...relativePath.split("/"));
    const content = Buffer.from("simulator fixture");
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, content);
    await chmod(executable, 0o700);
    await writeFile(
      path.join(hostRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        host: { platform: process.platform, architecture: process.arch },
        sources: [{ id: "simavr", commit: "fixture" }],
        missingMachineModels: [],
        files: [
          {
            sourceId: "simavr",
            relativePath,
            byteSize: content.byteLength,
            sha256: createHash("sha256").update(content).digest("hex"),
          },
        ],
      }),
    );
    const service = new LocalSimulatorService(true, root, path.join(root, "unused"));
    await expect(service.resolveExecutable("simavr")).resolves.toBe(executable);
    await expect(service.resolveExecutable("arduino-cli")).resolves.toBe("arduino-cli");
  });

  it("refuses missing or modified simulator binaries in packaged mode", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-simulator-test-"));
    temporaryDirectories.push(root);
    const service = new LocalSimulatorService(true, root, path.join(root, "unused"));
    await expect(service.resolveExecutable("qemu-system-xtensa")).resolves.toBeUndefined();
  });

  it("refuses a bundle when any recorded runtime dependency is modified", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-simulator-test-"));
    temporaryDirectories.push(root);
    const hostRoot = path.join(root, "simulators", `${process.platform}-${process.arch}`);
    const executable = path.join(hostRoot, "bin", "simavr");
    const dependency = path.join(hostRoot, "lib", "runtime.fixture");
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(dependency), { recursive: true });
    await writeFile(executable, "simulator");
    await chmod(executable, 0o700);
    await writeFile(dependency, "modified");
    await writeFile(
      path.join(hostRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        host: { platform: process.platform, architecture: process.arch },
        sources: [{ id: "simavr", commit: "fixture" }],
        missingMachineModels: [],
        files: [
          manifestRecord("bin/simavr", "simulator"),
          manifestRecord("lib/runtime.fixture", "expected"),
        ],
      }),
    );
    const service = new LocalSimulatorService(true, root, path.join(root, "unused"));
    await expect(service.resolveExecutable("simavr")).resolves.toBeUndefined();
  });

  it("resolves only a complete hash-verified local Whisper bundle", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-voice-test-"));
    temporaryDirectories.push(root);
    const hostRoot = path.join(root, "voice", `${process.platform}-${process.arch}`);
    const executableRelativePath =
      process.platform === "win32" ? "bin/whisper-cli.exe" : "bin/whisper-cli";
    const executable = path.join(hostRoot, ...executableRelativePath.split("/"));
    const modelRelativePath = "models/ggml-small-q5_1.bin";
    const model = path.join(hostRoot, ...modelRelativePath.split("/"));
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(model), { recursive: true });
    await writeFile(executable, "local whisper executable");
    await chmod(executable, 0o700);
    await writeFile(model, "local multilingual model");
    await writeFile(
      path.join(hostRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        host: { platform: process.platform, architecture: process.arch },
        engine: { id: "whisper.cpp", commit: "pinned-fixture" },
        model: { id: "whisper-small-multilingual-q5_1" },
        files: [
          manifestRecord(executableRelativePath, "local whisper executable"),
          manifestRecord(modelRelativePath, "local multilingual model"),
        ],
      }),
    );

    const verified = new LocalSimulatorService(true, root, path.join(root, "unused"));
    await expect(verified.resolveVoiceAsset("bin/whisper-cli")).resolves.toBe(executable);
    await expect(verified.resolveVoiceAsset(modelRelativePath)).resolves.toBe(model);

    await writeFile(model, "tampered local multilingual model");
    const tampered = new LocalSimulatorService(true, root, path.join(root, "unused"));
    // Executable remains independently verifiable when only the model is tampered.
    await expect(tampered.resolveVoiceAsset("bin/whisper-cli")).resolves.toBe(executable);
    await expect(tampered.resolveVoiceAsset(modelRelativePath)).resolves.toBeUndefined();
  });

  it("resolves the Whisper executable when the large model is absent from the package", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "local-voice-runtime-only-"));
    temporaryDirectories.push(root);
    const hostRoot = path.join(root, "voice", `${process.platform}-${process.arch}`);
    const executableRelativePath =
      process.platform === "win32" ? "bin/whisper-cli.exe" : "bin/whisper-cli";
    const executable = path.join(hostRoot, ...executableRelativePath.split("/"));
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "runtime-only whisper executable");
    await chmod(executable, 0o700);
    await writeFile(
      path.join(hostRoot, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        host: { platform: process.platform, architecture: process.arch },
        engine: { id: "whisper.cpp", commit: "pinned-fixture" },
        model: { id: "whisper-small-multilingual-q5_1" },
        files: [
          manifestRecord(executableRelativePath, "runtime-only whisper executable"),
          {
            relativePath: "models/ggml-small-q5_1.bin",
            byteSize: 190085487,
            sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
          },
        ],
      }),
    );

    const service = new LocalSimulatorService(true, root, path.join(root, "unused"));
    await expect(service.resolveVoiceAsset("bin/whisper-cli")).resolves.toBe(executable);
    await expect(service.resolveVoiceAsset("models/ggml-small-q5_1.bin")).resolves.toBeUndefined();
  });
});

function manifestRecord(relativePath: string, content: string) {
  const bytes = Buffer.from(content);
  return {
    sourceId: "fixture",
    relativePath,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
