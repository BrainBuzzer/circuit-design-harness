export interface CircuitExportFile {
  readonly name:
    | "schematic.svg"
    | "schematic-transparent.svg"
    | "bom.csv"
    | "bom.md"
    | "design-report.md"
    | "circuit.json";
  readonly byteSize: number;
  readonly sha256: string;
}

export interface CircuitExportResult {
  readonly projectId: string;
  readonly circuitRevision: number;
  readonly directoryRelativePath: string;
  readonly files: readonly CircuitExportFile[];
}

export interface ProjectArchiveResult {
  readonly projectId: string;
  readonly circuitRevision: number;
  readonly archiveRelativePath: string;
  readonly manifestRelativePath: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly fileCount: number;
}
