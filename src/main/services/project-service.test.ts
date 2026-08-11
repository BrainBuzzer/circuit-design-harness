import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "circuit-harness-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProjectService", () => {
  it("does not touch the normal Documents root when a fresh packaged smoke root is supplied", async () => {
    const root = await makeTemporaryDirectory();
    const settingsPath = path.join(root, "app-data", "settings.json");
    const stableRoot = path.join(root, "documents", "Circuit Design Harness");
    const temporaryRoot = path.join(root, "packaged-smoke-projects");
    const service = new ProjectService(settingsPath, stableRoot, temporaryRoot);

    expect((await service.initialize()).rootPath).toBe(temporaryRoot);
    await expect(access(stableRoot)).rejects.toThrow();
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      projectRoot: stableRoot,
    });
  });

  it("does not persist a temporary runtime project-root override", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-runtime-root-test-"));
    temporaryDirectories.push(root);
    const settingsPath = path.join(root, "app-data", "settings.json");
    const stableRoot = path.join(root, "stable-projects");
    const temporaryRoot = path.join(root, "packaged-smoke-projects");
    const stable = new ProjectService(settingsPath, stableRoot);
    await stable.initialize();

    const overridden = new ProjectService(settingsPath, stableRoot, temporaryRoot);
    expect((await overridden.initialize()).rootPath).toBe(temporaryRoot);
    const created = await overridden.createProject("Temporary smoke project");

    const resumedOverride = new ProjectService(settingsPath, stableRoot, temporaryRoot);
    expect((await resumedOverride.initialize()).activeProjectId).toBe(created.activeProjectId);

    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
      projectRoot: stableRoot,
      activeProjectId: created.activeProjectId,
    });

    const restored = new ProjectService(settingsPath, stableRoot);
    expect(await restored.initialize()).toMatchObject({ rootPath: stableRoot });
  });
  it("creates a portable project tree and restores it from settings", async () => {
    const root = await makeTemporaryDirectory();
    const settingsPath = path.join(root, "app-data", "settings.json");
    const projectRoot = path.join(root, "projects");
    const service = new ProjectService(settingsPath, projectRoot);

    await service.initialize();
    const created = await service.createProject("Bench LED");

    expect(created.projects).toHaveLength(1);
    expect(created.activeProjectId).toBe(created.projects[0]?.id);

    const projectDirectory = await service.getActiveProjectDirectory();
    expect(projectDirectory).toBeDefined();
    if (!projectDirectory) {
      throw new Error("Expected an active project directory.");
    }
    const manifest = JSON.parse(
      await readFile(path.join(projectDirectory, "project.json"), "utf8"),
    );
    expect(manifest.title).toBe("Bench LED");
    expect(
      JSON.parse(await readFile(path.join(projectDirectory, "circuit.json"), "utf8")),
    ).toMatchObject({
      schemaVersion: 3,
      revision: 0,
    });
    expect(await readFile(path.join(projectDirectory, "AGENTS.md"), "utf8")).toContain(
      "never claim hidden connectivity",
    );
    expect(
      loadProjectContextFiles({
        cwd: projectDirectory,
        agentDir: path.join(root, "pi-agent"),
      }).some(
        (context) =>
          context.path.endsWith("AGENTS.md") && context.content.includes("typed circuit changes"),
      ),
    ).toBe(true);

    const renamed = await service.renameProject(
      created.activeProjectId ?? "missing",
      "Bench LED v2",
    );
    expect(renamed.projects[0]?.title).toBe("Bench LED v2");
    expect(await service.getActiveProjectDirectory()).toBe(projectDirectory);

    const restored = new ProjectService(settingsPath, path.join(root, "ignored-default"));
    const restoredState = await restored.initialize();
    expect(restoredState.activeProjectId).toBe(created.activeProjectId);
    expect(restoredState.rootPath).toBe(projectRoot);
  });
});
