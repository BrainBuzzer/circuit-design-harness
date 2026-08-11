import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_APP_PREFERENCES } from "@domain/preferences";
import { afterEach, describe, expect, it } from "vitest";
import { PreferencesService } from "./preferences-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PreferencesService", () => {
  it("persists validated consent and voice settings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "circuit-preferences-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "preferences.json");
    const service = new PreferencesService(filePath);

    expect(await service.initialize()).toEqual(DEFAULT_APP_PREFERENCES);
    const updated = await service.update({
      ...DEFAULT_APP_PREFERENCES,
      wakeWordEnabled: true,
      spokenReplies: true,
      voiceTone: "focused",
    });

    expect(updated.wakeWordEnabled).toBe(true);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(updated);
  });
});
