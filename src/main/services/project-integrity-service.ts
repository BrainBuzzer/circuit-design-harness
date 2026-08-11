import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AttachmentRecordSchema } from "@domain/attachment";
import { CaptureRecordSchema } from "@domain/capture";
import { CircuitDocumentSchema } from "@domain/circuit";
import { AssemblyDocumentSchema, ProjectManifestSchema } from "@domain/project";
import type { ProjectIntegrityIssue, ProjectIntegrityReport } from "@shared/integrity-contract";
import type { z } from "zod";
import { resolveExistingProjectPath } from "./project-path";
import type { ProjectService } from "./project-service";

export class ProjectIntegrityService {
  constructor(private readonly projects: ProjectService) {}

  async verify(projectId: string): Promise<ProjectIntegrityReport> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const issues: ProjectIntegrityIssue[] = [];
    let checkedFileCount = 0;
    const countChecked = (): void => {
      checkedFileCount += 1;
    };

    const project = await readSchemaFile(
      projectDirectory,
      "project.json",
      ProjectManifestSchema,
      issues,
      countChecked,
    );
    const circuit = await readSchemaFile(
      projectDirectory,
      "circuit.json",
      CircuitDocumentSchema,
      issues,
      countChecked,
    );
    await readSchemaFile(
      projectDirectory,
      "assembly.json",
      AssemblyDocumentSchema,
      issues,
      countChecked,
    );
    await checkRegularProjectFile(projectDirectory, "AGENTS.md", issues, countChecked);

    if (project && project.id !== projectId) {
      addError(
        issues,
        "project_identity",
        "project.json",
        "Project ID does not match its folder entry.",
      );
    }
    if (project && circuit && project.circuitRevision !== circuit.revision) {
      addError(
        issues,
        "revision_mismatch",
        "circuit.json",
        `Circuit revision ${circuit.revision} disagrees with project revision ${project.circuitRevision}.`,
      );
    }
    await verifyRecordDirectories({
      projectDirectory,
      projectId,
      rootRelativePath: "attachments/extracted",
      schema: AttachmentRecordSchema,
      recordName: "attachment",
      issues,
      countChecked,
      verifyPayload: async (record) => {
        await verifyHashedPayload(
          projectDirectory,
          record.originalRelativePath,
          record.byteSize,
          record.sha256,
          issues,
          countChecked,
        );
        for (const page of record.pages) {
          await checkRegularProjectFile(
            projectDirectory,
            page.textRelativePath,
            issues,
            countChecked,
          );
          if (page.imageRelativePath) {
            await checkRegularProjectFile(
              projectDirectory,
              page.imageRelativePath,
              issues,
              countChecked,
            );
          }
        }
      },
    });
    await verifyRecordDirectories({
      projectDirectory,
      projectId,
      rootRelativePath: "captures",
      schema: CaptureRecordSchema,
      recordName: "capture",
      issues,
      countChecked,
      verifyPayload: (record) =>
        verifyHashedPayload(
          projectDirectory,
          record.imageRelativePath,
          record.byteSize,
          record.sha256,
          issues,
          countChecked,
        ),
    });

    return {
      projectId,
      verifiedAt: new Date().toISOString(),
      healthy: !issues.some((issue) => issue.severity === "error"),
      checkedFileCount,
      issues: issues.sort((left, right) => left.path.localeCompare(right.path)),
    };
  }
}

async function verifyRecordDirectories<T extends { readonly projectId: string }>(input: {
  readonly projectDirectory: string;
  readonly projectId: string;
  readonly rootRelativePath: string;
  readonly schema: z.ZodType<T>;
  readonly recordName: string;
  readonly issues: ProjectIntegrityIssue[];
  readonly countChecked: () => void;
  readonly verifyPayload: (record: T) => Promise<void>;
}): Promise<void> {
  const root = path.join(input.projectDirectory, ...input.rootRelativePath.split("/"));
  let entries: readonly { readonly name: string; isDirectory(): boolean }[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (reason) {
    addError(input.issues, "missing_directory", input.rootRelativePath, toErrorMessage(reason));
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      input.issues.push({
        severity: "warning",
        code: "incomplete_staging_entry",
        path: `${input.rootRelativePath}/${entry.name}`,
        message: "An incomplete or interrupted staging entry remains.",
      });
      continue;
    }
    const manifestRelativePath = `${input.rootRelativePath}/${entry.name}/manifest.json`;
    if (!entry.isDirectory()) {
      addError(
        input.issues,
        "unexpected_entry",
        manifestRelativePath,
        "Expected a record directory.",
      );
      continue;
    }
    const record = await readSchemaFile(
      input.projectDirectory,
      manifestRelativePath,
      input.schema,
      input.issues,
      input.countChecked,
    );
    if (!record) {
      continue;
    }
    if (record.projectId !== input.projectId) {
      addError(
        input.issues,
        `${input.recordName}_identity`,
        manifestRelativePath,
        `The ${input.recordName} belongs to a different project ID.`,
      );
      continue;
    }
    await input.verifyPayload(record);
  }
}

async function readSchemaFile<T>(
  projectDirectory: string,
  relativePath: string,
  schema: z.ZodType<T>,
  issues: ProjectIntegrityIssue[],
  countChecked: () => void,
): Promise<T | undefined> {
  try {
    const absolutePath = await requireRegularProjectFile(projectDirectory, relativePath);
    const value = schema.parse(JSON.parse(await readFile(absolutePath, "utf8")));
    countChecked();
    return value;
  } catch (reason) {
    addError(issues, "invalid_or_missing_file", relativePath, toErrorMessage(reason));
    return undefined;
  }
}

async function checkRegularProjectFile(
  projectDirectory: string,
  relativePath: string,
  issues: ProjectIntegrityIssue[],
  countChecked: () => void,
): Promise<void> {
  try {
    await requireRegularProjectFile(projectDirectory, relativePath);
    countChecked();
  } catch (reason) {
    addError(issues, "invalid_or_missing_file", relativePath, toErrorMessage(reason));
  }
}

async function verifyHashedPayload(
  projectDirectory: string,
  relativePath: string,
  expectedSize: number,
  expectedHash: string,
  issues: ProjectIntegrityIssue[],
  countChecked: () => void,
): Promise<void> {
  try {
    const absolutePath = await requireRegularProjectFile(projectDirectory, relativePath);
    const metadata = await lstat(absolutePath);
    const actualHash = await hashFile(absolutePath);
    countChecked();
    if (metadata.size !== expectedSize || actualHash !== expectedHash) {
      addError(
        issues,
        "content_hash_mismatch",
        relativePath,
        "Stored size or SHA-256 no longer matches the immutable record.",
      );
    }
  } catch (reason) {
    addError(issues, "invalid_or_missing_file", relativePath, toErrorMessage(reason));
  }
}

async function requireRegularProjectFile(
  projectDirectory: string,
  relativePath: string,
): Promise<string> {
  const absolutePath = await resolveExistingProjectPath(projectDirectory, relativePath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("Expected a regular project file without symbolic links.");
  }
  return absolutePath;
}

async function hashFile(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

function addError(
  issues: ProjectIntegrityIssue[],
  code: string,
  issuePath: string,
  message: string,
): void {
  issues.push({ severity: "error", code, path: issuePath, message });
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unknown integrity error.";
}
