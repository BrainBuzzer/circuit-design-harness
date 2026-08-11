import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssemblyService, StaleAssemblyRevisionError } from "./assembly-service";
import { CircuitService } from "./circuit-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];
const V1 = "00000000-0000-4000-8000-000000000001";
const R1 = "00000000-0000-4000-8000-000000000002";

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AssemblyService", () => {
  it("serializes stale-checked assembly transactions with an audit record", async () => {
    const fixture = await createFixture();
    const events: unknown[] = [];
    const circuits = new CircuitService(fixture.projects, () => undefined);
    const assemblies = new AssemblyService(fixture.projects, circuits, (event) =>
      events.push(event),
    );

    const snapshot = await assemblies.applyTransaction({
      projectId: fixture.projectId,
      baseRevision: 0,
      expectedCircuitRevision: 1,
      source: "user",
      rationale: "Place the VCC connection on one terminal strip.",
      operations: [
        { type: "place_component_pin", componentId: V1, pinId: "positive", hole: "a1" },
        { type: "place_component_pin", componentId: R1, pinId: "1", hole: "b1" },
      ],
    });
    expect(snapshot.document.revision).toBe(1);
    expect(snapshot.diagnostics).toEqual([]);
    expect(events).toHaveLength(1);
    const history = (await readdir(path.join(fixture.projectDirectory, "history"))).filter((name) =>
      name.startsWith("assembly-"),
    );
    expect(history).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(path.join(fixture.projectDirectory, "history", history[0] ?? ""), "utf8"),
      ),
    ).toMatchObject({ status: "committed", resultingRevision: 1, circuitRevision: 1 });

    await expect(
      assemblies.applyTransaction({
        projectId: fixture.projectId,
        baseRevision: 0,
        expectedCircuitRevision: 1,
        source: "user",
        rationale: "Stale edit.",
        operations: [{ type: "remove_component_placement", componentId: V1 }],
      }),
    ).rejects.toBeInstanceOf(StaleAssemblyRevisionError);
  });

  it("backs up and migrates a version-one assembly document", async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.projectDirectory, "assembly.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        circuitRevision: 1,
        placements: [],
        observations: [],
      })}\n`,
    );
    const snapshot = await new AssemblyService(
      fixture.projects,
      new CircuitService(fixture.projects, () => undefined),
      () => undefined,
    ).getSnapshot(fixture.projectId);
    expect(snapshot.document.schemaVersion).toBe(2);
    expect(
      (await readdir(path.join(fixture.projectDirectory, "history"))).some((name) =>
        name.startsWith("migration-assembly-v1--"),
      ),
    ).toBe(true);
  });

  it("stages breadboard proposals without mutation and applies only explicit approval", async () => {
    const fixture = await createFixture();
    const assemblies = new AssemblyService(
      fixture.projects,
      new CircuitService(fixture.projects, () => undefined),
      () => undefined,
    );

    const proposal = await assemblies.createProposal(
      fixture.projectId,
      "Place the positive supply pin in the first terminal strip.",
      [{ type: "place_component_pin", componentId: V1, pinId: "positive", hole: "a1" }],
    );
    expect((await assemblies.getSnapshot(fixture.projectId)).document.revision).toBe(0);
    expect(await assemblies.listPendingProposals(fixture.projectId)).toEqual([proposal]);

    const approved = await assemblies.approveProposal(fixture.projectId, proposal.id);
    expect(approved.document).toMatchObject({
      revision: 1,
      placements: [{ componentId: V1, pins: [{ pinId: "positive", hole: "a1" }] }],
    });
    expect(await assemblies.listPendingProposals(fixture.projectId)).toEqual([]);
    expect(
      JSON.parse(
        await readFile(
          path.join(fixture.projectDirectory, "history", `assembly-proposal--${proposal.id}.json`),
          "utf8",
        ),
      ),
    ).toMatchObject({ status: "approved" });

    const rejected = await assemblies.createProposal(
      fixture.projectId,
      "Remove the supply placement.",
      [{ type: "remove_component_placement", componentId: V1 }],
    );
    await assemblies.rejectProposal(fixture.projectId, rejected.id);
    expect((await assemblies.getSnapshot(fixture.projectId)).document.placements).toHaveLength(1);
    expect(await assemblies.listPendingProposals(fixture.projectId)).toEqual([]);
  });

  it("rejects an agent proposal after its base assembly revision becomes stale", async () => {
    const fixture = await createFixture();
    const circuits = new CircuitService(fixture.projects, () => undefined);
    const assemblies = new AssemblyService(fixture.projects, circuits, () => undefined);
    const proposal = await assemblies.createProposal(fixture.projectId, "Place V1.", [
      { type: "place_component_pin", componentId: V1, pinId: "positive", hole: "a1" },
    ]);
    await assemblies.applyTransaction({
      projectId: fixture.projectId,
      baseRevision: 0,
      expectedCircuitRevision: 1,
      source: "user",
      rationale: "Place R1 first.",
      operations: [{ type: "place_component_pin", componentId: R1, pinId: "1", hole: "b1" }],
    });

    await expect(assemblies.approveProposal(fixture.projectId, proposal.id)).rejects.toBeInstanceOf(
      StaleAssemblyRevisionError,
    );
    expect(await assemblies.listPendingProposals(fixture.projectId)).toHaveLength(1);
  });
});

async function createFixture(): Promise<{
  readonly projects: ProjectService;
  readonly projectId: string;
  readonly projectDirectory: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "assembly-service-test-"));
  temporaryDirectories.push(root);
  const projects = new ProjectService(
    path.join(root, "app-data", "settings.json"),
    path.join(root, "projects"),
  );
  await projects.initialize();
  const state = await projects.createProject("Assembly fixture");
  const projectId = state.activeProjectId;
  if (!projectId) {
    throw new Error("Expected a project ID.");
  }
  const projectDirectory = await projects.getProjectDirectory(projectId);
  const fixturePath = path.resolve(
    import.meta.dirname,
    "../../../tests/fixtures/circuits/led-current-limiter.json",
  );
  await writeFile(path.join(projectDirectory, "circuit.json"), await readFile(fixturePath));
  await projects.updateCircuitRevision(projectId, 1);
  return { projects, projectId, projectDirectory };
}
