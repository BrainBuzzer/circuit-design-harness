import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const source = JSON.parse(await readFile(path.join(repositoryRoot, "voice/sources.json"), "utf8"));
const hostId = `${process.platform}-${process.arch}`;
const outputRoot = path.join(repositoryRoot, "voice/dist", hostId);
const binDirectory = path.join(outputRoot, "bin");
const modelDirectory = path.join(outputRoot, "models");
const licenseDirectory = path.join(outputRoot, "licenses");
const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "circuit-harness-voice-sources-"));
const checkout = path.join(sourceRoot, "whisper.cpp");
const buildDirectory = path.join(checkout, "build-circuit-harness");
const executableSuffix = process.platform === "win32" ? ".exe" : "";

try {
  await rm(outputRoot, { recursive: true, force: true });
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(modelDirectory, { recursive: true }),
    mkdir(licenseDirectory, { recursive: true }),
  ]);

  await run(
    "git",
    ["clone", "--filter=blob:none", "--no-checkout", source.engine.repository, checkout],
    sourceRoot,
  );
  await run("git", ["fetch", "--depth=1", "origin", source.engine.commit], checkout);
  await run("git", ["checkout", "--detach", source.engine.commit], checkout);
  await run("git", ["restore", "--source=HEAD", "--staged", "--worktree", "."], checkout);

  await run(
    "cmake",
    [
      "-S",
      checkout,
      "-B",
      buildDirectory,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_SERVER=OFF",
      "-DWHISPER_BUILD_EXAMPLES=ON",
    ],
    checkout,
  );
  await run(
    "cmake",
    [
      "--build",
      buildDirectory,
      "--config",
      "Release",
      "--target",
      "whisper-cli",
      "-j",
      String(os.availableParallelism()),
    ],
    checkout,
  );

  const executable = path.join(buildDirectory, "bin", `whisper-cli${executableSuffix}`);
  const installedExecutable = path.join(binDirectory, `whisper-cli${executableSuffix}`);
  await copyFile(executable, installedExecutable);
  await copyFile(path.join(checkout, "LICENSE"), path.join(licenseDirectory, "whisper.cpp.txt"));

  const modelPath = path.join(modelDirectory, "ggml-small-q5_1.bin");
  await run(
    "curl",
    ["--fail", "--location", "--retry", "3", "--output", modelPath, source.model.url],
    repositoryRoot,
  );
  const modelBytes = await readFile(modelPath);
  if (modelBytes.byteLength !== source.model.byteSize) {
    throw new Error(
      `Whisper model size mismatch: expected ${source.model.byteSize}, received ${modelBytes.byteLength}.`,
    );
  }
  const modelHash = createHash("sha256").update(modelBytes).digest("hex");
  if (modelHash !== source.model.sha256) {
    throw new Error(
      `Whisper model hash mismatch: expected ${source.model.sha256}, received ${modelHash}.`,
    );
  }

  const files = await Promise.all(
    [installedExecutable, modelPath, path.join(licenseDirectory, "whisper.cpp.txt")].map(
      async (filePath) => {
        const bytes = await readFile(filePath);
        return {
          relativePath: path.relative(outputRoot, filePath).split(path.sep).join("/"),
          byteSize: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      },
    ),
  );
  await writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, host: { platform: process.platform, architecture: process.arch }, ...source, files }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`Built local voice runtime in ${outputRoot}`);
} finally {
  await rm(sourceRoot, { recursive: true, force: true });
}

async function run(executable, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${executable} failed with ${signal ? `signal ${signal}` : `code ${code}`}.`),
        );
    });
  });
}
