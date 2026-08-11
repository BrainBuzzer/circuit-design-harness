import type {
  AssemblyDiagnostic,
  AssemblyDocument,
  AssemblyTransactionInput,
} from "@domain/assembly";

export interface AssemblySnapshot {
  readonly document: AssemblyDocument;
  readonly diagnostics: readonly AssemblyDiagnostic[];
}

export type ApplyAssemblyTransactionInput = AssemblyTransactionInput;

export type AssemblyEvent = {
  readonly type: "updated";
  readonly projectId: string;
  readonly snapshot: AssemblySnapshot;
};
