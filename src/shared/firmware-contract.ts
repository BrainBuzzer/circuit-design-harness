import type { CircuitModelScenarioResult, CircuitSignalValue } from "@domain/circuit-simulation";
import type {
  DesignSimulationAssessment,
  EmbeddedFeature,
  EmbeddedTargetId,
} from "@domain/embedded";
import type { FirmwareCircuitRequest, FirmwareSignalTrace } from "@domain/firmware-trace";

export interface FirmwareValidationIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly documentationUrl?: string;
}

export interface EspHomeValidationResult {
  readonly valid: boolean;
  readonly structuralValidation: "passed" | "failed";
  readonly nativeValidation: "passed" | "failed" | "not_available" | "skipped_unsafe_features";
  readonly boardId?: string;
  readonly targetId?: string;
  readonly detectedComponents: readonly string[];
  readonly requiredFeatures: readonly EmbeddedFeature[];
  readonly simulation?: DesignSimulationAssessment;
  readonly issues: readonly FirmwareValidationIssue[];
  readonly nativeOutput?: string;
  readonly savedRelativePath: "firmware/esphome.yaml";
}

export interface ValidateEspHomeInput {
  readonly projectId: string;
  readonly yaml: string;
}

export interface ReadEspHomeResult {
  readonly yaml: string;
  readonly relativePath: "firmware/esphome.yaml";
}

export type FirmwareToolOutcome = "passed" | "failed" | "not_available" | "blocked";

export interface FirmwareExecutionResult {
  readonly outcome: FirmwareToolOutcome;
  readonly summary: string;
  readonly output?: string;
  readonly artifactRelativePaths: readonly string[];
}

export interface CompileEspHomeInput extends ValidateEspHomeInput {}

export interface CompileEspHomeResult {
  readonly validation: EspHomeValidationResult;
  readonly compilation: FirmwareExecutionResult;
}

export interface ReadArduinoSketchResult {
  readonly source: string;
  readonly relativePath: "firmware/arduino/CircuitHarness/CircuitHarness.ino";
}

export interface CompileArduinoInput {
  readonly projectId: string;
  readonly targetId: EmbeddedTargetId;
  readonly source: string;
}

export interface CompileArduinoResult {
  readonly targetId: EmbeddedTargetId;
  readonly fqbn?: string;
  readonly sourceValid: boolean;
  readonly requiredFeatures: readonly EmbeddedFeature[];
  readonly simulation: DesignSimulationAssessment;
  readonly issues: readonly FirmwareValidationIssue[];
  readonly compilation: FirmwareExecutionResult;
  readonly savedRelativePath: "firmware/arduino/CircuitHarness/CircuitHarness.ino";
}

export interface RunFirmwareSimulationInput {
  readonly projectId: string;
  readonly targetId: EmbeddedTargetId;
  readonly firmwareKind: "arduino" | "esphome";
  readonly engine: "simavr" | "qemu";
  readonly virtualDurationMicros?: number;
  readonly circuit?: FirmwareCircuitRequest;
}

export interface FirmwareSimulationCoverage {
  readonly cpuExecution: "executed" | "not_executed";
  readonly gpioOutputTrace: "verified" | "unsupported" | "unavailable";
  readonly uartOutputTrace: "verified" | "console_only" | "unavailable";
  readonly circuitAssertions: "evaluated" | "not_requested" | "blocked";
  readonly notes: readonly string[];
}

export interface FirmwareCircuitBridgeResult {
  readonly outcome: "passed" | "failed" | "blocked";
  readonly appliedStimuli: Readonly<Record<string, CircuitSignalValue>>;
  readonly diagnostics: readonly string[];
  readonly scenario?: CircuitModelScenarioResult;
}

export interface FirmwareSimulationResult {
  readonly outcome: "executed" | "failed" | "not_available" | "blocked";
  readonly engine: "simavr" | "qemu";
  readonly targetId: EmbeddedTargetId;
  readonly firmwareKind: "arduino" | "esphome";
  readonly assessment: DesignSimulationAssessment;
  readonly summary: string;
  readonly output?: string;
  readonly firmwareArtifactRelativePath?: string;
  readonly trace?: FirmwareSignalTrace;
  readonly coverage: FirmwareSimulationCoverage;
  readonly circuitBridge?: FirmwareCircuitBridgeResult;
}
