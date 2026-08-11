import type { InstalledSimulationModel, SimulationModelProposal } from "@domain/simulation-model";
import type {
  DeclarativeSimulationEvent,
  DeclarativeSimulationResult,
} from "@domain/simulation-model-runtime";

export interface InstallSimulationModelInput {
  readonly projectId: string;
  readonly proposal: SimulationModelProposal;
}

export interface SimulationModelSnapshot {
  readonly models: readonly InstalledSimulationModel[];
}

export interface EvaluateSimulationModelInput {
  readonly projectId: string;
  readonly modelId: string;
  readonly event: DeclarativeSimulationEvent;
}

export type EvaluateSimulationModelResult = DeclarativeSimulationResult;
