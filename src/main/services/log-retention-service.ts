import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

export const MAX_PERSISTENT_LOG_BYTES = 100 * 1024 * 1024;

export interface LogRetentionResult {
  readonly bytesBefore: number;
  readonly bytesAfter: number;
  readonly deletedFileCount: number;
}

interface LogFile {
  readonly absolutePath: string;
  readonly byteSize: number;
  readonly modifiedAt: number;
}

export async function enforcePersistentLogBudget(
  directories: readonly string[],
  maximumBytes = MAX_PERSISTENT_LOG_BYTES,
): Promise<LogRetentionResult> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error("The persistent log budget must be a non-negative integer byte count.");
  }

  const filesByPath = new Map<string, LogFile>();
  for (const directory of directories) {
    for (const file of await collectRegularFiles(directory)) {
      filesByPath.set(file.absolutePath, file);
    }
  }
  const files = [...filesByPath.values()];
  const bytesBefore = files.reduce((total, file) => total + file.byteSize, 0);
  let bytesAfter = bytesBefore;
  let deletedFileCount = 0;

  const oldestFirst = [...files].sort(
    (left, right) =>
      left.modifiedAt - right.modifiedAt || left.absolutePath.localeCompare(right.absolutePath),
  );
  for (const file of oldestFirst) {
    if (bytesAfter <= maximumBytes) {
      break;
    }
    try {
      await rm(file.absolutePath, { force: true });
      bytesAfter -= file.byteSize;
      deletedFileCount += 1;
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== "ENOENT") {
        throw reason;
      }
    }
  }

  return { bytesBefore, bytesAfter, deletedFileCount };
}

async function collectRegularFiles(directory: string): Promise<readonly LogFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw reason;
  }

  const files: LogFile[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    let metadata: Stats;
    try {
      metadata = await lstat(absolutePath);
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw reason;
    }
    if (metadata.isSymbolicLink()) {
      continue;
    }
    if (metadata.isDirectory()) {
      files.push(...(await collectRegularFiles(absolutePath)));
      continue;
    }
    if (metadata.isFile()) {
      files.push({
        absolutePath,
        byteSize: metadata.size,
        modifiedAt: metadata.mtimeMs,
      });
    }
  }
  return files;
}
