import { z } from "zod";
import type { CircuitDocument } from "./circuit";

export const ASSEMBLY_SCHEMA_VERSION = 2;

export const BreadboardHoleSchema = z
  .string()
  .regex(/^(?:[a-j](?:[1-9]|[12]\d|30)|(?:top|bottom)[+-](?:[1-9]|[12]\d|30))$/);
export type BreadboardHole = z.infer<typeof BreadboardHoleSchema>;

export const AssemblyPinPlacementSchema = z.object({
  pinId: z.string().min(1).max(40),
  hole: BreadboardHoleSchema,
});

export const AssemblyComponentPlacementSchema = z.object({
  componentId: z.uuid(),
  pins: z.array(AssemblyPinPlacementSchema).min(1).max(32),
});

export const AssemblyJumperSchema = z.object({
  id: z.uuid(),
  from: BreadboardHoleSchema,
  to: BreadboardHoleSchema,
  color: z.enum(["black", "red", "orange", "yellow", "green", "blue", "violet", "white"]),
});

export const AssemblyObservationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["note", "voltage", "continuity"]),
  text: z.string().trim().min(1).max(1_000),
  holes: z.array(BreadboardHoleSchema).max(2).default([]),
  createdAt: z.iso.datetime(),
});

export const AssemblyDocumentSchema = z.object({
  schemaVersion: z.literal(ASSEMBLY_SCHEMA_VERSION),
  revision: z.int().nonnegative(),
  circuitRevision: z.int().nonnegative(),
  board: z.object({
    kind: z.literal("solderless_breadboard"),
    columns: z.literal(30),
  }),
  placements: z.array(AssemblyComponentPlacementSchema),
  jumpers: z.array(AssemblyJumperSchema),
  observations: z.array(AssemblyObservationSchema),
});
export type AssemblyDocument = z.infer<typeof AssemblyDocumentSchema>;

export const LegacyAssemblyDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  circuitRevision: z.int().nonnegative(),
  placements: z.array(z.never()),
  observations: z.array(z.never()),
});

export const AssemblyOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place_component_pin"),
    componentId: z.uuid(),
    pinId: z.string().min(1).max(40),
    hole: BreadboardHoleSchema,
  }),
  z.object({
    type: z.literal("remove_component_placement"),
    componentId: z.uuid(),
  }),
  z.object({
    type: z.literal("add_jumper"),
    jumperId: z.uuid(),
    from: BreadboardHoleSchema,
    to: BreadboardHoleSchema,
    color: AssemblyJumperSchema.shape.color,
  }),
  z.object({ type: z.literal("remove_jumper"), jumperId: z.uuid() }),
]);
export type AssemblyOperation = z.infer<typeof AssemblyOperationSchema>;

export const AssemblyTransactionInputSchema = z.object({
  projectId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  expectedCircuitRevision: z.int().nonnegative(),
  source: z.enum(["user", "agent"]),
  rationale: z.string().trim().min(1).max(1_000),
  operations: z.array(AssemblyOperationSchema).min(1).max(100),
});
export type AssemblyTransactionInput = z.infer<typeof AssemblyTransactionInputSchema>;

export const AssemblyProposalSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  projectId: z.uuid(),
  baseRevision: z.int().nonnegative(),
  circuitRevision: z.int().nonnegative(),
  rationale: z.string().trim().min(1).max(1_000),
  operations: z.array(AssemblyOperationSchema).min(1).max(100),
  semanticDiff: z.array(z.string().trim().min(1).max(500)).max(100),
  status: z.enum(["pending", "approved", "rejected"]),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});
export type AssemblyProposal = z.infer<typeof AssemblyProposalSchema>;

export interface AssemblyDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly paths: readonly string[];
}

export function createEmptyAssemblyDocument(circuitRevision = 0): AssemblyDocument {
  return {
    schemaVersion: ASSEMBLY_SCHEMA_VERSION,
    revision: 0,
    circuitRevision,
    board: { kind: "solderless_breadboard", columns: 30 },
    placements: [],
    jumpers: [],
    observations: [],
  };
}

/**
 * Occupancy map used by the review-only breadboard UI. Keys are hole IDs;
 * values are human-readable labels (component.pin and/or jumper index).
 */
export function buildBreadboardOccupancy(
  assembly: AssemblyDocument,
  circuit: CircuitDocument,
): ReadonlyMap<string, string> {
  const holes = new Map<string, string>();
  for (const placement of assembly.placements) {
    const reference = circuit.components.find(
      (candidate) => candidate.id === placement.componentId,
    )?.reference;
    for (const pin of placement.pins) {
      holes.set(pin.hole, `${reference ?? "?"}.${pin.pinId}`);
    }
  }
  for (const [index, jumper] of assembly.jumpers.entries()) {
    const label = `J${index + 1}`;
    const fromLabel = holes.get(jumper.from);
    holes.set(jumper.from, fromLabel ? `${fromLabel}+${label}` : label);
    const toLabel = holes.get(jumper.to);
    holes.set(jumper.to, toLabel ? `${toLabel}+${label}` : label);
  }
  return holes;
}

export function migrateAssemblyDocument(raw: unknown): AssemblyDocument {
  const current = AssemblyDocumentSchema.safeParse(raw);
  if (current.success) {
    return current.data;
  }
  const legacy = LegacyAssemblyDocumentSchema.parse(raw);
  return createEmptyAssemblyDocument(legacy.circuitRevision);
}

export function applyAssemblyOperations(
  current: AssemblyDocument,
  circuit: CircuitDocument,
  operations: readonly AssemblyOperation[],
): { readonly document: AssemblyDocument; readonly diagnostics: readonly AssemblyDiagnostic[] } {
  let placements = current.placements.map((placement) => ({
    ...placement,
    pins: [...placement.pins],
  }));
  let jumpers = [...current.jumpers];

  for (const operation of operations.map((candidate) => AssemblyOperationSchema.parse(candidate))) {
    if (operation.type === "place_component_pin") {
      const component = circuit.components.find(
        (candidate) => candidate.id === operation.componentId,
      );
      if (!component?.pins.some((pin) => pin.id === operation.pinId)) {
        throw new Error("Assembly placement references an unknown component pin.");
      }
      const placement = placements.find(
        (candidate) => candidate.componentId === operation.componentId,
      );
      if (placement) {
        placements = placements.map((candidate) =>
          candidate.componentId === operation.componentId
            ? {
                ...candidate,
                pins: [
                  ...candidate.pins.filter((pin) => pin.pinId !== operation.pinId),
                  { pinId: operation.pinId, hole: operation.hole },
                ],
              }
            : candidate,
        );
      } else {
        placements.push({
          componentId: operation.componentId,
          pins: [{ pinId: operation.pinId, hole: operation.hole }],
        });
      }
    } else if (operation.type === "remove_component_placement") {
      placements = placements.filter(
        (candidate) => candidate.componentId !== operation.componentId,
      );
    } else if (operation.type === "add_jumper") {
      if (operation.from === operation.to) {
        throw new Error("A breadboard jumper must connect two different holes.");
      }
      if (jumpers.some((candidate) => candidate.id === operation.jumperId)) {
        throw new Error("Assembly jumper IDs must be unique.");
      }
      jumpers.push({
        id: operation.jumperId,
        from: operation.from,
        to: operation.to,
        color: operation.color,
      });
    } else if (operation.type === "remove_jumper") {
      if (!jumpers.some((candidate) => candidate.id === operation.jumperId)) {
        throw new Error(`Assembly jumper ${operation.jumperId} does not exist.`);
      }
      jumpers = jumpers.filter((candidate) => candidate.id !== operation.jumperId);
    }
  }

  const document = AssemblyDocumentSchema.parse({
    ...current,
    revision: current.revision + 1,
    circuitRevision: circuit.revision,
    placements,
    jumpers,
  });
  const diagnostics = validateAssembly(document, circuit);
  const blocking = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (blocking) {
    throw new Error(blocking.message);
  }
  return { document, diagnostics };
}

export function validateAssembly(
  assembly: AssemblyDocument,
  circuit: CircuitDocument,
): readonly AssemblyDiagnostic[] {
  const diagnostics: AssemblyDiagnostic[] = [];
  if (assembly.circuitRevision !== circuit.revision) {
    diagnostics.push({
      severity: assembly.circuitRevision > circuit.revision ? "error" : "warning",
      code: "stale_circuit_revision",
      message: `Assembly targets circuit revision ${assembly.circuitRevision}, while the circuit is revision ${circuit.revision}. Review physical placements before updating them.`,
      paths: ["circuitRevision"],
    });
  }
  const occupied = new Map<string, string>();
  const placedTerminals: Array<{
    readonly componentId: string;
    readonly pinId: string;
    readonly hole: string;
  }> = [];

  for (const [placementIndex, placement] of assembly.placements.entries()) {
    const component = circuit.components.find(
      (candidate) => candidate.id === placement.componentId,
    );
    if (!component) {
      diagnostics.push({
        severity: "error",
        code: "unknown_component",
        message: "A breadboard placement references a component no longer in the circuit.",
        paths: [`placements.${placementIndex}.componentId`],
      });
      continue;
    }
    const pinIds = new Set<string>();
    for (const [pinIndex, pin] of placement.pins.entries()) {
      const pinPath = `placements.${placementIndex}.pins.${pinIndex}`;
      if (
        pinIds.has(pin.pinId) ||
        !component.pins.some((candidate) => candidate.id === pin.pinId)
      ) {
        diagnostics.push({
          severity: "error",
          code: "unknown_or_duplicate_pin",
          message: `${component.reference} has an unknown or duplicate placed pin ${pin.pinId}.`,
          paths: [pinPath],
        });
        continue;
      }
      pinIds.add(pin.pinId);
      const previous = occupied.get(pin.hole);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "occupied_hole",
          message: `Breadboard hole ${pin.hole} is already occupied.`,
          paths: [previous, pinPath],
        });
      } else {
        occupied.set(pin.hole, pinPath);
      }
      placedTerminals.push({ componentId: component.id, pinId: pin.pinId, hole: pin.hole });
    }
  }

  for (const [jumperIndex, jumper] of assembly.jumpers.entries()) {
    for (const [endpoint, hole] of [
      ["from", jumper.from],
      ["to", jumper.to],
    ] as const) {
      const jumperPath = `jumpers.${jumperIndex}.${endpoint}`;
      const previous = occupied.get(hole);
      if (previous) {
        diagnostics.push({
          severity: "error",
          code: "occupied_hole",
          message: `Breadboard hole ${hole} is already occupied.`,
          paths: [previous, jumperPath],
        });
      } else {
        occupied.set(hole, jumperPath);
      }
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return diagnostics;
  }

  const connectivity = new HoleConnectivity();
  for (const jumper of assembly.jumpers) {
    connectivity.union(jumper.from, jumper.to);
  }
  const physicalGroups = new Map<string, typeof placedTerminals>();
  for (const terminal of placedTerminals) {
    const root = connectivity.find(terminal.hole);
    physicalGroups.set(root, [...(physicalGroups.get(root) ?? []), terminal]);
  }
  const logicalNetByTerminal = new Map<string, string>();
  for (const net of circuit.nets) {
    for (const terminal of net.terminals) {
      logicalNetByTerminal.set(`${terminal.componentId}:${terminal.pinId}`, net.id);
    }
  }
  for (const terminals of physicalGroups.values()) {
    const logicalNets = new Set(
      terminals
        .map((terminal) => logicalNetByTerminal.get(`${terminal.componentId}:${terminal.pinId}`))
        .filter((netId): netId is string => Boolean(netId)),
    );
    if (logicalNets.size > 1) {
      diagnostics.push({
        severity: "error",
        code: "physical_short",
        message: "The breadboard physically joins terminals from different logical nets.",
        paths: terminals.map((terminal) => `${terminal.componentId}.${terminal.pinId}`),
      });
    }
  }
  for (const net of circuit.nets) {
    const roots = new Set(
      placedTerminals
        .filter((terminal) =>
          net.terminals.some(
            (candidate) =>
              candidate.componentId === terminal.componentId && candidate.pinId === terminal.pinId,
          ),
        )
        .map((terminal) => connectivity.find(terminal.hole)),
    );
    const placedCount = net.terminals.filter((terminal) =>
      placedTerminals.some(
        (placed) => placed.componentId === terminal.componentId && placed.pinId === terminal.pinId,
      ),
    ).length;
    if (placedCount > 1 && roots.size > 1) {
      diagnostics.push({
        severity: "warning",
        code: "logical_net_not_connected",
        message: `Placed terminals on net ${net.name ?? net.id} are not physically connected.`,
        paths: net.terminals.map((terminal) => `${terminal.componentId}.${terminal.pinId}`),
      });
    }
  }
  return diagnostics;
}

class HoleConnectivity {
  private readonly parents = new Map<string, string>();

  find(hole: string): string {
    const intrinsic = intrinsicGroup(hole);
    const parent = this.parents.get(intrinsic);
    if (!parent) {
      this.parents.set(intrinsic, intrinsic);
      return intrinsic;
    }
    if (parent === intrinsic) {
      return parent;
    }
    const root = this.find(parent);
    this.parents.set(intrinsic, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents.set(rightRoot, leftRoot);
    }
  }
}

function intrinsicGroup(hole: string): string {
  const terminal = /^([a-j])(\d+)$/.exec(hole);
  if (terminal) {
    const row = terminal[1] ?? "";
    const column = terminal[2] ?? "";
    return `${row <= "e" ? "left" : "right"}:${column}`;
  }
  const rail = /^(top|bottom)([+-])\d+$/.exec(hole);
  return rail ? `${rail[1]}${rail[2]}` : hole;
}
