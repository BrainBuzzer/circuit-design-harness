import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  renderBomCsv,
  renderBomMarkdown,
  renderCircuitSvg,
  renderDesignReport,
} from "@domain/circuit-export";
import type { CircuitExportFile, CircuitExportResult } from "@shared/export-contract";
import { z } from "zod";
import type { CircuitService } from "./circuit-service";
import { writeFileAtomic, writeJsonAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

const ExportResultSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  circuitRevision: z.int().nonnegative(),
  directoryRelativePath: z.string().min(1),
  files: z.array(
    z.object({
      name: z.enum([
        "schematic.svg",
        "schematic-transparent.svg",
        "bom.csv",
        "bom.md",
        "design-report.md",
        "circuit.json",
      ]),
      byteSize: z.int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

export class ExportService {
  constructor(
    private readonly projects: ProjectService,
    private readonly circuits: CircuitService,
  ) {}

  async exportCircuit(projectId: string): Promise<CircuitExportResult> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const snapshot = await this.circuits.getSnapshot(projectId);
    const revisionName = `revision-${String(snapshot.document.revision).padStart(8, "0")}`;
    const directoryRelativePath = path.posix.join("exports", revisionName);
    const finalDirectory = path.join(projectDirectory, directoryRelativePath);
    const existing = await this.readExisting(finalDirectory);
    if (existing) {
      return existing;
    }

    const stagingDirectory = path.join(
      projectDirectory,
      "exports",
      `.${revisionName}.${randomUUID()}.exporting`,
    );
    const payloads: Readonly<Record<CircuitExportFile["name"], string>> = {
      "schematic.svg": renderCircuitSvg(snapshot.document),
      "schematic-transparent.svg": renderCircuitSvg(snapshot.document, { transparent: true }),
      "bom.csv": renderBomCsv(snapshot.document),
      "bom.md": renderBomMarkdown(snapshot.document),
      "design-report.md": renderDesignReport(snapshot.document, snapshot.diagnostics),
      "circuit.json": `${JSON.stringify(snapshot.document, null, 2)}\n`,
    };
    const files = Object.entries(payloads).map(([name, payload]) => ({
      name: name as CircuitExportFile["name"],
      byteSize: Buffer.byteLength(payload),
      sha256: createHash("sha256").update(payload).digest("hex"),
    }));
    const result = ExportResultSchema.parse({
      schemaVersion: 1,
      projectId,
      circuitRevision: snapshot.document.revision,
      directoryRelativePath,
      files,
    });

    try {
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      await Promise.all(
        Object.entries(payloads).map(([name, payload]) =>
          writeFileAtomic(path.join(stagingDirectory, name), payload),
        ),
      );
      await writeJsonAtomic(path.join(stagingDirectory, "manifest.json"), result);
      await rename(stagingDirectory, finalDirectory);
      return result;
    } catch (reason) {
      await rm(stagingDirectory, { recursive: true, force: true });
      const raced = await this.readExisting(finalDirectory);
      if (raced) {
        return raced;
      }
      throw reason;
    }
  }

  private async readExisting(directory: string): Promise<CircuitExportResult | undefined> {
    try {
      return ExportResultSchema.parse(
        JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")),
      );
    } catch {
      return undefined;
    }
  }
}
