import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  AssemblyDocumentSchema,
  type AssemblyOperation,
  type AssemblyProposal,
  AssemblyProposalSchema,
  type AssemblyTransactionInput,
  AssemblyTransactionInputSchema,
  applyAssemblyOperations,
  LegacyAssemblyDocumentSchema,
  migrateAssemblyDocument,
  validateAssembly,
} from "@domain/assembly";
import type { CircuitDocument } from "@domain/circuit";
import type { AssemblyEvent, AssemblySnapshot } from "@shared/assembly-contract";
import type { CircuitService } from "./circuit-service";
import { writeJsonAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

export class StaleAssemblyRevisionError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Assembly revision ${expectedRevision} is stale; the current revision is ${actualRevision}.`,
    );
    this.name = "StaleAssemblyRevisionError";
  }
}

export class AssemblyService {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: ProjectService,
    private readonly circuits: CircuitService,
    private readonly emit: (event: AssemblyEvent) => void,
  ) {}

  async getSnapshot(projectId: string): Promise<AssemblySnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const [document, circuit] = await Promise.all([
        this.readAndMigrate(projectId),
        this.circuits.getSnapshot(projectId),
      ]);
      return { document, diagnostics: validateAssembly(document, circuit.document) };
    });
  }

  async applyTransaction(rawInput: AssemblyTransactionInput): Promise<AssemblySnapshot> {
    const input = AssemblyTransactionInputSchema.parse(rawInput);
    return this.withProjectWrite(input.projectId, async () => {
      const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
      const [current, circuit] = await Promise.all([
        this.readAndMigrate(input.projectId),
        this.circuits.getSnapshot(input.projectId),
      ]);
      if (current.revision !== input.baseRevision) {
        throw new StaleAssemblyRevisionError(input.baseRevision, current.revision);
      }
      if (circuit.document.revision !== input.expectedCircuitRevision) {
        throw new Error(
          `Circuit revision ${input.expectedCircuitRevision} is stale; review revision ${circuit.document.revision} before changing the build map.`,
        );
      }
      const result = applyAssemblyOperations(current, circuit.document, input.operations);
      const transactionId = randomUUID();
      const historyPath = path.join(
        projectDirectory,
        "history",
        `assembly-${String(result.document.revision).padStart(8, "0")}--${transactionId}.json`,
      );
      const record = {
        schemaVersion: 1,
        transactionId,
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        resultingRevision: result.document.revision,
        circuitRevision: circuit.document.revision,
        source: input.source,
        rationale: input.rationale,
        operations: input.operations,
        beforeDocument: current,
        afterDocument: result.document,
        diagnostics: result.diagnostics,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(historyPath, { ...record, status: "prepared" });
      await writeJsonAtomic(path.join(projectDirectory, "assembly.json"), result.document);
      await writeJsonAtomic(historyPath, { ...record, status: "committed" });
      const snapshot = { document: result.document, diagnostics: result.diagnostics };
      this.emit({ type: "updated", projectId: input.projectId, snapshot });
      return snapshot;
    });
  }

  async createProposal(
    projectId: string,
    rationale: string,
    operations: readonly AssemblyOperation[],
  ): Promise<AssemblyProposal> {
    return this.withProjectWrite(projectId, async () => {
      const [assemblyDocument, circuit] = await Promise.all([
        this.readAndMigrate(projectId),
        this.circuits.getSnapshot(projectId),
      ]);
      applyAssemblyOperations(assemblyDocument, circuit.document, operations);
      const proposal = AssemblyProposalSchema.parse({
        schemaVersion: 1,
        id: randomUUID(),
        projectId,
        baseRevision: assemblyDocument.revision,
        circuitRevision: circuit.document.revision,
        rationale,
        operations,
        semanticDiff: operations.map((operation) =>
          describeAssemblyOperation(operation, circuit.document),
        ),
        status: "pending",
        createdAt: new Date().toISOString(),
      });
      await writeJsonAtomic(await this.proposalPath(projectId, proposal.id), proposal);
      return proposal;
    });
  }

  async listPendingProposals(projectId: string): Promise<readonly AssemblyProposal[]> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const historyDirectory = path.join(projectDirectory, "history");
    const names = await readdir(historyDirectory);
    const proposals = await Promise.all(
      names
        .filter((name) => name.startsWith("assembly-proposal--") && name.endsWith(".json"))
        .map(async (name) =>
          AssemblyProposalSchema.parse(
            JSON.parse(await readFile(path.join(historyDirectory, name), "utf8")),
          ),
        ),
    );
    return proposals
      .filter((proposal) => proposal.projectId === projectId && proposal.status === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async approveProposal(projectId: string, proposalId: string): Promise<AssemblySnapshot> {
    const proposal = await this.readProposal(projectId, proposalId);
    if (proposal.status !== "pending")
      throw new Error("That breadboard proposal has already been resolved.");
    const snapshot = await this.applyTransaction({
      projectId,
      baseRevision: proposal.baseRevision,
      expectedCircuitRevision: proposal.circuitRevision,
      source: "agent",
      rationale: proposal.rationale,
      operations: proposal.operations,
    });
    await writeJsonAtomic(
      await this.proposalPath(projectId, proposalId),
      AssemblyProposalSchema.parse({
        ...proposal,
        status: "approved",
        resolvedAt: new Date().toISOString(),
      }),
    );
    return snapshot;
  }

  async rejectProposal(projectId: string, proposalId: string): Promise<void> {
    const proposal = await this.readProposal(projectId, proposalId);
    if (proposal.status !== "pending")
      throw new Error("That breadboard proposal has already been resolved.");
    await writeJsonAtomic(
      await this.proposalPath(projectId, proposalId),
      AssemblyProposalSchema.parse({
        ...proposal,
        status: "rejected",
        resolvedAt: new Date().toISOString(),
      }),
    );
  }

  private async readAndMigrate(projectId: string) {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const assemblyPath = path.join(projectDirectory, "assembly.json");
    const rawDocument: unknown = JSON.parse(await readFile(assemblyPath, "utf8"));
    const current = AssemblyDocumentSchema.safeParse(rawDocument);
    if (current.success) {
      return current.data;
    }
    const legacy = LegacyAssemblyDocumentSchema.safeParse(rawDocument);
    const migrated = migrateAssemblyDocument(rawDocument);
    if (legacy.success) {
      await writeJsonAtomic(
        path.join(
          projectDirectory,
          "history",
          `migration-assembly-v1--${new Date().toISOString().replaceAll(":", "-")}.json`,
        ),
        legacy.data,
      );
      await writeJsonAtomic(assemblyPath, migrated);
    }
    return migrated;
  }

  private async readProposal(projectId: string, proposalId: string): Promise<AssemblyProposal> {
    return AssemblyProposalSchema.parse(
      JSON.parse(await readFile(await this.proposalPath(projectId, proposalId), "utf8")),
    );
  }

  private async proposalPath(projectId: string, proposalId: string): Promise<string> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    return path.join(projectDirectory, "history", `assembly-proposal--${proposalId}.json`);
  }

  private async withProjectWrite<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writeQueues.get(projectId) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(action);
    const tail = operation.then(
      () => undefined,
      () => undefined,
    );
    this.writeQueues.set(projectId, tail);
    try {
      return await operation;
    } finally {
      if (this.writeQueues.get(projectId) === tail) {
        this.writeQueues.delete(projectId);
      }
    }
  }
}

function describeAssemblyOperation(operation: AssemblyOperation, circuit: CircuitDocument): string {
  switch (operation.type) {
    case "place_component_pin": {
      const reference =
        circuit.components.find((component) => component.id === operation.componentId)?.reference ??
        "component";
      return `Place ${reference} pin ${operation.pinId} in hole ${operation.hole}.`;
    }
    case "remove_component_placement": {
      const reference =
        circuit.components.find((component) => component.id === operation.componentId)?.reference ??
        "component";
      return `Remove ${reference} from the breadboard.`;
    }
    case "add_jumper":
      return `Add a ${operation.color} jumper from ${operation.from} to ${operation.to}.`;
    case "remove_jumper":
      return `Remove jumper ${operation.jumperId}.`;
  }
}
