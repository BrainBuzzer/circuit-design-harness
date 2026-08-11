export interface ProjectIntegrityIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ProjectIntegrityReport {
  readonly projectId: string;
  readonly verifiedAt: string;
  readonly healthy: boolean;
  readonly checkedFileCount: number;
  readonly issues: readonly ProjectIntegrityIssue[];
}
