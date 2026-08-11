import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sources = JSON.parse(
  await readFile(path.join(repositoryRoot, "simulator/sources.json"), "utf8"),
);
const hostId = `${process.platform}-${process.arch}`;
const outputRoot = path.join(repositoryRoot, "simulator/dist", hostId);
const binDirectory = path.join(outputRoot, "bin");
const licenseDirectory = path.join(outputRoot, "licenses");
const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "circuit-harness-simulator-sources-"));
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const DARWIN_DEPENDENCIES = {
  "libglib-2.0.0.dylib": { formula: "glib", license: "LGPL-2.1-or-later" },
  "libgcrypt.20.dylib": { formula: "libgcrypt", license: "LGPL-2.1-or-later" },
  "libgpg-error.0.dylib": { formula: "libgpg-error", license: "LGPL-2.1-or-later" },
  "libintl.8.dylib": { formula: "gettext", license: "LGPL-2.1-or-later" },
  "libpcre2-8.0.dylib": { formula: "pcre2", license: "BSD-3-Clause" },
};
const installedFiles = new Map();

try {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(binDirectory, { recursive: true });
  await mkdir(licenseDirectory, { recursive: true });

  const simulatorVerification = [];
  let qemuCheckout;
  for (const source of sources.sources) {
    const checkout = path.join(sourceRoot, source.id);
    await checkoutPinnedSource(source, checkout);
    for (const patch of source.patches ?? []) {
      await run("git", ["apply", "--whitespace=error", path.join(repositoryRoot, patch)], checkout);
    }
    if (source.id === "simavr") {
      await run("make", ["build-simavr", "RELEASE=1"], checkout);
      await installArtifact(
        path.join(checkout, "simavr/run_avr"),
        path.join(binDirectory, `simavr${executableSuffix}`),
        source.id,
      );
      const simavrLibrary = await findNamedFile(path.join(checkout, "simavr"), "libsimavr.a");
      if (!simavrLibrary) {
        throw new Error("The pinned simavr build did not produce libsimavr.a.");
      }
      const libelfCflags = (await capture("pkg-config", ["--cflags", "libelf"], checkout))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const libelfLinkFlags = (await capture("pkg-config", ["--libs", "libelf"], checkout))
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const traceRunner = path.join(checkout, `circuit-simavr-trace${executableSuffix}`);
      await run(
        process.env.CC || "cc",
        [
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          `-I${path.join(checkout, "simavr", "sim")}`,
          `-I${path.join(checkout, "simavr")}`,
          ...libelfCflags,
          path.join(repositoryRoot, "simulator", "simavr", "circuit_trace.c"),
          simavrLibrary,
          "-lm",
          ...libelfLinkFlags,
          "-o",
          traceRunner,
        ],
        checkout,
      );
      const highTrace = parseCircuitTrace(
        await capture(
          traceRunner,
          [path.join(repositoryRoot, "simulator/fixtures/uno-d13-high.hex"), "1000"],
          checkout,
        ),
      );
      if (
        highTrace.finalPins?.D13 !== 1 ||
        !Array.isArray(highTrace.pinEvents) ||
        highTrace.pinEvents.length < 2
      ) {
        throw new Error("The simavr trace runner did not observe the known D13 output fixture.");
      }
      const returnedInputTrace = parseCircuitTrace(
        await capture(
          traceRunner,
          [path.join(repositoryRoot, "simulator/fixtures/uno-d13-return-input.hex"), "1000"],
          checkout,
        ),
      );
      if (Object.hasOwn(returnedInputTrace.finalPins ?? {}, "D13")) {
        throw new Error("The simavr trace runner reported an input-mode pin as a final output.");
      }
      simulatorVerification.push(
        { id: "uno-d13-output-trace", status: "verified" },
        { id: "uno-input-mode-filter", status: "verified" },
      );
      await installArtifact(
        traceRunner,
        path.join(binDirectory, `circuit-simavr-trace${executableSuffix}`),
        source.id,
      );
      await installLicense(
        [path.join(checkout, "COPYING"), path.join(checkout, "LICENSE")],
        path.join(licenseDirectory, "simavr.txt"),
        source.id,
      );
    } else if (source.id === "espressif-qemu") {
      qemuCheckout = checkout;
      const buildDirectory = path.join(checkout, "build-circuit-harness");
      await mkdir(buildDirectory, { recursive: true });
      await run(
        path.join(checkout, "configure"),
        [
          "--target-list=xtensa-softmmu",
          "--without-default-features",
          "--enable-gcrypt",
          "--disable-docs",
          "--disable-user",
          "--disable-werror",
          "--disable-slirp",
        ],
        buildDirectory,
      );
      await run("ninja", ["-C", buildDirectory, "qemu-system-xtensa"], checkout);
      const qemuExecutable = path.join(buildDirectory, `qemu-system-xtensa${executableSuffix}`);
      const machineHelp = await capture(qemuExecutable, ["-machine", "help"], repositoryRoot);
      if (!/^esp32s3\s/m.test(machineHelp)) {
        throw new Error("The pinned Espressif QEMU build does not contain the ESP32-S3 machine.");
      }
      simulatorVerification.push({ id: "esp32s3-machine-presence", status: "verified" });
      await installArtifact(
        qemuExecutable,
        path.join(binDirectory, `qemu-system-xtensa${executableSuffix}`),
        source.id,
      );
      await installLicense(
        [path.join(checkout, "COPYING"), path.join(checkout, "LICENSE")],
        path.join(licenseDirectory, "espressif-qemu.txt"),
        source.id,
      );
    }
  }

  const runtimeDependencies =
    process.platform === "darwin" ? await bundleDarwinRuntimeDependencies(qemuCheckout) : [];
  const builtFiles = await Promise.all(
    [...installedFiles.entries()].map(([filePath, sourceId]) =>
      describeArtifact(filePath, sourceId),
    ),
  );

  const manifest = {
    schemaVersion: 1,
    host: { platform: process.platform, architecture: process.arch },
    sources: sources.sources,
    verification: simulatorVerification,
    runtimeDependencies,
    productTargets: sources.productTargets,
    files: builtFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
  await writeFile(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`Built and verified ${builtFiles.length} local simulator files in ${outputRoot}`);
} finally {
  await rm(sourceRoot, { recursive: true, force: true });
}

async function checkoutPinnedSource(source, checkout) {
  try {
    await stat(path.join(checkout, ".git"));
  } catch {
    await rm(checkout, { recursive: true, force: true });
    await run(
      "git",
      ["clone", "--filter=blob:none", "--no-checkout", source.repository, checkout],
      sourceRoot,
    );
  }
  await run("git", ["fetch", "--depth=1", "origin", source.commit], checkout);
  if (source.sparsePaths) {
    await run("git", ["sparse-checkout", "set", "--no-cone", ...source.sparsePaths], checkout);
  }
  await run("git", ["checkout", "--detach", source.commit], checkout);
  await run("git", ["restore", "--source=HEAD", "--staged", "--worktree", "."], checkout);
  const actualCommit = (await capture("git", ["rev-parse", "HEAD"], checkout)).trim();
  if (actualCommit !== source.commit) {
    throw new Error(`Pinned checkout mismatch for ${source.id}.`);
  }
}

async function installArtifact(from, to, sourceId) {
  await copyFile(from, to);
  installedFiles.set(to, sourceId);
}

async function describeArtifact(filePath, sourceId) {
  const content = await readFile(filePath);
  return {
    sourceId,
    relativePath: path.relative(outputRoot, filePath).split(path.sep).join("/"),
    byteSize: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function installLicense(candidates, destination, sourceId) {
  for (const candidate of candidates) {
    try {
      await copyFile(candidate, destination);
      installedFiles.set(destination, sourceId);
      return;
    } catch (reason) {
      if (reason.code !== "ENOENT") {
        throw reason;
      }
    }
  }
  throw new Error(`License file missing for ${destination}.`);
}

async function bundleDarwinRuntimeDependencies(qemuSource) {
  if (!qemuSource) {
    return [];
  }
  const libraryDirectory = path.join(outputRoot, "lib");
  const dependencyLicenseDirectory = path.join(licenseDirectory, "runtime");
  await mkdir(libraryDirectory, { recursive: true });
  await mkdir(dependencyLicenseDirectory, { recursive: true });
  const queue = [...installedFiles.keys()].filter((filePath) => filePath.startsWith(binDirectory));
  const processed = new Set();
  const metadata = new Map();
  while (queue.length > 0) {
    const consumer = queue.shift();
    if (!consumer || processed.has(consumer)) {
      continue;
    }
    processed.add(consumer);
    const dependencies = await darwinDependencies(consumer);
    for (const dependency of dependencies) {
      if (!dependency.startsWith("/") || isDarwinSystemDependency(dependency)) {
        continue;
      }
      const dependencyName = path.basename(dependency);
      const allowed = DARWIN_DEPENDENCIES[dependencyName];
      if (!allowed) {
        throw new Error(`Unapproved macOS simulator dependency: ${dependency}`);
      }
      const bundled = path.join(libraryDirectory, dependencyName);
      if (!installedFiles.has(bundled)) {
        await copyFile(dependency, bundled);
        installedFiles.set(bundled, `runtime:${allowed.formula}`);
        queue.push(bundled);
      }
      const replacement = consumer.startsWith(binDirectory)
        ? `@executable_path/../lib/${dependencyName}`
        : `@loader_path/${dependencyName}`;
      await run(
        "install_name_tool",
        ["-change", dependency, replacement, consumer],
        repositoryRoot,
      );
      metadata.set(allowed.formula, allowed);
    }
    if (consumer.startsWith(libraryDirectory)) {
      await run(
        "install_name_tool",
        ["-id", `@loader_path/${path.basename(consumer)}`, consumer],
        repositoryRoot,
      );
    }
  }
  for (const filePath of processed) {
    await run("codesign", ["--force", "--sign", "-", filePath], repositoryRoot);
  }
  const lgpl = path.join(qemuSource, "COPYING.LIB");
  for (const [formula, details] of metadata) {
    const formulaRoot = (await capture("brew", ["--prefix", formula], repositoryRoot)).trim();
    details.version = (await capture("brew", ["list", "--versions", formula], repositoryRoot))
      .trim()
      .split(/\s+/)
      .slice(1)
      .join(" ");
    const candidates =
      formula === "pcre2"
        ? [path.join(formulaRoot, "LICENCE.md"), path.join(formulaRoot, "COPYING")]
        : [path.join(formulaRoot, "COPYING.LIB"), lgpl, path.join(formulaRoot, "COPYING")];
    await installLicense(
      candidates,
      path.join(dependencyLicenseDirectory, `${formula}.txt`),
      `runtime:${formula}`,
    );
  }
  return [...metadata.entries()]
    .map(([id, details]) => ({
      id,
      version: details.version,
      license: details.license,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function darwinDependencies(filePath) {
  const output = await capture("otool", ["-L", filePath], repositoryRoot);
  return output
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" (")[0])
    .filter(Boolean);
}

function isDarwinSystemDependency(dependency) {
  return dependency.startsWith("/System/Library/") || dependency.startsWith("/usr/lib/");
}

async function findNamedFile(directory, expectedName) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === expectedName) {
      return candidate;
    }
    if (entry.isDirectory()) {
      const nested = await findNamedFile(candidate, expectedName);
      if (nested) return nested;
    }
  }
  return undefined;
}

function parseCircuitTrace(output) {
  const marker = output.lastIndexOf("CDH_TRACE_V1 ");
  if (marker < 0) throw new Error("The simavr trace runner did not emit CDH_TRACE_V1.");
  const line = output.slice(marker + "CDH_TRACE_V1 ".length).split(/\r?\n/, 1)[0];
  if (!line) throw new Error("The simavr trace record was empty.");
  return JSON.parse(line);
}

async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed with ${signal ?? `exit code ${code}`}.`));
      }
    });
  });
}

async function capture(command, args, cwd) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { cwd, shell: false });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`${command} failed: ${stderr.slice(0, 2000)}`));
      }
    });
  });
}
