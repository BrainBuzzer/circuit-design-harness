import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureService } from "./capture-service";
import { ProjectIntegrityService } from "./project-integrity-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProjectIntegrityService", () => {
  it("detects a stored camera frame changed after its hash was recorded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-integrity-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Integrity fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const capture = await new CaptureService(projects).save({
      projectId,
      jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]),
      width: 100,
      height: 50,
      expectedCircuitRevision: 0,
      deviceLabel: "Integrity camera",
      source: "local_camera",
    });
    const integrity = new ProjectIntegrityService(projects);
    const healthy = await integrity.verify(projectId);
    expect(healthy.healthy).toBe(true);
    expect(healthy.issues).toEqual([]);

    const projectDirectory = await projects.getProjectDirectory(projectId);
    await writeFile(
      path.join(projectDirectory, capture.imageRelativePath),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 0xff, 0xd9]),
    );
    const damaged = await integrity.verify(projectId);
    expect(damaged.healthy).toBe(false);
    expect(damaged.issues).toContainEqual(
      expect.objectContaining({
        code: "content_hash_mismatch",
        path: capture.imageRelativePath,
      }),
    );
  });
});
