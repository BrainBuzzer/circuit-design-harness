import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type CaptureRecord, CaptureRecordSchema } from "@domain/capture";
import type { SaveCameraCaptureInput } from "@shared/capture-contract";
import { writeFileAtomic, writeJsonAtomic } from "./json-file";
import { resolveExistingProjectPath } from "./project-path";
import type { ProjectService } from "./project-service";

const MAX_CAPTURE_BYTES = 12 * 1024 * 1024;

export class CaptureService {
  constructor(private readonly projects: ProjectService) {}

  async save(input: SaveCameraCaptureInput): Promise<CaptureRecord> {
    const bytes = Buffer.from(input.jpegBytes);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CAPTURE_BYTES) {
      throw new Error("Camera snapshots must be between 1 byte and 12 MB.");
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new Error("Camera snapshots must contain JPEG image data.");
    }

    const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
    const project = (await this.projects.getState()).projects.find(
      (candidate) => candidate.id === input.projectId,
    );
    if (!project) {
      throw new Error("The capture project is no longer available.");
    }
    if (project.circuitRevision !== input.expectedCircuitRevision) {
      throw new Error(
        `The circuit changed from revision ${input.expectedCircuitRevision} to ${project.circuitRevision}; retake the snapshot before saving.`,
      );
    }

    const id = randomUUID();
    const capturesRoot = path.join(projectDirectory, "captures");
    const finalDirectory = path.join(capturesRoot, id);
    const stagingDirectory = path.join(capturesRoot, `.${id}.${randomUUID()}.capturing`);
    const imageRelativePath = path.posix.join("captures", id, "capture.jpg");
    const record = CaptureRecordSchema.parse({
      schemaVersion: 1,
      id,
      projectId: input.projectId,
      source: input.source,
      deviceLabel: input.deviceLabel,
      mimeType: "image/jpeg",
      imageRelativePath,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      width: input.width,
      height: input.height,
      circuitRevision: project.circuitRevision,
      createdAt: new Date().toISOString(),
    });

    try {
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      await writeFileAtomic(path.join(stagingDirectory, "capture.jpg"), bytes);
      await writeJsonAtomic(path.join(stagingDirectory, "manifest.json"), record);
      await rename(stagingDirectory, finalDirectory);
      return record;
    } catch (reason) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw reason;
    }
  }

  async list(projectId: string): Promise<readonly CaptureRecord[]> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const capturesRoot = path.join(projectDirectory, "captures");
    const entries = await readdir(capturesRoot, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) =>
          CaptureRecordSchema.parse(
            JSON.parse(
              await readFile(path.join(capturesRoot, entry.name, "manifest.json"), "utf8"),
            ),
          ),
        ),
    );
    return records
      .filter((record) => record.projectId === projectId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async buildPromptImages(
    projectId: string,
    captureIds: readonly string[],
  ): Promise<{
    readonly images: readonly { readonly data: string; readonly mimeType: "image/jpeg" }[];
    readonly evidenceText: string;
  }> {
    const selected = new Set(captureIds);
    const records = (await this.list(projectId)).filter((record) => selected.has(record.id));
    if (records.length !== selected.size) {
      throw new Error("One or more selected captures do not belong to the active project.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const images = await Promise.all(
      records.map(async (record) => ({
        data: (
          await readFile(
            await resolveExistingProjectPath(projectDirectory, record.imageRelativePath),
          )
        ).toString("base64"),
        mimeType: record.mimeType,
      })),
    );
    return {
      images,
      evidenceText: records
        .map(
          (record, index) =>
            `[Camera snapshot ${index + 1}: ${record.width}x${record.height}, device ${record.deviceLabel}, captured ${record.createdAt}, circuit revision ${record.circuitRevision}]`,
        )
        .join("\n"),
    };
  }
}
