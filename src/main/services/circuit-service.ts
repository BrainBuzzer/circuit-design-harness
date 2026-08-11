import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyCircuitOperations,
  CircuitDocumentSchema,
  type CircuitOperation,
  type CircuitProposal,
  CircuitProposalSchema,
  type CircuitTransactionInput,
  CircuitTransactionInputSchema,
  LegacyCircuitDocumentSchema,
  migrateCircuitDocument,
  validateCircuit,
} from "@domain/circuit";
import {
  type CircuitModelScenario,
  type CircuitModelScenarioResult,
  runCircuitModelScenario,
} from "@domain/circuit-simulation";
import type { CircuitEvent, CircuitSnapshot } from "@shared/circuit-contract";
import { z } from "zod";
import { writeJsonAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

export class StaleCircuitRevisionError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Circuit revision ${expectedRevision} is stale; the current revision is ${actualRevision}.`,
    );
    this.name = "StaleCircuitRevisionError";
  }
}

const UndoableTransactionRecordSchema = z.object({
  status: z.literal("committed"),
  transactionId: z.uuid(),
  resultingRevision: z.int().nonnegative(),
  beforeDocument: CircuitDocumentSchema,
});

export class CircuitService {
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: ProjectService,
    private readonly emit: (event: CircuitEvent) => void,
  ) {}

  async getSnapshot(projectId: string): Promise<CircuitSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const document = await this.readAndMigrate(projectId);
      return { document, diagnostics: validateCircuit(document) };
    });
  }

  async runModelScenario(
    projectId: string,
    scenario: CircuitModelScenario,
  ): Promise<CircuitModelScenarioResult> {
    const snapshot = await this.getSnapshot(projectId);
    return runCircuitModelScenario(snapshot.document, scenario);
  }

  async applyTransaction(rawInput: CircuitTransactionInput): Promise<CircuitSnapshot> {
    const input = CircuitTransactionInputSchema.parse(rawInput);

    return this.withProjectWrite(input.projectId, async () => {
      const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
      const current = await this.readAndMigrate(input.projectId);

      if (current.revision !== input.baseRevision) {
        throw new StaleCircuitRevisionError(input.baseRevision, current.revision);
      }

      const result = applyCircuitOperations(current, input.operations);
      const transactionId = randomUUID();
      const historyPath = path.join(
        projectDirectory,
        "history",
        `${String(result.document.revision).padStart(8, "0")}--${transactionId}.json`,
      );
      const record = {
        schemaVersion: 1,
        transactionId,
        projectId: input.projectId,
        baseRevision: input.baseRevision,
        resultingRevision: result.document.revision,
        source: input.source,
        rationale: input.rationale,
        operations: input.operations,
        beforeDocument: current,
        afterDocument: result.document,
        diagnostics: result.diagnostics,
        createdAt: new Date().toISOString(),
      };

      await writeJsonAtomic(historyPath, { ...record, status: "prepared" });
      await writeJsonAtomic(path.join(projectDirectory, "circuit.json"), result.document);
      await this.projects.updateCircuitRevision(input.projectId, result.document.revision);
      await writeJsonAtomic(historyPath, { ...record, status: "committed" });

      const snapshot: CircuitSnapshot = {
        document: result.document,
        diagnostics: result.diagnostics,
      };
      this.emit({ type: "updated", projectId: input.projectId, snapshot });
      return snapshot;
    });
  }

  async undoLastTransaction(projectId: string): Promise<CircuitSnapshot> {
    return this.withProjectWrite(projectId, async () => {
      const projectDirectory = await this.projects.getProjectDirectory(projectId);
      const current = await this.readAndMigrate(projectId);
      const historyDirectory = path.join(projectDirectory, "history");
      const historyNames = (await readdir(historyDirectory))
        .filter((name) => /^\d{8}--.+\.json$/.test(name))
        .sort()
        .reverse();
      let previous: z.infer<typeof UndoableTransactionRecordSchema> | undefined;

      for (const name of historyNames) {
        const parsed = UndoableTransactionRecordSchema.safeParse(
          JSON.parse(await readFile(path.join(historyDirectory, name), "utf8")),
        );
        if (parsed.success && parsed.data.resultingRevision === current.revision) {
          previous = parsed.data;
          break;
        }
      }

      if (!previous) {
        throw new Error("The latest circuit revision does not have a restorable checkpoint.");
      }

      const restored = CircuitDocumentSchema.parse({
        ...previous.beforeDocument,
        revision: current.revision + 1,
      });
      const diagnostics = validateCircuit(restored);
      if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new Error("The previous circuit checkpoint no longer passes validation.");
      }

      const transactionId = randomUUID();
      const historyPath = path.join(
        historyDirectory,
        `${String(restored.revision).padStart(8, "0")}--${transactionId}.json`,
      );
      const record = {
        schemaVersion: 1,
        transactionId,
        projectId,
        baseRevision: current.revision,
        resultingRevision: restored.revision,
        source: "user",
        rationale: `Undo transaction ${previous.transactionId}.`,
        operations: [{ type: "restore_checkpoint", transactionId: previous.transactionId }],
        beforeDocument: current,
        afterDocument: restored,
        diagnostics,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(historyPath, { ...record, status: "prepared" });
      await writeJsonAtomic(path.join(projectDirectory, "circuit.json"), restored);
      await this.projects.updateCircuitRevision(projectId, restored.revision);
      await writeJsonAtomic(historyPath, { ...record, status: "committed" });

      const snapshot = { document: restored, diagnostics };
      this.emit({ type: "updated", projectId, snapshot });
      return snapshot;
    });
  }

  async createProposal(
    projectId: string,
    rationale: string,
    operations: readonly CircuitOperation[],
  ): Promise<CircuitProposal> {
    const snapshot = await this.getSnapshot(projectId);
    // Validate the complete candidate before presenting it to the user. This does not persist it.
    applyCircuitOperations(snapshot.document, operations);
    const proposal = CircuitProposalSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectId,
      baseRevision: snapshot.document.revision,
      rationale,
      operations,
      semanticDiff: buildSemanticDiff(snapshot.document, operations),
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    await writeJsonAtomic(await this.proposalPath(projectId, proposal.id), proposal);
    return proposal;
  }

  async listPendingProposals(projectId: string): Promise<readonly CircuitProposal[]> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const historyDirectory = path.join(projectDirectory, "history");
    const names = await readdir(historyDirectory);
    const proposals = await Promise.all(
      names
        .filter((name) => name.startsWith("proposal--") && name.endsWith(".json"))
        .map(async (name) =>
          CircuitProposalSchema.parse(
            JSON.parse(await readFile(path.join(historyDirectory, name), "utf8")),
          ),
        ),
    );
    return proposals
      .filter((proposal) => proposal.projectId === projectId && proposal.status === "pending")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async approveProposal(projectId: string, proposalId: string): Promise<CircuitSnapshot> {
    const proposal = await this.readProposal(projectId, proposalId);
    if (proposal.status !== "pending") {
      throw new Error("That circuit proposal has already been resolved.");
    }

    const snapshot = await this.applyTransaction({
      projectId,
      baseRevision: proposal.baseRevision,
      source: "agent",
      rationale: proposal.rationale,
      operations: proposal.operations,
    });
    await writeJsonAtomic(
      await this.proposalPath(projectId, proposalId),
      CircuitProposalSchema.parse({
        ...proposal,
        status: "approved",
        resolvedAt: new Date().toISOString(),
      }),
    );
    return snapshot;
  }

  async rejectProposal(projectId: string, proposalId: string): Promise<void> {
    const proposal = await this.readProposal(projectId, proposalId);
    if (proposal.status !== "pending") {
      throw new Error("That circuit proposal has already been resolved.");
    }

    await writeJsonAtomic(
      await this.proposalPath(projectId, proposalId),
      CircuitProposalSchema.parse({
        ...proposal,
        status: "rejected",
        resolvedAt: new Date().toISOString(),
      }),
    );
  }

  private async readAndMigrate(projectId: string) {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const circuitPath = path.join(projectDirectory, "circuit.json");
    const rawDocument: unknown = JSON.parse(await readFile(circuitPath, "utf8"));
    const current = CircuitDocumentSchema.safeParse(rawDocument);

    if (current.success) {
      return current.data;
    }

    const legacy = LegacyCircuitDocumentSchema.safeParse(rawDocument);
    const migrated = migrateCircuitDocument(rawDocument);

    if (legacy.success) {
      const backupPath = path.join(
        projectDirectory,
        "history",
        `migration-circuit-v${legacy.data.schemaVersion}--${new Date().toISOString().replaceAll(":", "-")}.json`,
      );
      await writeJsonAtomic(backupPath, legacy.data);
      await writeJsonAtomic(circuitPath, migrated);
    }

    return migrated;
  }

  private async readProposal(projectId: string, proposalId: string): Promise<CircuitProposal> {
    return CircuitProposalSchema.parse(
      JSON.parse(await readFile(await this.proposalPath(projectId, proposalId), "utf8")),
    );
  }

  private async proposalPath(projectId: string, proposalId: string): Promise<string> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    return path.join(projectDirectory, "history", `proposal--${proposalId}.json`);
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

function buildSemanticDiff(
  document: z.infer<typeof CircuitDocumentSchema>,
  operations: readonly CircuitOperation[],
): readonly string[] {
  const references = new Map(
    document.components.map((component) => [
      component.id,
      { reference: component.reference, kind: component.kind, value: component.value },
    ]),
  );
  for (const operation of operations) {
    if (operation.type === "add_component") {
      references.set(operation.componentId, {
        reference: operation.reference,
        kind: operation.kind,
        value: operation.value,
      });
    }
  }

  return operations.map((operation) => {
    switch (operation.type) {
      case "add_component":
        return `Add ${operation.reference}: ${operation.kind}${operation.value ? `, value ${operation.value}` : ""} at (${operation.position.x}, ${operation.position.y}).`;
      case "remove_component":
        return `Remove ${references.get(operation.componentId)?.reference ?? operation.componentId}.`;
      case "move_component": {
        const reference = references.get(operation.componentId)?.reference ?? operation.componentId;
        const before = document.schematic.placements.find(
          (placement) => placement.componentId === operation.componentId,
        );
        return `Move ${reference}${before ? ` from (${before.position.x}, ${before.position.y})` : ""} to (${operation.position.x}, ${operation.position.y})${operation.rotation === undefined ? "" : `, rotation ${operation.rotation}°`}.`;
      }
      case "set_component_value": {
        const component = references.get(operation.componentId);
        return `Change ${component?.reference ?? operation.componentId} value from ${component?.value ?? "unset"} to ${operation.value}.`;
      }
      case "connect_terminals":
        return `Connect ${operation.terminals.map((terminal) => `${references.get(terminal.componentId)?.reference ?? terminal.componentId}.${terminal.pinId}`).join(" ↔ ")}${operation.name ? ` as ${operation.name}` : ""}.`;
      case "disconnect_terminal":
        return `Disconnect ${references.get(operation.terminal.componentId)?.reference ?? operation.terminal.componentId}.${operation.terminal.pinId}.`;
      case "rename_net": {
        const before = document.nets.find((net) => net.id === operation.netId)?.name;
        return `Rename net ${before ?? operation.netId} to ${operation.name}.`;
      }
      case "set_schematic_metadata": {
        const fields = Object.entries(operation)
          .filter(([key]) => key !== "type")
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(", ");
        return `Update publication metadata: ${fields}.`;
      }
    }
    throw new Error("Unsupported circuit operation in semantic diff.");
  });
}
