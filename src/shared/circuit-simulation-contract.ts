import type { CircuitModelScenario, CircuitModelScenarioResult } from "@domain/circuit-simulation";

export interface RunCircuitModelScenarioInput {
  readonly projectId: string;
  readonly scenario: CircuitModelScenario;
}

export type RunCircuitModelScenarioResult = CircuitModelScenarioResult;
