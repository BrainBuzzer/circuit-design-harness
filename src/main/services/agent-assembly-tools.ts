import { randomUUID } from "node:crypto";
import {
  type AssemblyOperation,
  AssemblyOperationSchema,
  type AssemblyProposal,
  BreadboardHoleSchema,
} from "@domain/assembly";
import type { CircuitDocument } from "@domain/circuit";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import type { AssemblyService } from "./assembly-service";
import type { CircuitService } from "./circuit-service";

const AgentAssemblyOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place_component_pin"),
    componentReference: z.string().trim().min(1).max(16),
    pinId: z.string().trim().min(1).max(40),
    hole: BreadboardHoleSchema,
  }),
  z.object({
    type: z.literal("remove_component_placement"),
    componentReference: z.string().trim().min(1).max(16),
  }),
  z.object({
    type: z.literal("add_jumper"),
    from: BreadboardHoleSchema,
    to: BreadboardHoleSchema,
    color: z.enum(["black", "red", "orange", "yellow", "green", "blue", "violet", "white"]),
  }),
  z.object({ type: z.literal("remove_jumper"), jumperId: z.uuid() }),
]);
type AgentAssemblyOperation = z.infer<typeof AgentAssemblyOperationSchema>;

export function createAgentAssemblyTools(
  projectId: string,
  assemblies: AssemblyService,
  circuits: CircuitService,
  onProposal: (proposal: AssemblyProposal) => Promise<void>,
): ToolDefinition[] {
  return [
    defineTool({
      name: "propose_breadboard_changes",
      label: "Propose breadboard changes",
      description:
        "Validates bounded component-pin placements and jumper changes against the canonical circuit, then presents them for explicit user approval. It never applies changes itself.",
      promptSnippet: "Prepare validated breadboard placement and jumper edits for user approval.",
      promptGuidelines: [
        "Call get_breadboard_assembly and get_circuit_design first; use exact component references, pin IDs, holes, and jumper IDs.",
        "Never claim a proposed physical placement was applied until the user approves it.",
        "A build map is not evidence that a photographed or energized circuit matches it.",
      ],
      parameters: Type.Object({
        rationale: Type.String({ minLength: 1, maxLength: 1000 }),
        operationsJson: Type.String({
          minLength: 2,
          maxLength: 100000,
          description:
            "JSON array of place_component_pin, remove_component_placement, add_jumper, or remove_jumper operations using componentReference instead of componentId.",
        }),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId, rawInput) => {
        const input = z
          .object({
            rationale: z.string().trim().min(1).max(1_000),
            operationsJson: z.string().min(2).max(100_000),
          })
          .parse(rawInput);
        const rawOperations = z
          .array(AgentAssemblyOperationSchema)
          .min(1)
          .max(100)
          .parse(JSON.parse(input.operationsJson));
        const circuit = await circuits.getSnapshot(projectId);
        const operations = compileAgentAssemblyOperations(circuit.document, rawOperations);
        const proposal = await assemblies.createProposal(projectId, input.rationale, operations);
        await onProposal(proposal);
        return {
          content: [
            {
              type: "text",
              text: `Breadboard proposal ${proposal.id} is validated and awaiting explicit user approval. It has not been applied.`,
            },
          ],
          details: { proposalId: proposal.id, baseRevision: proposal.baseRevision },
        };
      },
    }),
  ];
}

export function compileAgentAssemblyOperations(
  circuit: CircuitDocument,
  rawOperations: readonly AgentAssemblyOperation[],
): AssemblyOperation[] {
  const componentIds = new Map(
    circuit.components.map((component) => [component.reference, component.id]),
  );
  return rawOperations.map((operation) => {
    if (operation.type === "place_component_pin") {
      return AssemblyOperationSchema.parse({
        type: operation.type,
        componentId: resolveComponent(componentIds, operation.componentReference),
        pinId: operation.pinId,
        hole: operation.hole,
      });
    }
    if (operation.type === "remove_component_placement") {
      return {
        type: operation.type,
        componentId: resolveComponent(componentIds, operation.componentReference),
      };
    }
    if (operation.type === "add_jumper") {
      return { ...operation, jumperId: randomUUID() };
    }
    return operation;
  });
}

function resolveComponent(componentIds: ReadonlyMap<string, string>, reference: string): string {
  const componentId = componentIds.get(reference);
  if (!componentId) throw new Error(`Component reference ${reference} does not exist.`);
  return componentId;
}
