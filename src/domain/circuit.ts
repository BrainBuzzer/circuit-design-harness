import { z } from "zod";
import { getComponentCatalogEntry, isPowerSourceKind, PART_KIND_IDS } from "./component-catalog";
import { BuiltinIcModelIdSchema, getBuiltinIcModel } from "./ic-models";

export const CIRCUIT_SCHEMA_VERSION = 3;

export const CircuitPointSchema = z.object({
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
});

export type CircuitPoint = z.infer<typeof CircuitPointSchema>;

export const PartKindSchema = z.enum(PART_KIND_IDS);
export type { PartKind } from "./component-catalog";

export const PinElectricalTypeSchema = z.enum(["passive", "power_in", "power_out"]);

export const CircuitPinSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  electricalType: PinElectricalTypeSchema,
});

export type CircuitPin = z.infer<typeof CircuitPinSchema>;

export const CircuitComponentSchema = z
  .object({
    id: z.uuid(),
    reference: z.string().regex(/^[A-Z][A-Z0-9_-]{0,15}$/),
    kind: PartKindSchema,
    value: z.string().trim().min(1).max(80).optional(),
    modelId: BuiltinIcModelIdSchema.optional(),
    pins: z.array(CircuitPinSchema).min(1).max(64),
  })
  .superRefine((component, context) => {
    if (component.kind === "ic" && !component.modelId) {
      context.addIssue({ code: "custom", path: ["modelId"], message: "ICs require a model ID." });
    }
    if (component.kind !== "ic" && component.modelId) {
      context.addIssue({
        code: "custom",
        path: ["modelId"],
        message: "Only IC components may reference an IC model.",
      });
    }
  });

export type CircuitComponent = z.infer<typeof CircuitComponentSchema>;

export const CircuitTerminalSchema = z.object({
  componentId: z.uuid(),
  pinId: z.string().min(1).max(40),
});

export type CircuitTerminal = z.infer<typeof CircuitTerminalSchema>;

export const CircuitNetSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  terminals: z.array(CircuitTerminalSchema).min(1),
});

export type CircuitNet = z.infer<typeof CircuitNetSchema>;

export const CircuitConstraintSchema = z.object({
  id: z.uuid(),
  kind: z.literal("max_voltage"),
  volts: z.number().finite().positive().max(60),
  rationale: z.string().trim().min(1).max(500),
});

export type CircuitConstraint = z.infer<typeof CircuitConstraintSchema>;

export const SchematicPlacementSchema = z.object({
  componentId: z.uuid(),
  position: CircuitPointSchema,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

export type SchematicPlacement = z.infer<typeof SchematicPlacementSchema>;

export const SchematicMetadataSchema = z.object({
  title: z.string().trim().min(1).max(160).default("Untitled circuit"),
  subtitle: z.string().trim().max(240).default(""),
  author: z.string().trim().max(120).default(""),
  documentNumber: z.string().trim().max(80).default(""),
  paperSize: z.enum(["a4", "letter"]).default("a4"),
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
});

export type SchematicMetadata = z.infer<typeof SchematicMetadataSchema>;

export const CircuitDocumentSchema = z.object({
  schemaVersion: z.literal(CIRCUIT_SCHEMA_VERSION),
  revision: z.int().nonnegative(),
  components: z.array(CircuitComponentSchema),
  nets: z.array(CircuitNetSchema),
  constraints: z.array(CircuitConstraintSchema),
  schematic: z.object({
    placements: z.array(SchematicPlacementSchema),
    metadata: SchematicMetadataSchema,
  }),
});

export type CircuitDocument = z.infer<typeof CircuitDocumentSchema>;

const LegacyCircuitDocumentV1Schema = z.object({
  schemaVersion: z.literal(1),
  revision: z.int().nonnegative(),
  components: z.array(z.never()),
  nets: z.array(z.never()),
  constraints: z.array(z.never()),
});

const LegacyCircuitDocumentV2Schema = z.object({
  schemaVersion: z.literal(2),
  revision: z.int().nonnegative(),
  components: z.array(CircuitComponentSchema),
  nets: z.array(CircuitNetSchema),
  constraints: z.array(CircuitConstraintSchema),
  schematic: z.object({
    placements: z.array(SchematicPlacementSchema),
  }),
});

export const LegacyCircuitDocumentSchema = z.union([
  LegacyCircuitDocumentV1Schema,
  LegacyCircuitDocumentV2Schema,
]);

export const AddComponentOperationSchema = z
  .object({
    type: z.literal("add_component"),
    componentId: z.uuid(),
    reference: z.string().regex(/^[A-Z][A-Z0-9_-]{0,15}$/),
    kind: PartKindSchema,
    value: z.string().trim().min(1).max(80).optional(),
    modelId: BuiltinIcModelIdSchema.optional(),
    position: CircuitPointSchema,
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  })
  .superRefine((operation, context) => {
    if (operation.kind === "ic" && !operation.modelId) {
      context.addIssue({ code: "custom", path: ["modelId"], message: "ICs require a model ID." });
    }
    if (operation.kind !== "ic" && operation.modelId) {
      context.addIssue({
        code: "custom",
        path: ["modelId"],
        message: "Only IC components may reference an IC model.",
      });
    }
  });

export const RemoveComponentOperationSchema = z.object({
  type: z.literal("remove_component"),
  componentId: z.uuid(),
});

export const MoveComponentOperationSchema = z.object({
  type: z.literal("move_component"),
  componentId: z.uuid(),
  position: CircuitPointSchema,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
});

export const SetComponentValueOperationSchema = z.object({
  type: z.literal("set_component_value"),
  componentId: z.uuid(),
  value: z.string().trim().min(1).max(80),
});

export const ConnectTerminalsOperationSchema = z.object({
  type: z.literal("connect_terminals"),
  netId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  terminals: z.array(CircuitTerminalSchema).min(2).max(32),
});

export const DisconnectTerminalOperationSchema = z.object({
  type: z.literal("disconnect_terminal"),
  terminal: CircuitTerminalSchema,
});

export const RenameNetOperationSchema = z.object({
  type: z.literal("rename_net"),
  netId: z.uuid(),
  name: z.string().trim().min(1).max(80),
});

export const SetSchematicMetadataOperationSchema = z
  .object({
    type: z.literal("set_schematic_metadata"),
    title: z.string().trim().min(1).max(160).optional(),
    subtitle: z.string().trim().max(240).optional(),
    author: z.string().trim().max(120).optional(),
    documentNumber: z.string().trim().max(80).optional(),
    paperSize: z.enum(["a4", "letter"]).optional(),
    orientation: z.enum(["landscape", "portrait"]).optional(),
  })
  .refine(
    ({ type: _type, ...changes }) => Object.values(changes).some((value) => value !== undefined),
    "At least one schematic metadata field must be provided.",
  );

export const CircuitOperationSchema = z.discriminatedUnion("type", [
  AddComponentOperationSchema,
  RemoveComponentOperationSchema,
  MoveComponentOperationSchema,
  SetComponentValueOperationSchema,
  ConnectTerminalsOperationSchema,
  DisconnectTerminalOperationSchema,
  RenameNetOperationSchema,
  SetSchematicMetadataOperationSchema,
]);

export type CircuitOperation = z.infer<typeof CircuitOperationSchema>;

export const CircuitTransactionInputSchema = z.object({
  projectId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  source: z.enum(["user", "agent"]),
  rationale: z.string().trim().min(1).max(2_000),
  operations: z.array(CircuitOperationSchema).min(1).max(100),
});

export type CircuitTransactionInput = z.infer<typeof CircuitTransactionInputSchema>;

export const CircuitProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  projectId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  rationale: z.string().trim().min(1).max(2_000),
  operations: z.array(CircuitOperationSchema).min(1).max(100),
  semanticDiff: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});

export type CircuitProposal = z.infer<typeof CircuitProposalSchema>;

export const CircuitDiagnosticSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
  componentIds: z.array(z.uuid()).optional(),
  netIds: z.array(z.uuid()).optional(),
});

export type CircuitDiagnostic = z.infer<typeof CircuitDiagnosticSchema>;

export interface CircuitTransactionResult {
  readonly document: CircuitDocument;
  readonly diagnostics: readonly CircuitDiagnostic[];
}

export class CircuitTransactionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "CircuitTransactionError";
  }
}

export function createEmptyCircuitDocument(): CircuitDocument {
  return {
    schemaVersion: CIRCUIT_SCHEMA_VERSION,
    revision: 0,
    components: [],
    nets: [],
    constraints: [],
    schematic: {
      placements: [],
      metadata: SchematicMetadataSchema.parse({}),
    },
  };
}

export function migrateCircuitDocument(input: unknown): CircuitDocument {
  const current = CircuitDocumentSchema.safeParse(input);
  if (current.success) {
    return current.data;
  }

  const legacyV1 = LegacyCircuitDocumentV1Schema.safeParse(input);
  if (legacyV1.success) {
    return {
      ...createEmptyCircuitDocument(),
      revision: legacyV1.data.revision,
    };
  }

  const legacyV2 = LegacyCircuitDocumentV2Schema.safeParse(input);
  if (legacyV2.success) {
    return CircuitDocumentSchema.parse({
      ...legacyV2.data,
      schemaVersion: CIRCUIT_SCHEMA_VERSION,
      schematic: {
        ...legacyV2.data.schematic,
        metadata: SchematicMetadataSchema.parse({}),
      },
    });
  }

  throw new CircuitTransactionError(
    "The circuit document is invalid or unsupported.",
    "invalid_document",
  );
}

export function applyCircuitOperations(
  document: CircuitDocument,
  operations: readonly CircuitOperation[],
): CircuitTransactionResult {
  let candidate = CircuitDocumentSchema.parse(document);

  for (const operation of operations) {
    candidate = applyCircuitOperation(candidate, CircuitOperationSchema.parse(operation));
  }

  candidate = CircuitDocumentSchema.parse({
    ...candidate,
    revision: document.revision + 1,
  });
  const diagnostics = validateCircuit(candidate);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new CircuitTransactionError(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join(" "),
      "validation_failed",
    );
  }

  return { document: candidate, diagnostics };
}

export function validateCircuit(document: CircuitDocument): readonly CircuitDiagnostic[] {
  const diagnostics: CircuitDiagnostic[] = [];
  const componentIds = new Set<string>();
  const references = new Set<string>();
  const terminalNets = new Map<string, string>();
  const placements = new Set<string>();

  for (const component of document.components) {
    if (componentIds.has(component.id)) {
      diagnostics.push(
        errorDiagnostic("duplicate_component_id", `Duplicate component ID ${component.id}.`, [
          component.id,
        ]),
      );
    }
    componentIds.add(component.id);

    if (references.has(component.reference)) {
      diagnostics.push(
        errorDiagnostic("duplicate_reference", `Duplicate reference ${component.reference}.`, [
          component.id,
        ]),
      );
    }
    references.add(component.reference);

    if (getComponentCatalogEntry(component.kind).requiresValue && !component.value) {
      diagnostics.push({
        severity: "warning",
        code: "missing_value",
        message: `${component.reference} has no value.`,
        componentIds: [component.id],
      });
    }
  }

  for (const placement of document.schematic.placements) {
    if (!componentIds.has(placement.componentId)) {
      diagnostics.push(
        errorDiagnostic(
          "orphan_placement",
          "A schematic placement references a missing component.",
          [placement.componentId],
        ),
      );
    }
    if (placements.has(placement.componentId)) {
      diagnostics.push(
        errorDiagnostic(
          "duplicate_placement",
          "A component has more than one schematic placement.",
          [placement.componentId],
        ),
      );
    }
    placements.add(placement.componentId);
  }

  for (const component of document.components) {
    if (!placements.has(component.id)) {
      diagnostics.push(
        errorDiagnostic("missing_placement", `${component.reference} has no schematic placement.`, [
          component.id,
        ]),
      );
    }
  }

  for (const net of document.nets) {
    const terminalKeys = new Set<string>();

    for (const terminal of net.terminals) {
      const component = document.components.find(
        (candidate) => candidate.id === terminal.componentId,
      );
      if (!component) {
        diagnostics.push(
          errorDiagnostic(
            "unknown_component",
            "A net references a missing component.",
            [terminal.componentId],
            [net.id],
          ),
        );
        continue;
      }
      if (!component.pins.some((pin) => pin.id === terminal.pinId)) {
        diagnostics.push(
          errorDiagnostic(
            "unknown_pin",
            `${component.reference} has no pin ${terminal.pinId}.`,
            [component.id],
            [net.id],
          ),
        );
        continue;
      }

      const key = terminalKey(terminal);
      if (terminalKeys.has(key)) {
        diagnostics.push(
          errorDiagnostic(
            "duplicate_terminal",
            `Net ${net.name ?? net.id} repeats ${component.reference}.${terminal.pinId}.`,
            [component.id],
            [net.id],
          ),
        );
      }
      terminalKeys.add(key);

      const otherNet = terminalNets.get(key);
      if (otherNet && otherNet !== net.id) {
        diagnostics.push(
          errorDiagnostic(
            "terminal_on_multiple_nets",
            `${component.reference}.${terminal.pinId} belongs to multiple nets.`,
            [component.id],
            [otherNet, net.id],
          ),
        );
      }
      terminalNets.set(key, net.id);
    }

    if (net.terminals.length < 2) {
      diagnostics.push({
        severity: "warning",
        code: "dangling_net",
        message: `Net ${net.name ?? net.id} has only one terminal.`,
        netIds: [net.id],
      });
    }

    for (const source of document.components.filter((component) =>
      isPowerSourceKind(component.kind),
    )) {
      const sourcePins = new Set(
        net.terminals
          .filter((terminal) => terminal.componentId === source.id)
          .map((terminal) => terminal.pinId),
      );
      if (source.pins.length >= 2 && source.pins.every((pin) => sourcePins.has(pin.id))) {
        diagnostics.push(
          errorDiagnostic(
            "shorted_source",
            `${source.reference} source terminals are shorted on one net.`,
            [source.id],
            [net.id],
          ),
        );
      }
    }
  }

  for (const component of document.components) {
    // Development-board headers intentionally expose many optional GPIO/power aliases.
    // Unused header positions are normal and should not bury actionable ERC findings.
    if (component.kind === "esp32s3_devkitc_1") {
      continue;
    }
    for (const pin of component.pins) {
      if (!terminalNets.has(terminalKey({ componentId: component.id, pinId: pin.id }))) {
        diagnostics.push({
          severity: "warning",
          code: "unconnected_pin",
          message: `${component.reference}.${pin.id} is not connected.`,
          componentIds: [component.id],
        });
      }
    }
  }

  return diagnostics;
}

function applyCircuitOperation(
  document: CircuitDocument,
  operation: CircuitOperation,
): CircuitDocument {
  switch (operation.type) {
    case "add_component": {
      if (document.components.some((component) => component.id === operation.componentId)) {
        throw new CircuitTransactionError(
          "A component with that ID already exists.",
          "duplicate_component_id",
        );
      }
      if (document.components.some((component) => component.reference === operation.reference)) {
        throw new CircuitTransactionError(
          "A component with that reference already exists.",
          "duplicate_reference",
        );
      }

      const pins =
        operation.kind === "ic"
          ? getBuiltinIcModel(operation.modelId ?? "")?.pins.map(
              ({ id, name, electricalType }) => ({
                id,
                name,
                electricalType,
              }),
            )
          : getComponentCatalogEntry(operation.kind).pins.map((pin) => ({ ...pin }));
      if (!pins) {
        throw new CircuitTransactionError(
          "The selected IC model does not exist.",
          "unknown_ic_model",
        );
      }
      const component: CircuitComponent = {
        id: operation.componentId,
        reference: operation.reference,
        kind: operation.kind,
        ...(operation.value ? { value: operation.value } : {}),
        ...(operation.modelId ? { modelId: operation.modelId } : {}),
        pins,
      };
      return {
        ...document,
        components: [...document.components, component],
        schematic: {
          ...document.schematic,
          placements: [
            ...document.schematic.placements,
            {
              componentId: operation.componentId,
              position: operation.position,
              rotation: operation.rotation,
            },
          ],
        },
      };
    }

    case "remove_component":
      assertComponentExists(document, operation.componentId);
      return {
        ...document,
        components: document.components.filter(
          (component) => component.id !== operation.componentId,
        ),
        nets: document.nets
          .map((net) => ({
            ...net,
            terminals: net.terminals.filter(
              (terminal) => terminal.componentId !== operation.componentId,
            ),
          }))
          .filter((net) => net.terminals.length > 0),
        schematic: {
          ...document.schematic,
          placements: document.schematic.placements.filter(
            (placement) => placement.componentId !== operation.componentId,
          ),
        },
      };

    case "move_component":
      assertComponentExists(document, operation.componentId);
      return {
        ...document,
        schematic: {
          ...document.schematic,
          placements: document.schematic.placements.map((placement) =>
            placement.componentId === operation.componentId
              ? {
                  ...placement,
                  position: operation.position,
                  ...(operation.rotation === undefined ? {} : { rotation: operation.rotation }),
                }
              : placement,
          ),
        },
      };

    case "set_component_value":
      assertComponentExists(document, operation.componentId);
      return {
        ...document,
        components: document.components.map((component) =>
          component.id === operation.componentId
            ? { ...component, value: operation.value }
            : component,
        ),
      };

    case "connect_terminals": {
      for (const terminal of operation.terminals) {
        assertTerminalExists(document, terminal);
      }
      const keys = new Set(operation.terminals.map(terminalKey));
      const netsToMerge = document.nets.filter(
        (net) =>
          net.id === operation.netId ||
          net.terminals.some((terminal) => keys.has(terminalKey(terminal))),
      );
      const retainedNets = document.nets.filter(
        (net) => !netsToMerge.some((merged) => merged.id === net.id),
      );
      const mergedTerminals = new Map<string, CircuitTerminal>();
      for (const terminal of [
        ...netsToMerge.flatMap((net) => net.terminals),
        ...operation.terminals,
      ]) {
        mergedTerminals.set(terminalKey(terminal), terminal);
      }
      return {
        ...document,
        nets: [
          ...retainedNets,
          {
            id: operation.netId,
            ...((operation.name ?? netsToMerge[0]?.name)
              ? { name: operation.name ?? netsToMerge[0]?.name }
              : {}),
            terminals: [...mergedTerminals.values()],
          },
        ],
      };
    }

    case "disconnect_terminal":
      assertTerminalExists(document, operation.terminal);
      return {
        ...document,
        nets: document.nets
          .map((net) => ({
            ...net,
            terminals: net.terminals.filter(
              (terminal) => terminalKey(terminal) !== terminalKey(operation.terminal),
            ),
          }))
          .filter((net) => net.terminals.length > 0),
      };

    case "rename_net": {
      if (!document.nets.some((net) => net.id === operation.netId)) {
        throw new CircuitTransactionError("The selected net does not exist.", "unknown_net");
      }
      return {
        ...document,
        nets: document.nets.map((net) =>
          net.id === operation.netId ? { ...net, name: operation.name } : net,
        ),
      };
    }

    case "set_schematic_metadata": {
      const { type: _type, ...changes } = operation;
      return {
        ...document,
        schematic: {
          ...document.schematic,
          metadata: SchematicMetadataSchema.parse({
            ...document.schematic.metadata,
            ...changes,
          }),
        },
      };
    }
  }
}

function assertComponentExists(document: CircuitDocument, componentId: string): void {
  if (!document.components.some((component) => component.id === componentId)) {
    throw new CircuitTransactionError("The component does not exist.", "component_not_found");
  }
}

function assertTerminalExists(document: CircuitDocument, terminal: CircuitTerminal): void {
  const component = document.components.find((candidate) => candidate.id === terminal.componentId);
  if (!component?.pins.some((pin) => pin.id === terminal.pinId)) {
    throw new CircuitTransactionError(
      "The selected circuit terminal does not exist.",
      "terminal_not_found",
    );
  }
}

function terminalKey(terminal: CircuitTerminal): string {
  return `${terminal.componentId}:${terminal.pinId}`;
}

function errorDiagnostic(
  code: string,
  message: string,
  componentIds?: readonly string[],
  netIds?: readonly string[],
): CircuitDiagnostic {
  return {
    severity: "error",
    code,
    message,
    ...(componentIds ? { componentIds: [...componentIds] } : {}),
    ...(netIds ? { netIds: [...netIds] } : {}),
  };
}
