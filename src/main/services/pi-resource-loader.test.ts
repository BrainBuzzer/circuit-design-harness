import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHarnessResourceLoader } from "./pi-resource-loader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createHarnessResourceLoader", () => {
  it("keeps project instructions but excludes global executable Pi resources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-pi-resources-"));
    temporaryDirectories.push(root);
    const projectDirectory = path.join(root, "project");
    const agentDirectory = path.join(root, "global-agent");
    await Promise.all([mkdir(projectDirectory), mkdir(agentDirectory)]);
    await Promise.all([
      writeFile(path.join(projectDirectory, "AGENTS.md"), "project circuit rules"),
      writeFile(path.join(agentDirectory, "AGENTS.md"), "global agent rules"),
    ]);

    const loader = createHarnessResourceLoader(projectDirectory, agentDirectory);

    expect(loader.getExtensions().extensions).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getPrompts().prompts).toEqual([]);
    expect(loader.getThemes().themes).toEqual([]);
    expect(loader.getSystemPrompt()).toBeUndefined();
    expect(loader.getAppendSystemPrompt()).toHaveLength(1);
    expect(loader.getAppendSystemPrompt()[0]).toContain("stage a typed proposal");
    expect(loader.getAppendSystemPrompt()[0]).toContain("ESP32 Pomodoro timer");
    expect(loader.getAppendSystemPrompt()[0]).toContain("do not gate it on choosing Arduino");
    expect(loader.getAppendSystemPrompt()[0]).toContain("Global Pi slash commands");
    expect(loader.getAgentsFiles().agentsFiles).toEqual([
      {
        path: path.join(projectDirectory, "AGENTS.md"),
        content: "project circuit rules",
      },
    ]);
  });
});
