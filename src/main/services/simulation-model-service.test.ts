import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttachmentService } from "./attachment-service";
import { ProjectService } from "./project-service";
import { SimulationModelService } from "./simulation-model-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("SimulationModelService", () => {
  it("verifies project citations, fingerprints a model, and preserves replaced revisions", async () => {
    const fixture = await createFixture();
    const source = path.join(fixture.root, "datasheet.txt");
    await writeFile(source, "Pin IN accepts a digital input. Pin OUT is a digital output.");
    const [attachment] = await fixture.attachments.importFiles(fixture.projectId, [source]);
    if (!attachment) throw new Error("Expected imported attachment.");

    const first = await fixture.models.install(fixture.projectId, proposal(attachment.id, 1));
    expect(first.models).toHaveLength(1);
    expect(first.models[0]?.runtimeStatus).toBe("declarative_runtime");
    expect(first.models[0]?.provenance[0]?.attachmentSha256).toBe(attachment.sha256);
    expect(first.models[0]?.modelSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (
        await fixture.models.evaluate(fixture.projectId, "example-sensor", {
          kind: "digital_gpio",
          pins: { IN: 1 },
        })
      ).outputs?.OUT,
    ).toBe(0);

    await fixture.models.install(fixture.projectId, proposal(attachment.id, 2));
    const history = JSON.parse(
      await readFile(
        path.join(
          fixture.projectDirectory,
          "simulation/models/history/example-sensor/revision-1.json",
        ),
        "utf8",
      ),
    );
    expect(history.revision).toBe(1);
    await expect(
      fixture.models.install(fixture.projectId, proposal(attachment.id, 2)),
    ).rejects.toThrow("must be greater");
  });

  it("rejects citations to a missing attachment or page", async () => {
    const fixture = await createFixture();
    await expect(
      fixture.models.install(
        fixture.projectId,
        proposal("00000000-0000-4000-8000-000000000099", 1),
      ),
    ).rejects.toThrow("is not in this project");

    const source = path.join(fixture.root, "datasheet.txt");
    await writeFile(source, "One page.");
    const [attachment] = await fixture.attachments.importFiles(fixture.projectId, [source]);
    if (!attachment) throw new Error("Expected imported attachment.");
    const invalidPage = proposal(attachment.id, 1);
    const [citation] = invalidPage.provenance;
    if (!citation) throw new Error("Expected model citation.");
    citation.pageNumber = 2;
    await expect(fixture.models.install(fixture.projectId, invalidPage)).rejects.toThrow(
      "does not contain cited page 2",
    );
  });
});

function proposal(attachmentId: string, revision: number) {
  return {
    schemaVersion: 1,
    id: "example-sensor",
    revision,
    name: "Example sensor",
    partNumber: "EX-1",
    targets: ["arduino_uno_r3"],
    pins: [
      { id: "IN", name: "Input", role: "digital_input" },
      { id: "OUT", name: "Output", role: "digital_output" },
    ],
    electrical: { recommendedMinVoltage: 3, recommendedMaxVoltage: 5 },
    behavior: {
      kind: "digital_gpio",
      inputPins: ["IN"],
      outputPins: ["OUT"],
      truthTable: [
        { when: { IN: 0 }, outputs: { OUT: 1 } },
        { when: { IN: 1 }, outputs: { OUT: 0 } },
      ],
    },
    limitations: ["Timing is not modeled."],
    provenance: [
      {
        attachmentId,
        pageNumber: 1,
        claim: "Pin direction and recommended supply.",
        confidence: "high",
      },
    ],
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "simulation-model-test-"));
  temporaryDirectories.push(root);
  const projects = new ProjectService(
    path.join(root, "app-data/settings.json"),
    path.join(root, "projects"),
  );
  await projects.initialize();
  const state = await projects.createProject("Model fixture");
  const projectId = state.activeProjectId;
  if (!projectId) throw new Error("Expected project ID.");
  const attachments = new AttachmentService(projects);
  return {
    root,
    projectId,
    projectDirectory: await projects.getProjectDirectory(projectId),
    attachments,
    models: new SimulationModelService(projects, attachments),
  };
}
