import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import {
  createNewProjectDocuments,
  PROJECT_AGENT_INSTRUCTIONS,
  type ProjectManifest,
  ProjectManifestSchema,
  ProjectTitleSchema,
} from "@domain/project";
import type { ProjectState, ProjectSummary } from "@shared/project-contract";
import { z } from "zod";
import { writeFileAtomic, writeJsonAtomic } from "./json-file";

const SettingsSchema = z.object({
  schemaVersion: z.literal(1),
  projectRoot: z.string().min(1),
  activeProjectId: z.uuid().optional(),
});

type Settings = z.infer<typeof SettingsSchema>;

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Project ${projectId} was not found in the configured root.`);
    this.name = "ProjectNotFoundError";
  }
}

async function readManifest(projectDirectory: string): Promise<ProjectManifest | undefined> {
  try {
    const payload = await readFile(path.join(projectDirectory, "project.json"), "utf8");
    return ProjectManifestSchema.parse(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

function toSummary(manifest: ProjectManifest, directoryName: string): ProjectSummary {
  return {
    id: manifest.id,
    title: manifest.title,
    directoryName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    circuitRevision: manifest.circuitRevision,
  };
}

export class ProjectService {
  private settings: Settings | undefined;
  private durableProjectRoot: string;

  constructor(
    private readonly settingsPath: string,
    private readonly defaultProjectRoot: string,
    private readonly runtimeProjectRoot?: string,
  ) {
    this.durableProjectRoot = path.resolve(defaultProjectRoot);
  }

  async initialize(): Promise<ProjectState> {
    const storedSettings = await this.loadSettings();
    this.durableProjectRoot = storedSettings.projectRoot;
    this.settings = storedSettings;
    if (this.runtimeProjectRoot) {
      this.settings = {
        ...storedSettings,
        projectRoot: path.resolve(this.runtimeProjectRoot),
      };
    }
    await this.ensureWritableDirectory(this.settings.projectRoot);
    return this.getState();
  }

  async getState(): Promise<ProjectState> {
    const settings = this.requireSettings();
    const projects = await this.listProjects(settings.projectRoot);
    const activeProjectId = projects.some((project) => project.id === settings.activeProjectId)
      ? settings.activeProjectId
      : undefined;

    return {
      rootPath: settings.projectRoot,
      ...(activeProjectId ? { activeProjectId } : {}),
      projects,
    };
  }

  async setProjectRoot(projectRoot: string): Promise<ProjectState> {
    const resolvedRoot = path.resolve(projectRoot);
    await this.ensureWritableDirectory(resolvedRoot);
    this.settings = {
      schemaVersion: 1,
      projectRoot: resolvedRoot,
    };
    await this.persistSettings();
    return this.getState();
  }

  async createProject(title: string): Promise<ProjectState> {
    const settings = this.requireSettings();
    const documents = createNewProjectDocuments(title);
    const shortId = documents.manifest.id.slice(0, 8);
    const directoryName = `${documents.manifest.slug}--${shortId}`;
    const finalDirectory = path.join(settings.projectRoot, directoryName);
    const stagingDirectory = path.join(
      settings.projectRoot,
      `.${directoryName}.${randomUUID()}.creating`,
    );

    try {
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      await Promise.all(
        [
          "chat",
          "attachments/originals",
          "attachments/extracted",
          "captures",
          "history",
          "exports",
          "firmware",
          "simulation/models/history",
        ].map((relativePath) =>
          mkdir(path.join(stagingDirectory, relativePath), { recursive: true }),
        ),
      );
      await Promise.all([
        writeJsonAtomic(path.join(stagingDirectory, "project.json"), documents.manifest),
        writeJsonAtomic(path.join(stagingDirectory, "circuit.json"), documents.circuit),
        writeJsonAtomic(path.join(stagingDirectory, "assembly.json"), documents.assembly),
        writeFileAtomic(path.join(stagingDirectory, "AGENTS.md"), PROJECT_AGENT_INSTRUCTIONS),
      ]);
      await rename(stagingDirectory, finalDirectory);
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true });
      throw error;
    }

    this.settings = {
      ...settings,
      activeProjectId: documents.manifest.id,
    };
    await this.persistSettings();
    return this.getState();
  }

  async activateProject(projectId: string): Promise<ProjectState> {
    await this.getProjectDirectory(projectId);
    this.settings = {
      ...this.requireSettings(),
      activeProjectId: projectId,
    };
    await this.persistSettings();
    return this.getState();
  }

  async renameProject(projectId: string, rawTitle: string): Promise<ProjectState> {
    const title = ProjectTitleSchema.parse(rawTitle);
    const projectDirectory = await this.getProjectDirectory(projectId);
    const manifest = await readManifest(projectDirectory);
    if (!manifest) {
      throw new ProjectNotFoundError(projectId);
    }
    await writeJsonAtomic(
      path.join(projectDirectory, "project.json"),
      ProjectManifestSchema.parse({ ...manifest, title, updatedAt: new Date().toISOString() }),
    );
    return this.getState();
  }

  async getActiveProjectDirectory(): Promise<string | undefined> {
    const activeProjectId = this.requireSettings().activeProjectId;
    return activeProjectId ? this.getProjectDirectory(activeProjectId) : undefined;
  }

  async getProjectDirectory(projectId: string): Promise<string> {
    const settings = this.requireSettings();
    const entries = await readdir(settings.projectRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }

      const projectDirectory = path.join(settings.projectRoot, entry.name);
      const manifest = await readManifest(projectDirectory);

      if (manifest?.id === projectId) {
        return projectDirectory;
      }
    }

    throw new ProjectNotFoundError(projectId);
  }

  async updateCircuitRevision(projectId: string, circuitRevision: number): Promise<void> {
    const projectDirectory = await this.getProjectDirectory(projectId);
    const manifest = await readManifest(projectDirectory);

    if (!manifest) {
      throw new ProjectNotFoundError(projectId);
    }

    await writeJsonAtomic(
      path.join(projectDirectory, "project.json"),
      ProjectManifestSchema.parse({
        ...manifest,
        circuitRevision,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  private async loadSettings(): Promise<Settings> {
    try {
      const raw = await readFile(this.settingsPath, "utf8");
      return SettingsSchema.parse(JSON.parse(raw));
    } catch {
      const initial: Settings = {
        schemaVersion: 1,
        projectRoot: path.resolve(this.defaultProjectRoot),
      };
      if (!this.runtimeProjectRoot) {
        await this.ensureWritableDirectory(initial.projectRoot);
      }
      await mkdir(path.dirname(this.settingsPath), { recursive: true, mode: 0o700 });
      await writeJsonAtomic(this.settingsPath, initial);
      return initial;
    }
  }

  private async listProjects(projectRoot: string): Promise<readonly ProjectSummary[]> {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => {
          const manifest = await readManifest(path.join(projectRoot, entry.name));
          return manifest ? toSummary(manifest, entry.name) : undefined;
        }),
    );

    return projects
      .filter((project): project is ProjectSummary => project !== undefined)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async ensureWritableDirectory(directory: string): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await access(directory, constants.R_OK | constants.W_OK);
  }

  private requireSettings(): Settings {
    if (!this.settings) {
      throw new Error("Project service has not been initialized.");
    }

    return this.settings;
  }

  private async persistSettings(): Promise<void> {
    const settings = this.requireSettings();
    await mkdir(path.dirname(this.settingsPath), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(
      this.settingsPath,
      this.runtimeProjectRoot ? { ...settings, projectRoot: this.durableProjectRoot } : settings,
    );
  }
}
