import { z } from "zod";
import type { CircuitDocument } from "./circuit";
import { evaluateBuiltinIc, getBuiltinIcModel, type IcEvaluationResult } from "./ic-models";

const SignalValueSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal("x"),
  z.literal("z"),
  z.number().finite(),
]);
export type CircuitSignalValue = z.infer<typeof SignalValueSchema>;

export const CircuitModelScenarioSchema = z
  .object({
    stimuli: z.record(z.string().trim().min(1).max(80), SignalValueSchema).default({}),
    risingEdges: z
      .array(
        z
          .object({
            componentReference: z.string().trim().min(1).max(16),
            pinId: z.string().trim().min(1).max(40),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    initialState: z
      .record(z.string().trim().min(1).max(16), z.record(z.string(), z.unknown()))
      .default({}),
    assertions: z
      .array(
        z
          .object({
            net: z.string().trim().min(1).max(80),
            equals: SignalValueSchema,
            label: z.string().trim().min(1).max(160).optional(),
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();

export type CircuitModelScenario = z.infer<typeof CircuitModelScenarioSchema>;

export interface CircuitModelDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly message: string;
  readonly net?: string;
  readonly componentReference?: string;
}

export interface CircuitModelAssertionResult {
  readonly label: string;
  readonly net: string;
  readonly expected: CircuitSignalValue;
  readonly actual: CircuitSignalValue | undefined;
  readonly passed: boolean;
}

export interface CircuitModelScenarioResult {
  readonly outcome: "passed" | "failed" | "blocked";
  readonly converged: boolean;
  readonly iterations: number;
  readonly signals: Readonly<Record<string, CircuitSignalValue>>;
  readonly componentState: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly assertions: readonly CircuitModelAssertionResult[];
  readonly diagnostics: readonly CircuitModelDiagnostic[];
  readonly evaluatedComponents: readonly string[];
  readonly unmodeledComponents: readonly string[];
  readonly limitations: readonly string[];
}

export function runCircuitModelScenario(
  document: CircuitDocument,
  rawScenario: CircuitModelScenario,
): CircuitModelScenarioResult {
  const scenario = CircuitModelScenarioSchema.parse(rawScenario);
  const diagnostics: CircuitModelDiagnostic[] = [];
  const selectorToNet = new Map<string, string>();
  const netLabels = new Map<string, string>();
  for (const net of document.nets) {
    selectorToNet.set(net.id, net.id);
    netLabels.set(net.id, net.name ?? net.id);
    if (net.name) {
      if (selectorToNet.has(net.name)) {
        diagnostics.push({
          severity: "error",
          code: "ambiguous_net_name",
          message: `Net name ${net.name} is not unique. Use stable net IDs in the scenario.`,
          net: net.name,
        });
      } else {
        selectorToNet.set(net.name, net.id);
      }
    }
  }

  const terminalNet = new Map<string, string>();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      terminalNet.set(`${terminal.componentId}:${terminal.pinId}`, net.id);
    }
  }

  const stimuli = new Map<string, CircuitSignalValue>();
  for (const [selector, value] of Object.entries(scenario.stimuli)) {
    const netId = selectorToNet.get(selector);
    if (!netId) {
      diagnostics.push({
        severity: "error",
        code: "unknown_stimulus_net",
        message: `Stimulus references unknown net ${selector}.`,
        net: selector,
      });
    } else {
      stimuli.set(netId, value);
    }
  }

  const icComponents = document.components.filter(
    (component) => component.kind === "ic" && component.modelId,
  );
  const evaluatedComponents = icComponents.map((component) => component.reference);
  const unmodeledComponents = document.components
    .filter((component) => component.kind !== "ic")
    .map((component) => component.reference);
  const limitations = new Set<string>([
    "This runner propagates event/functional component models only; it does not solve voltage, current, impedance, timing, thermal behavior, parasitics, or physical safety.",
    "Firmware GPIO enters only through explicit pin-to-net mappings; no wiring, input feedback, bus behavior, or electrical loading is inferred.",
  ]);
  const componentState: Record<string, Readonly<Record<string, unknown>>> = {
    ...scenario.initialState,
  };
  const edgeByComponent = new Map<string, string>();
  for (const edge of scenario.risingEdges) {
    const component = document.components.find(
      (candidate) => candidate.reference === edge.componentReference,
    );
    if (!component?.pins.some((pin) => pin.id === edge.pinId)) {
      diagnostics.push({
        severity: "error",
        code: "unknown_edge_pin",
        message: `Rising edge references unknown terminal ${edge.componentReference}.${edge.pinId}.`,
        componentReference: edge.componentReference,
      });
    } else if (edgeByComponent.has(edge.componentReference)) {
      diagnostics.push({
        severity: "error",
        code: "multiple_component_edges",
        message: `Only one rising edge per component is accepted in one deterministic step (${edge.componentReference}).`,
        componentReference: edge.componentReference,
      });
    } else {
      edgeByComponent.set(edge.componentReference, edge.pinId);
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return blockedResult(diagnostics, evaluatedComponents, unmodeledComponents, limitations);
  }

  let signals = new Map(stimuli);
  let converged = false;
  let iterations = 0;
  for (iterations = 1; iterations <= 32; iterations += 1) {
    const drivers = new Map<string, Array<{ value: CircuitSignalValue; source: string }>>();
    for (const [netId, value] of stimuli) {
      drivers.set(netId, [{ value, source: "scenario stimulus" }]);
    }

    for (const component of icComponents) {
      if (!component.modelId) continue;
      const model = getBuiltinIcModel(component.modelId);
      if (!model) {
        diagnostics.push({
          severity: "error",
          code: "missing_ic_model",
          message: `${component.reference} references unavailable model ${component.modelId}.`,
          componentReference: component.reference,
        });
        continue;
      }
      for (const limitation of model.limitations)
        limitations.add(`${model.partNumber}: ${limitation}`);
      const pins: Record<string, CircuitSignalValue | undefined> = {};
      for (const pin of component.pins) {
        const netId = terminalNet.get(`${component.id}:${pin.id}`);
        if (netId) pins[pin.id] = signals.get(netId);
      }
      let evaluation: IcEvaluationResult;
      try {
        const state = componentState[component.reference];
        const risingEdgePin =
          iterations === 1 ? edgeByComponent.get(component.reference) : undefined;
        evaluation = evaluateBuiltinIc(component.modelId, {
          pins,
          ...(state ? { state } : {}),
          ...(risingEdgePin ? { risingEdgePin } : {}),
        });
      } catch (reason) {
        diagnostics.push({
          severity: "error",
          code: "component_evaluation_failed",
          message: `${component.reference} evaluation failed: ${reason instanceof Error ? reason.message : String(reason)}`,
          componentReference: component.reference,
        });
        continue;
      }
      componentState[component.reference] = evaluation.state;
      for (const [pinId, value] of Object.entries(evaluation.outputs)) {
        if (value === "z") continue;
        const netId = terminalNet.get(`${component.id}:${pinId}`);
        if (!netId) continue;
        drivers.set(netId, [
          ...(drivers.get(netId) ?? []),
          { value, source: `${component.reference}.${pinId}` },
        ]);
      }
    }

    const next = new Map<string, CircuitSignalValue>();
    for (const [netId, netDrivers] of drivers) {
      const resolved = resolveDrivers(netDrivers.map((driver) => driver.value));
      next.set(netId, resolved);
      if (resolved === "x" && netDrivers.length > 1) {
        diagnostics.push({
          severity: "error",
          code: "conflicting_drivers",
          message: `Net ${netLabels.get(netId) ?? netId} has conflicting functional drivers: ${netDrivers.map((driver) => driver.source).join(", ")}.`,
          net: netLabels.get(netId) ?? netId,
        });
      }
    }
    if (mapsEqual(signals, next)) {
      signals = next;
      converged = true;
      break;
    }
    signals = next;
  }

  if (!converged) {
    diagnostics.push({
      severity: "error",
      code: "model_did_not_converge",
      message: "Functional component propagation did not converge within 32 iterations.",
    });
  }

  const assertions = scenario.assertions.map((assertion): CircuitModelAssertionResult => {
    const netId = selectorToNet.get(assertion.net);
    const actual = netId ? signals.get(netId) : undefined;
    if (!netId) {
      diagnostics.push({
        severity: "error",
        code: "unknown_assertion_net",
        message: `Assertion references unknown net ${assertion.net}.`,
        net: assertion.net,
      });
    }
    return {
      label: assertion.label ?? `${assertion.net} equals ${String(assertion.equals)}`,
      net: assertion.net,
      expected: assertion.equals,
      actual,
      passed: actual === assertion.equals,
    };
  });
  const namedSignals = Object.fromEntries(
    [...signals].map(([netId, value]) => [netLabels.get(netId) ?? netId, value]),
  );
  const failed =
    !converged ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error") ||
    assertions.some((assertion) => !assertion.passed);
  return {
    outcome: failed ? "failed" : "passed",
    converged,
    iterations: Math.min(iterations, 32),
    signals: namedSignals,
    componentState,
    assertions,
    diagnostics,
    evaluatedComponents,
    unmodeledComponents,
    limitations: [...limitations],
  };
}

function blockedResult(
  diagnostics: readonly CircuitModelDiagnostic[],
  evaluatedComponents: readonly string[],
  unmodeledComponents: readonly string[],
  limitations: ReadonlySet<string>,
): CircuitModelScenarioResult {
  return {
    outcome: "blocked",
    converged: false,
    iterations: 0,
    signals: {},
    componentState: {},
    assertions: [],
    diagnostics,
    evaluatedComponents,
    unmodeledComponents,
    limitations: [...limitations],
  };
}

function resolveDrivers(values: readonly CircuitSignalValue[]): CircuitSignalValue {
  const active = values.filter((value) => value !== "z");
  if (active.length === 0) return "z";
  const first = active[0] ?? "x";
  return active.every((value) => value === first) ? first : "x";
}

function mapsEqual(
  left: ReadonlyMap<string, CircuitSignalValue>,
  right: ReadonlyMap<string, CircuitSignalValue>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([key, value]) => right.has(key) && right.get(key) === value)
  );
}
