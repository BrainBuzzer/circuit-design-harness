import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CaptureRecordSchema } from "@domain/capture";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureService } from "./capture-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CaptureService", () => {
  it("atomically stores a deliberate JPEG with project revision and provenance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-service-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Camera fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const captures = new CaptureService(projects);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 0xff, 0xd9]);

    const record = await captures.save({
      projectId,
      jpegBytes,
      width: 1920,
      height: 1080,
      expectedCircuitRevision: 0,
      deviceLabel: "Fixture camera",
      source: "local_camera",
    });
    expect(record).toMatchObject({
      projectId,
      source: "local_camera",
      deviceLabel: "Fixture camera",
      mimeType: "image/jpeg",
      width: 1920,
      height: 1080,
      circuitRevision: 0,
    });
    expect(await captures.list(projectId)).toEqual([record]);
    const promptEvidence = await captures.buildPromptImages(projectId, [record.id]);
    expect(promptEvidence.images).toHaveLength(1);
    expect(promptEvidence.evidenceText).toContain("circuit revision 0");
    expect(promptEvidence.evidenceText).toContain("Fixture camera");

    const projectDirectory = await projects.getProjectDirectory(projectId);
    const storedRecord = CaptureRecordSchema.parse(
      JSON.parse(
        await readFile(path.join(projectDirectory, "captures", record.id, "manifest.json"), "utf8"),
      ),
    );
    expect(storedRecord.sha256).toBe(record.sha256);
    expect(await readFile(path.join(projectDirectory, record.imageRelativePath))).toEqual(
      Buffer.from(jpegBytes),
    );
  });

  it("rejects bytes that are not JPEG content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-rejection-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Invalid camera fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }

    await expect(
      new CaptureService(projects).save({
        projectId,
        jpegBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
        width: 1,
        height: 1,
        expectedCircuitRevision: 1,
        deviceLabel: "Fixture camera",
        source: "local_camera",
      }),
    ).rejects.toThrow("changed from revision 1 to 0");

    await expect(
      new CaptureService(projects).save({
        projectId,
        jpegBytes: new Uint8Array([1, 2, 3]),
        width: 1,
        height: 1,
        expectedCircuitRevision: 0,
        deviceLabel: "Fixture camera",
        source: "local_camera",
      }),
    ).rejects.toThrow("JPEG");
  });
});
