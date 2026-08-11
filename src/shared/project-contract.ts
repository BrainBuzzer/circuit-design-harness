export interface ProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly directoryName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly circuitRevision: number;
}

export interface ProjectState {
  readonly rootPath: string;
  readonly activeProjectId?: string;
  readonly projects: readonly ProjectSummary[];
}

export interface CreateProjectInput {
  readonly title: string;
}

export interface RenameProjectInput {
  readonly projectId: string;
  readonly title: string;
}
