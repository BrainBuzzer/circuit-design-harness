import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CircuitService } from "./circuit-service";
import { ExportService } from "./export-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ExportService", () => {
  it("writes immutable revision-scoped SVG, BOM, circuit JSON, and hashes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "export-service-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Export fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const circuits = new CircuitService(projects, () => undefined);
    await circuits.applyTransaction({
      projectId,
      baseRevision: 0,
      source: "user",
      rationale: "Add export resistor.",
      operations: [
        {
          type: "add_component",
          componentId: "00000000-0000-4000-8000-000000000006",
          reference: "R1",
          kind: "resistor",
          value: "1 kΩ",
          position: { x: 100, y: 100 },
          rotation: 0,
        },
      ],
    });
    const exports = new ExportService(projects, circuits);
    const result = await exports.exportCircuit(projectId);
    expect(result.circuitRevision).toBe(1);
    expect(result.files.map((file) => file.name)).toEqual([
      "schematic.svg",
      "schematic-transparent.svg",
      "bom.csv",
      "bom.md",
      "design-report.md",
      "circuit.json",
    ]);
    expect(await exports.exportCircuit(projectId)).toEqual(result);
    const projectDirectory = await projects.getProjectDirectory(projectId);
    expect(
      await readFile(path.join(projectDirectory, result.directoryRelativePath, "bom.csv"), "utf8"),
    ).toContain("1,passive,resistor,Resistor,1 kΩ,R1");
    expect(
      await readFile(
        path.join(projectDirectory, result.directoryRelativePath, "design-report.md"),
        "utf8",
      ),
    ).toContain("It does not establish component ratings");
  });
});
