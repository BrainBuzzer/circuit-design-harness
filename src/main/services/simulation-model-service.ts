import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type InstalledSimulationModel,
  InstalledSimulationModelSchema,
  SimulationModelProposalSchema,
} from "@domain/simulation-model";
import {
  type DeclarativeSimulationEvent,
  type DeclarativeSimulationResult,
  evaluateSimulationModel,
} from "@domain/simulation-model-runtime";
import type { SimulationModelSnapshot } from "@shared/simulation-model-contract";
import type { AttachmentService } from "./attachment-service";
import { writeFileAtomic, writeJsonAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

export class SimulationModelService {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: ProjectService,
    private readonly attachments: AttachmentService,
  ) {}

  async list(projectId: string): Promise<SimulationModelSnapshot> {
    const root = await this.modelsRoot(projectId);
    const entries = await readdir(root, { withFileTypes: true });
    const models = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) =>
          InstalledSimulationModelSchema.parse(
            JSON.parse(await readFile(path.join(root, entry.name), "utf8")),
          ),
        ),
    );
    return {
      models: models.sort(
        (left, right) => left.name.localeCompare(right.name) || left.revision - right.revision,
      ),
    };
  }

  async install(projectId: string, rawProposal: unknown): Promise<SimulationModelSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const proposal = SimulationModelProposalSchema.parse(rawProposal);
      const attachments = await this.attachments.list(projectId);
      const attachmentById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
      const provenance = proposal.provenance.map((source) => {
        const attachment = attachmentById.get(source.attachmentId);
        if (!attachment) {
          throw new Error(
            `Model provenance attachment ${source.attachmentId} is not in this project.`,
          );
        }
        if (!attachment.pages.some((page) => page.pageNumber === source.pageNumber)) {
          throw new Error(
            `${attachment.originalName} does not contain cited page ${source.pageNumber}.`,
          );
        }
        return {
          ...source,
          attachmentName: attachment.originalName,
          attachmentSha256: attachment.sha256,
        };
      });
      const modelSha256 = createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
      const installed = InstalledSimulationModelSchema.parse({
        ...proposal,
        provenance,
        runtimeStatus: "declarative_runtime",
        installedAt: new Date().toISOString(),
        modelSha256,
      });
      const root = await this.modelsRoot(projectId);
      const destination = path.join(root, `${proposal.id}.json`);
      const existing = await readInstalled(destination);
      if (existing && existing.revision >= proposal.revision) {
        throw new Error(
          `Model ${proposal.id} revision must be greater than installed revision ${existing.revision}.`,
        );
      }
      if (existing) {
        const historyRoot = path.join(root, "history", proposal.id);
        await mkdir(historyRoot, { recursive: true, mode: 0o700 });
        await writeFileAtomic(
          path.join(historyRoot, `revision-${existing.revision}.json`),
          `${JSON.stringify(existing, null, 2)}\n`,
        );
      }
      await writeJsonAtomic(destination, installed);
      return this.list(projectId);
    });
  }

  async evaluate(
    projectId: string,
    modelId: string,
    event: DeclarativeSimulationEvent,
  ): Promise<DeclarativeSimulationResult> {
    const snapshot = await this.list(projectId);
    const model = snapshot.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error(`Simulation model ${modelId} is not installed in this project.`);
    return evaluateSimulationModel(model, event);
  }

  private async modelsRoot(projectId: string): Promise<string> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const root = path.join(projectDirectory, "simulation", "models");
    await mkdir(root, { recursive: true, mode: 0o700 });
    return root;
  }

  private async withProjectWrite<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(projectId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.writeQueues.set(projectId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.writeQueues.get(projectId) === tail) this.writeQueues.delete(projectId);
    }
  }
}

async function readInstalled(filePath: string): Promise<InstalledSimulationModel | undefined> {
  try {
    return InstalledSimulationModelSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw reason;
  }
}
