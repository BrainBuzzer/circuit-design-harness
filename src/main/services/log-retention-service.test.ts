import { lstat, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { enforcePersistentLogBudget, MAX_PERSISTENT_LOG_BYTES } from "./log-retention-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persistent log retention", () => {
  it("defines the application-wide budget as exactly 100 MiB", () => {
    expect(MAX_PERSISTENT_LOG_BYTES).toBe(104_857_600);
  });

  it("deletes oldest regular files until the aggregate is within budget", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "circuit-log-budget-"));
    temporaryDirectories.push(directory);
    const nested = path.join(directory, "native");
    await mkdir(nested);
    const oldest = path.join(directory, "old.log");
    const middle = path.join(nested, "middle.log");
    const newest = path.join(directory, "new.log");
    await Promise.all([
      writeFile(oldest, Buffer.alloc(60)),
      writeFile(middle, Buffer.alloc(50)),
      writeFile(newest, Buffer.alloc(40)),
    ]);
    await utimes(oldest, new Date(1_000), new Date(1_000));
    await utimes(middle, new Date(2_000), new Date(2_000));
    await utimes(newest, new Date(3_000), new Date(3_000));

    await symlink(path.join(os.tmpdir(), "outside-log"), path.join(directory, "ignored-link"));

    const result = await enforcePersistentLogBudget([directory], 100);

    expect(result).toEqual({ bytesBefore: 150, bytesAfter: 90, deletedFileCount: 1 });
    await expect(lstatExists(oldest)).resolves.toBe(false);
    await expect(lstatExists(middle)).resolves.toBe(true);
    await expect(lstatExists(newest)).resolves.toBe(true);
  });

  it("does nothing when the log directory does not exist", async () => {
    const result = await enforcePersistentLogBudget(
      [path.join(os.tmpdir(), crypto.randomUUID(), "missing")],
      100,
    );
    expect(result).toEqual({ bytesBefore: 0, bytesAfter: 0, deletedFileCount: 0 });
  });
});

async function lstatExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw reason;
  }
}
