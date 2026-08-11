import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { ArchiveService } from "./archive-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ArchiveService", () => {
  it("creates a deterministic portable archive with an embedded hash manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-service-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Portable LED");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const projectDirectory = await projects.getProjectDirectory(projectId);
    await writeFile(path.join(projectDirectory, "chat", "session.jsonl"), '{"role":"user"}\n');
    await writeFile(
      path.join(projectDirectory, "attachments", "originals", "requirements.txt"),
      "Supply: 5 V\n",
    );

    const service = new ArchiveService(projects);
    const first = await service.exportProject(projectId);
    const second = await service.exportProject(projectId);
    expect(second).toEqual(first);
    const archivePath = path.join(projectDirectory, first.archiveRelativePath);
    const archive = await readFile(archivePath);
    expect(createHash("sha256").update(archive).digest("hex")).toBe(first.sha256);
    const entries = parseTar(gunzipSync(archive));
    const rootName = path.basename(projectDirectory);
    expect(entries.has(`${rootName}/project.json`)).toBe(true);
    expect(entries.has(`${rootName}/chat/session.jsonl`)).toBe(true);
    expect(entries.has(`${rootName}/attachments/originals/requirements.txt`)).toBe(true);
    expect([...entries.keys()].some((name) => name.includes("project-archives"))).toBe(false);

    const embedded = entries.get(`${rootName}/archive-manifest.json`);
    if (!embedded) {
      throw new Error("Expected embedded archive manifest.");
    }
    const manifest = JSON.parse(embedded.toString("utf8")) as {
      projectId?: unknown;
      circuitRevision?: unknown;
      files?: Array<{ path?: unknown; sha256?: unknown }>;
    };
    expect(manifest.projectId).toBe(projectId);
    expect(manifest.circuitRevision).toBe(0);
    expect(manifest.files).toHaveLength(first.fileCount);
    const requirements = manifest.files?.find(
      (entry) => entry.path === "attachments/originals/requirements.txt",
    );
    expect(requirements?.sha256).toBe(createHash("sha256").update("Supply: 5 V\n").digest("hex"));
  });

  it("rejects symlinks instead of archiving data outside the project", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-symlink-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Symlink fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const projectDirectory = await projects.getProjectDirectory(projectId);
    const outsidePath = path.join(root, "outside-secret.txt");
    await writeFile(outsidePath, "not project data");
    await symlink(outsidePath, path.join(projectDirectory, "attachments", "originals", "escape"));

    await expect(new ArchiveService(projects).exportProject(projectId)).rejects.toThrow(
      "reject symbolic links",
    );
  });

  it("round-trips a project into a different configured root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-roundtrip-test-"));
    temporaryDirectories.push(root);
    const sourceProjects = new ProjectService(
      path.join(root, "source-app-data", "settings.json"),
      path.join(root, "source-projects"),
    );
    await sourceProjects.initialize();
    const sourceState = await sourceProjects.createProject("Portable source");
    const projectId = sourceState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a source project ID.");
    }
    const sourceDirectory = await sourceProjects.getProjectDirectory(projectId);
    await writeFile(path.join(sourceDirectory, "chat", "session.jsonl"), '{"role":"user"}\n');
    await writeFile(
      path.join(sourceDirectory, "attachments", "originals", "requirements.txt"),
      "Supply: 5 V\n",
    );
    const exported = await new ArchiveService(sourceProjects).exportProject(projectId);
    const archivePath = path.join(sourceDirectory, exported.archiveRelativePath);

    const importedProjects = new ProjectService(
      path.join(root, "import-app-data", "settings.json"),
      path.join(root, "imported-projects"),
    );
    await importedProjects.initialize();
    const importService = new ArchiveService(importedProjects);
    const importedState = await importService.importProject(archivePath);
    expect(importedState.activeProjectId).toBe(projectId);
    expect(importedState.projects).toHaveLength(1);
    expect(importedState.projects[0]?.title).toBe("Portable source");
    const importedDirectory = await importedProjects.getProjectDirectory(projectId);
    await expect(
      readFile(path.join(importedDirectory, "chat", "session.jsonl"), "utf8"),
    ).resolves.toBe('{"role":"user"}\n');
    await expect(
      readFile(
        path.join(importedDirectory, "attachments", "originals", "requirements.txt"),
        "utf8",
      ),
    ).resolves.toBe("Supply: 5 V\n");
    await expect(readFile(path.join(importedDirectory, "archive-manifest.json"))).rejects.toThrow();

    await expect(importService.importProject(archivePath)).rejects.toThrow(
      "project with this archive's ID already exists",
    );
    expect((await importedProjects.getState()).projects).toHaveLength(1);
  });

  it("rejects archive content that does not match the embedded hash manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archive-tamper-test-"));
    temporaryDirectories.push(root);
    const sourceProjects = new ProjectService(
      path.join(root, "source-app-data", "settings.json"),
      path.join(root, "source-projects"),
    );
    await sourceProjects.initialize();
    const sourceState = await sourceProjects.createProject("Tamper fixture");
    const projectId = sourceState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a source project ID.");
    }
    const sourceDirectory = await sourceProjects.getProjectDirectory(projectId);
    await writeFile(
      path.join(sourceDirectory, "attachments", "originals", "requirements.txt"),
      "Supply: 5 V\n",
    );
    const exported = await new ArchiveService(sourceProjects).exportProject(projectId);
    const archive = await readFile(path.join(sourceDirectory, exported.archiveRelativePath));
    const tar = gunzipSync(archive);
    const original = Buffer.from("Supply: 5 V\n");
    const replacement = Buffer.from("Supply: 9 V\n");
    const payloadOffset = tar.indexOf(original);
    expect(payloadOffset).toBeGreaterThanOrEqual(0);
    replacement.copy(tar, payloadOffset);
    const tamperedArchivePath = path.join(root, "tampered.tar.gz");
    await writeFile(tamperedArchivePath, gzipSync(tar, { level: 9 }));

    const importedProjects = new ProjectService(
      path.join(root, "import-app-data", "settings.json"),
      path.join(root, "imported-projects"),
    );
    await importedProjects.initialize();
    await expect(
      new ArchiveService(importedProjects).importProject(tamperedArchivePath),
    ).rejects.toThrow("Archive content hash mismatch");
    expect((await importedProjects.getState()).projects).toHaveLength(0);
  });
});

function parseTar(payload: Buffer): ReadonlyMap<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= payload.byteLength) {
    const header = payload.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readText(header, 0, 100);
    const prefix = readText(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(readText(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    if (type !== "5") {
      entries.set(fullName, Buffer.from(payload.subarray(offset, offset + size)));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readText(payload: Buffer, offset: number, length: number): string {
  const end = payload.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  return payload.subarray(offset, boundedEnd).toString("utf8");
}
