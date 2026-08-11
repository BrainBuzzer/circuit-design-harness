import { randomUUID } from "node:crypto";
import {
  type CircuitDocument,
  type CircuitOperation,
  CircuitOperationSchema,
  type CircuitProposal,
} from "@domain/circuit";
import { CircuitModelScenarioSchema } from "@domain/circuit-simulation";
import { COMPONENT_CATALOG, PART_KIND_IDS } from "@domain/component-catalog";
import { BUILTIN_IC_MODEL_IDS, BuiltinIcModelIdSchema } from "@domain/ic-models";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { z } from "zod";
import type { CircuitService } from "./circuit-service";

const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const AgentPointSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});
const AgentTerminalSchema = z.object({
  componentReference: z.string().trim().min(1).max(16),
  pinId: z.string().trim().min(1).max(40),
});
const AgentCircuitOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("add_component"),
      reference: z.string().regex(/^[A-Z][A-Z0-9_-]{0,15}$/),
      kind: z.enum(PART_KIND_IDS),
      value: z.string().trim().min(1).max(80).optional(),
      modelId: BuiltinIcModelIdSchema.optional(),
      position: AgentPointSchema,
      rotation: RotationSchema.optional(),
    })
    .superRefine((operation, context) => {
      if (operation.kind === "ic" && !operation.modelId) {
        context.addIssue({ code: "custom", path: ["modelId"], message: "ICs require modelId." });
      }
    }),
  z.object({
    type: z.literal("remove_component"),
    componentReference: z.string().trim().min(1).max(16),
  }),
  z.object({
    type: z.literal("move_component"),
    componentReference: z.string().trim().min(1).max(16),
    position: AgentPointSchema,
    rotation: RotationSchema.optional(),
  }),
  z.object({
    type: z.literal("set_component_value"),
    componentReference: z.string().trim().min(1).max(16),
    value: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("connect_terminals"),
    name: z.string().trim().min(1).max(80).optional(),
    terminals: z.array(AgentTerminalSchema).min(2).max(32),
  }),
  z.object({
    type: z.literal("disconnect_terminal"),
    terminal: AgentTerminalSchema,
  }),
  z.object({
    type: z.literal("rename_net"),
    netNameOrId: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    type: z.literal("set_schematic_metadata"),
    title: z.string().trim().min(1).max(160).optional(),
    subtitle: z.string().trim().max(240).optional(),
    author: z.string().trim().max(120).optional(),
    documentNumber: z.string().trim().max(80).optional(),
    paperSize: z.enum(["a4", "letter"]).optional(),
    orientation: z.enum(["landscape", "portrait"]).optional(),
  }),
]);

const AgentProposalInputSchema = z.object({
  rationale: z.string().trim().min(1).max(2_000),
  operations: z.array(AgentCircuitOperationSchema).min(1).max(100),
});

const PointParameters = Type.Object({
  x: Type.Number({ description: "Schematic x coordinate." }),
  y: Type.Number({ description: "Schematic y coordinate." }),
});
const RotationParameters = Type.Union([
  Type.Literal(0),
  Type.Literal(90),
  Type.Literal(180),
  Type.Literal(270),
]);
const TerminalParameters = Type.Object({
  componentReference: Type.String({ description: "Existing or newly-added reference, e.g. R1." }),
  pinId: Type.String({ description: "Exact pin ID returned by get_circuit_design." }),
});
const ProposalParameters = Type.Object({
  rationale: Type.String({ description: "Concise engineering reason for the proposed change." }),
  operations: Type.Array(
    Type.Union([
      Type.Object({
        type: Type.Literal("add_component"),
        reference: Type.String(),
        kind: Type.Union(
          PART_KIND_IDS.map((id) => Type.Literal(id)) as [
            ReturnType<typeof Type.Literal>,
            ReturnType<typeof Type.Literal>,
            ...ReturnType<typeof Type.Literal>[],
          ],
        ),
        value: Type.Optional(Type.String()),
        modelId: Type.Optional(
          Type.Union(
            BUILTIN_IC_MODEL_IDS.map((id) => Type.Literal(id)) as [
              ReturnType<typeof Type.Literal>,
              ReturnType<typeof Type.Literal>,
              ...ReturnType<typeof Type.Literal>[],
            ],
          ),
        ),
        position: PointParameters,
        rotation: Type.Optional(RotationParameters),
      }),
      Type.Object({
        type: Type.Literal("remove_component"),
        componentReference: Type.String(),
      }),
      Type.Object({
        type: Type.Literal("move_component"),
        componentReference: Type.String(),
        position: PointParameters,
        rotation: Type.Optional(RotationParameters),
      }),
      Type.Object({
        type: Type.Literal("set_component_value"),
        componentReference: Type.String(),
        value: Type.String(),
      }),
      Type.Object({
        type: Type.Literal("connect_terminals"),
        name: Type.Optional(Type.String()),
        terminals: Type.Array(TerminalParameters, { minItems: 2, maxItems: 32 }),
      }),
      Type.Object({
        type: Type.Literal("disconnect_terminal"),
        terminal: TerminalParameters,
      }),
      Type.Object({
        type: Type.Literal("rename_net"),
        netNameOrId: Type.String(),
        name: Type.String(),
      }),
      Type.Object({
        type: Type.Literal("set_schematic_metadata"),
        title: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        author: Type.Optional(Type.String()),
        documentNumber: Type.Optional(Type.String()),
        paperSize: Type.Optional(Type.Union([Type.Literal("a4"), Type.Literal("letter")])),
        orientation: Type.Optional(
          Type.Union([Type.Literal("landscape"), Type.Literal("portrait")]),
        ),
      }),
    ]),
    { minItems: 1, maxItems: 100 },
  ),
});

export function createAgentCircuitTools(
  projectId: string,
  circuits: CircuitService,
  onProposal: (proposal: CircuitProposal) => Promise<void>,
): ToolDefinition[] {
  const getComponentCatalog = defineTool({
    name: "get_circuit_component_catalog",
    label: "Read component catalog",
    description:
      "Returns every built-in structural schematic component kind, its stable ID, category, reference prefix, default value, exact pin IDs, conventional symbol family, and modeling limitations.",
    promptSnippet: "Inspect the component catalog before adding unfamiliar circuit parts.",
    promptGuidelines: [
      "Use only catalog kind IDs and exact pin IDs in circuit proposals.",
      "Catalog entries are structural symbols, not proof of ratings, packages, footprints, or electrical behavior.",
      "For kind ic, inspect the separate built-in IC catalog for its reviewed pin map and bounded functional adapter.",
    ],
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: JSON.stringify(COMPONENT_CATALOG) }],
      details: { componentKindCount: COMPONENT_CATALOG.length },
    }),
  });

  const getCircuit = defineTool({
    name: "get_circuit_design",
    label: "Read circuit design",
    description:
      "Returns the canonical typed circuit, its stable component references and pin IDs, current revision, constraints, schematic placements, and electrical-rule diagnostics.",
    promptSnippet: "Read the current canonical circuit design and ERC diagnostics.",
    promptGuidelines: [
      "Read the circuit before reasoning about or proposing changes.",
      "Treat stated voltage/current/power limits and component ratings as safety constraints; ask when a required rating is unknown.",
      "For camera evidence, distinguish visible facts, inference, and unknowns. Never claim hidden connectivity, polarity, continuity, or safety from an image alone.",
    ],
    parameters: Type.Object({}),
    execute: async () => {
      const snapshot = await circuits.getSnapshot(projectId);
      return {
        content: [{ type: "text", text: JSON.stringify(snapshot) }],
        details: { revision: snapshot.document.revision },
      };
    },
  });

  const proposeCircuit = defineTool({
    name: "propose_circuit_changes",
    label: "Propose circuit changes",
    description:
      "Validates a typed circuit transaction and presents it to the user for explicit approval. This tool never applies the change itself. Address components by reference and pins by the exact IDs returned by get_circuit_design.",
    promptSnippet: "Prepare validated circuit edits for explicit user approval.",
    promptGuidelines: [
      "Never claim a proposed circuit change has been applied; it remains pending until the user approves it in the workbench.",
      "Use component references from get_circuit_design. New component IDs and net IDs are generated by the harness.",
      `For kind ic, provide one built-in modelId: ${BUILTIN_IC_MODEL_IDS.join(", ")}.`,
    ],
    parameters: ProposalParameters,
    executionMode: "sequential",
    execute: async (_toolCallId, rawInput) => {
      const input = AgentProposalInputSchema.parse(rawInput);
      const snapshot = await circuits.getSnapshot(projectId);
      const operations = compileAgentOperations(snapshot.document, input.operations);
      const proposal = await circuits.createProposal(projectId, input.rationale, operations);
      await onProposal(proposal);
      return {
        content: [
          {
            type: "text",
            text: `Proposal ${proposal.id} was validated and is awaiting explicit user approval. It has not been applied.`,
          },
        ],
        details: { proposalId: proposal.id, baseRevision: proposal.baseRevision },
      };
    },
  });

  const proposePublicationLayout = defineTool({
    name: "propose_publication_layout",
    label: "Propose publication layout",
    description:
      "Stages a deterministic grid-aligned layout of every existing component for explicit user approval. It changes placement only and never applies the result itself.",
    promptSnippet: "Arrange the current schematic into a clean publication-oriented grid.",
    promptGuidelines: [
      "Read the design first. Choose column count and spacing appropriate to symbol count and paper orientation.",
      "This is a starting layout; inspect wire crossings and use propose_circuit_changes for precise follow-up moves.",
      "Never claim the layout has been applied until the user approves the proposal.",
    ],
    parameters: Type.Object({
      rationale: Type.String({ minLength: 1, maxLength: 2000 }),
      columns: Type.Integer({ minimum: 1, maximum: 8 }),
      horizontalSpacing: Type.Optional(Type.Number({ minimum: 100, maximum: 400 })),
      verticalSpacing: Type.Optional(Type.Number({ minimum: 100, maximum: 300 })),
    }),
    executionMode: "sequential",
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          rationale: z.string().trim().min(1).max(2_000),
          columns: z.int().min(1).max(8),
          horizontalSpacing: z.number().finite().min(100).max(400).default(180),
          verticalSpacing: z.number().finite().min(100).max(300).default(150),
        })
        .parse(rawInput);
      const snapshot = await circuits.getSnapshot(projectId);
      if (snapshot.document.components.length === 0) {
        throw new Error("The circuit has no components to arrange.");
      }
      const operations = createPublicationLayoutOperations(snapshot.document, input);
      const proposal = await circuits.createProposal(projectId, input.rationale, operations);
      await onProposal(proposal);
      return {
        content: [
          {
            type: "text",
            text: `Layout proposal ${proposal.id} was validated and is awaiting explicit user approval. It has not been applied.`,
          },
        ],
        details: {
          proposalId: proposal.id,
          baseRevision: proposal.baseRevision,
          componentCount: operations.length,
        },
      };
    },
  });

  const runModelScenario = defineTool({
    name: "run_circuit_model_scenario",
    label: "Run circuit functional scenario",
    description:
      "Runs explicit net stimuli, built-in IC functional adapters, rising-edge state transitions, and expected-net assertions against the active canonical circuit. It does not bridge firmware or solve electrical physics.",
    promptSnippet:
      "Evaluate a bounded, deterministic functional scenario against ICs connected in the current circuit.",
    promptGuidelines: [
      "Read the circuit first and use exact net names/IDs, component references, and pin IDs.",
      "Report conflicts, non-convergence, failed assertions, unmodeled components, and every returned limitation.",
      "Never describe a passing functional scenario as timing, electrical, thermal, firmware, physical, or safety validation.",
    ],
    parameters: Type.Object({
      scenarioJson: Type.String({
        minLength: 2,
        maxLength: 1024 * 1024,
        description:
          "JSON object with stimuli, risingEdges, initialState, and assertions matching the circuit scenario contract.",
      }),
    }),
    execute: async (_toolCallId, rawInput) => {
      const input = z
        .object({
          scenarioJson: z
            .string()
            .min(2)
            .max(1024 * 1024),
        })
        .parse(rawInput);
      const scenario = CircuitModelScenarioSchema.parse(JSON.parse(input.scenarioJson));
      const result = await circuits.runModelScenario(projectId, scenario);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {
          outcome: result.outcome,
          assertionCount: result.assertions.length,
          evaluatedComponentCount: result.evaluatedComponents.length,
        },
      };
    },
  });

  return [
    getComponentCatalog,
    getCircuit,
    proposeCircuit,
    proposePublicationLayout,
    runModelScenario,
  ];
}

export function createPublicationLayoutOperations(
  document: CircuitDocument,
  options: {
    readonly columns: number;
    readonly horizontalSpacing: number;
    readonly verticalSpacing: number;
  },
): readonly CircuitOperation[] {
  if (document.components.length > 100) {
    throw new Error("A single layout proposal is limited to 100 components.");
  }
  const ordered = [...document.components].sort((left, right) =>
    left.reference.localeCompare(right.reference, undefined, { numeric: true }),
  );
  return ordered.map((component, index) => ({
    type: "move_component",
    componentId: component.id,
    position: {
      x: 140 + (index % options.columns) * options.horizontalSpacing,
      y: 120 + Math.floor(index / options.columns) * options.verticalSpacing,
    },
  }));
}

export function compileAgentOperations(
  document: CircuitDocument,
  rawOperations: readonly unknown[],
): readonly CircuitOperation[] {
  const referenceIds = new Map(
    document.components.map((component) => [component.reference, component.id]),
  );
  const netIds = new Map(
    document.nets.flatMap((net) => [
      [net.id, net.id] as const,
      ...(net.name ? ([[net.name, net.id]] as const) : []),
    ]),
  );
  const operations: CircuitOperation[] = [];

  for (const rawOperation of rawOperations) {
    const operation = AgentCircuitOperationSchema.parse(rawOperation);

    switch (operation.type) {
      case "add_component": {
        if (referenceIds.has(operation.reference)) {
          throw new Error(`Component reference ${operation.reference} already exists.`);
        }
        const componentId = randomUUID();
        referenceIds.set(operation.reference, componentId);
        operations.push(
          CircuitOperationSchema.parse({
            ...operation,
            componentId,
            rotation: operation.rotation ?? 0,
          }),
        );
        break;
      }
      case "remove_component": {
        const componentId = resolveReference(referenceIds, operation.componentReference);
        operations.push({ type: operation.type, componentId });
        referenceIds.delete(operation.componentReference);
        break;
      }
      case "move_component":
        operations.push(
          CircuitOperationSchema.parse({
            ...operation,
            componentId: resolveReference(referenceIds, operation.componentReference),
          }),
        );
        break;
      case "set_component_value":
        operations.push({
          type: operation.type,
          componentId: resolveReference(referenceIds, operation.componentReference),
          value: operation.value,
        });
        break;
      case "connect_terminals": {
        const netId = randomUUID();
        operations.push({
          type: operation.type,
          netId,
          ...(operation.name ? { name: operation.name } : {}),
          terminals: operation.terminals.map((terminal) => ({
            componentId: resolveReference(referenceIds, terminal.componentReference),
            pinId: terminal.pinId,
          })),
        });
        netIds.set(netId, netId);
        if (operation.name) {
          netIds.set(operation.name, netId);
        }
        break;
      }
      case "disconnect_terminal":
        operations.push({
          type: operation.type,
          terminal: {
            componentId: resolveReference(referenceIds, operation.terminal.componentReference),
            pinId: operation.terminal.pinId,
          },
        });
        break;
      case "rename_net": {
        const netId = netIds.get(operation.netNameOrId);
        if (!netId) {
          throw new Error(`Net ${operation.netNameOrId} does not exist in the canonical design.`);
        }
        operations.push({ type: "rename_net", netId, name: operation.name });
        netIds.set(operation.name, netId);
        break;
      }
      case "set_schematic_metadata": {
        const { type, ...metadata } = operation;
        operations.push(CircuitOperationSchema.parse({ type, ...metadata }));
        break;
      }
    }
  }

  return operations.map((operation) => CircuitOperationSchema.parse(operation));
}

function resolveReference(referenceIds: ReadonlyMap<string, string>, reference: string): string {
  const componentId = referenceIds.get(reference);
  if (!componentId) {
    throw new Error(`Component reference ${reference} does not exist in this circuit transaction.`);
  }
  return componentId;
}
