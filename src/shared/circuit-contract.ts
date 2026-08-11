import type { CircuitDiagnostic, CircuitDocument, CircuitTransactionInput } from "@domain/circuit";

export interface CircuitSnapshot {
  readonly document: CircuitDocument;
  readonly diagnostics: readonly CircuitDiagnostic[];
}

export type ApplyCircuitTransactionInput = CircuitTransactionInput;

export type CircuitEvent = {
  readonly type: "updated";
  readonly projectId: string;
  readonly snapshot: CircuitSnapshot;
};
