import { lstat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_LOG_BYTES = 100 * 1024 * 1024;
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const roots = [{ directory: repositoryRoot, includeAllFiles: false }];
if (process.platform === "darwin") {
  roots.push(
    {
      directory: path.join(os.homedir(), "Library", "Logs", "Circuit Design Harness"),
      includeAllFiles: true,
    },
    {
      directory: path.join(os.homedir(), "Library", "Logs", "circuit-design-harness"),
      includeAllFiles: true,
    },
  );
}

let totalLogBytes = 0;
let logFileCount = 0;
for (const root of roots) {
  const files = await collectFiles(root.directory);
  for (const file of files) {
    if (root.includeAllFiles || isPersistentLog(file)) {
      const metadata = await lstat(file);
      totalLogBytes += metadata.size;
      logFileCount += 1;
    }
  }
}

if (totalLogBytes > MAX_LOG_BYTES) {
  throw new Error(
    `Persistent Circuit Design Harness logs use ${totalLogBytes} bytes, exceeding the 100 MiB budget.`,
  );
}

console.log(
  `Persistent Circuit Design Harness logs: ${totalLogBytes} bytes across ${logFileCount} files (100 MiB maximum).`,
);

async function collectFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (reason) {
    if (reason.code === "ENOENT" || reason.code === "EACCES") return [];
    throw reason;
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "release") {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...(await collectFiles(candidate)));
    if (entry.isFile()) files.push(candidate);
  }
  return files;
}

function isPersistentLog(filePath) {
  const normalized = filePath.toLowerCase().split(path.sep);
  const filename = normalized.at(-1) ?? "";
  return (
    filename.endsWith(".log") ||
    filename === "log" ||
    filename === "log.old" ||
    normalized.includes("logs")
  );
}
