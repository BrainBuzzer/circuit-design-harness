import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CircuitDocumentSchema } from "@domain/circuit";
import { ProjectManifestSchema } from "@domain/project";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CircuitService, StaleCircuitRevisionError } from "./circuit-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];
const TransactionRecordSchema = z.object({
  status: z.literal("committed"),
  baseRevision: z.int(),
  resultingRevision: z.int(),
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CircuitService", () => {
  it("restores the last checkpoint as a new audited revision after service restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-undo-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const state = await projects.createProject("Undo fixture");
    const projectId = state.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    await new CircuitService(projects, () => undefined).applyTransaction({
      projectId,
      baseRevision: 0,
      source: "user",
      rationale: "Add R1.",
      operations: [
        {
          type: "add_component",
          componentId: "00000000-0000-4000-8000-000000000005",
          reference: "R1",
          kind: "resistor",
          value: "1 kΩ",
          position: { x: 100, y: 100 },
          rotation: 0,
        },
      ],
    });

    const restored = await new CircuitService(projects, () => undefined).undoLastTransaction(
      projectId,
    );
    expect(restored.document.revision).toBe(2);
    expect(restored.document.components).toEqual([]);
    const projectDirectory = await projects.getProjectDirectory(projectId);
    expect(await readdir(path.join(projectDirectory, "history"))).toHaveLength(2);
  });

  it("durably stages an agent proposal and only applies it after approval", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-proposal-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const projectState = await projects.createProject("Proposal fixture");
    const projectId = projectState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }

    const circuits = new CircuitService(projects, () => undefined);
    const proposal = await circuits.createProposal(projectId, "Add a current limiter.", [
      {
        type: "add_component",
        componentId: "00000000-0000-4000-8000-000000000003",
        reference: "R1",
        kind: "resistor",
        value: "330 Ω",
        position: { x: 200, y: 100 },
        rotation: 0,
      },
    ]);

    expect((await circuits.getSnapshot(projectId)).document.revision).toBe(0);
    expect(proposal.semanticDiff).toEqual(["Add R1: resistor, value 330 Ω at (200, 100)."]);
    expect(await circuits.listPendingProposals(projectId)).toEqual([proposal]);
    expect((await circuits.approveProposal(projectId, proposal.id)).document.revision).toBe(1);
    expect(await circuits.listPendingProposals(projectId)).toEqual([]);
  });

  it("records rejection without modifying the circuit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-rejection-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const projectState = await projects.createProject("Rejection fixture");
    const projectId = projectState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }

    const circuits = new CircuitService(projects, () => undefined);
    const proposal = await circuits.createProposal(projectId, "Move a part.", [
      {
        type: "add_component",
        componentId: "00000000-0000-4000-8000-000000000004",
        reference: "R1",
        kind: "resistor",
        value: "1 kΩ",
        position: { x: 100, y: 100 },
        rotation: 0,
      },
    ]);
    await circuits.rejectProposal(projectId, proposal.id);

    expect((await circuits.getSnapshot(projectId)).document.revision).toBe(0);
    expect(await circuits.listPendingProposals(projectId)).toEqual([]);
  });

  it("serializes, validates, persists, and audits a revisioned transaction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-service-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const projectState = await projects.createProject("LED fixture");
    const projectId = projectState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }

    const events: string[] = [];
    const circuits = new CircuitService(projects, (event) => events.push(event.projectId));
    const snapshot = await circuits.applyTransaction({
      projectId,
      baseRevision: 0,
      source: "user",
      rationale: "Place the current limiting resistor.",
      operations: [
        {
          type: "add_component",
          componentId: "00000000-0000-4000-8000-000000000002",
          reference: "R1",
          kind: "resistor",
          value: "330 Ω",
          position: { x: 200, y: 100 },
          rotation: 0,
        },
      ],
    });

    expect(snapshot.document.revision).toBe(1);
    expect(events).toEqual([projectId]);

    const projectDirectory = await projects.getProjectDirectory(projectId);
    expect(
      CircuitDocumentSchema.parse(
        JSON.parse(await readFile(path.join(projectDirectory, "circuit.json"), "utf8")),
      ).revision,
    ).toBe(1);
    expect(
      ProjectManifestSchema.parse(
        JSON.parse(await readFile(path.join(projectDirectory, "project.json"), "utf8")),
      ).circuitRevision,
    ).toBe(1);

    const historyFiles = await readdir(path.join(projectDirectory, "history"));
    expect(historyFiles).toHaveLength(1);
    expect(
      TransactionRecordSchema.parse(
        JSON.parse(
          await readFile(
            path.join(projectDirectory, "history", historyFiles[0] ?? "missing"),
            "utf8",
          ),
        ),
      ),
    ).toMatchObject({ status: "committed", baseRevision: 0, resultingRevision: 1 });

    await expect(
      circuits.applyTransaction({
        projectId,
        baseRevision: 0,
        source: "user",
        rationale: "This write is stale.",
        operations: [
          {
            type: "move_component",
            componentId: "00000000-0000-4000-8000-000000000002",
            position: { x: 300, y: 100 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(StaleCircuitRevisionError);
  });

  it("backs up and migrates an empty version-one circuit document", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "circuit-migration-test-"));
    temporaryDirectories.push(root);
    const projects = new ProjectService(
      path.join(root, "app-data", "settings.json"),
      path.join(root, "projects"),
    );
    await projects.initialize();
    const projectState = await projects.createProject("Legacy fixture");
    const projectId = projectState.activeProjectId;
    if (!projectId) {
      throw new Error("Expected a project ID.");
    }
    const projectDirectory = await projects.getProjectDirectory(projectId);
    await writeFile(
      path.join(projectDirectory, "circuit.json"),
      `${JSON.stringify({ schemaVersion: 1, revision: 0, components: [], nets: [], constraints: [] })}\n`,
      "utf8",
    );

    const circuits = new CircuitService(projects, () => undefined);
    expect((await circuits.getSnapshot(projectId)).document.schemaVersion).toBe(3);
    expect(
      (await readdir(path.join(projectDirectory, "history"))).some((name) =>
        name.startsWith("migration-circuit-v1--"),
      ),
    ).toBe(true);
  });
});
