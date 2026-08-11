import { access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CircuitModelScenarioSchema } from "@domain/circuit-simulation";
import { EmbeddedTargetIdSchema } from "@domain/embedded";
import {
  FirmwareCircuitRequestSchema,
  prepareFirmwareCircuitScenario,
} from "@domain/firmware-trace";
import { AppPreferencesSchema } from "@domain/preferences";
import { ProjectTitleSchema } from "@domain/project";
import { DeclarativeSimulationEventSchema } from "@domain/simulation-model-runtime";
import { APP_VERSION, type AppInfo } from "@shared/app-contract";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { z } from "zod";
import { ArchiveService } from "./services/archive-service";
import { AssemblyService } from "./services/assembly-service";
import { AttachmentService } from "./services/attachment-service";
import { CameraEvidenceService } from "./services/camera-evidence-service";
import { CaptureService } from "./services/capture-service";
import { CircuitService } from "./services/circuit-service";
import { CoachService } from "./services/coach-service";
import { EmbeddedCatalogService } from "./services/embedded-catalog-service";
import { ExportService } from "./services/export-service";
import { FirmwareService } from "./services/firmware-service";
import { LanCameraRelayService } from "./services/lan-camera-relay-service";
import { LocalSimulatorService } from "./services/local-simulator-service";
import { enforcePersistentLogBudget } from "./services/log-retention-service";
import { PiService } from "./services/pi-service";
import { PreferencesService } from "./services/preferences-service";
import { ProjectIntegrityService } from "./services/project-integrity-service";
import { ProjectService } from "./services/project-service";
import { RemoteCameraService } from "./services/remote-camera-service";
import { SimulationModelService } from "./services/simulation-model-service";
import { TranscriptionService } from "./services/transcription-service";
import { TtsService } from "./services/tts-service";
import { loadVoiceSources, VoiceAssetService } from "./services/voice-asset-service";
import { WakeWordService } from "./services/wake-word-service";

const APP_SCHEME = "circuit-harness";
const APP_HOST = "app";
type MediaAuthorization = {
  readonly kind: "audio" | "video";
  readonly expiresAt: number;
};
const mediaAuthorizations = new Map<number, MediaAuthorization>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

function isTrustedRendererUrl(rawUrl: string): boolean {
  const url = new URL(rawUrl);

  if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) {
    return true;
  }

  return (
    Boolean(process.env.ELECTRON_RENDERER_URL) && url.origin === process.env.ELECTRON_RENDERER_URL
  );
}

function registerProductionProtocol(): void {
  const rendererRoot = path.resolve(import.meta.dirname, "../renderer");

  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);

    if (url.host !== APP_HOST) {
      return new Response("Not found", { status: 404 });
    }

    const requestPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const resolvedPath = path.resolve(rendererRoot, `.${requestPath}`);
    const allowedPrefix = `${rendererRoot}${path.sep}`;

    if (resolvedPath !== rendererRoot && !resolvedPath.startsWith(allowedPrefix)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(resolvedPath).toString());
  });
}

function registerSecurityHandlers(): void {
  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (
        permission !== "media" ||
        (details.mediaType !== "video" && details.mediaType !== "audio") ||
        !webContents ||
        !isTrustedRendererUrl(requestingOrigin)
      ) {
        return false;
      }

      return (
        isTrustedRendererUrl(webContents.getURL()) &&
        hasActiveMediaAuthorization(webContents.id, details.mediaType)
      );
    },
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
      const requestedType =
        mediaTypes?.length === 1 && (mediaTypes[0] === "video" || mediaTypes[0] === "audio")
          ? mediaTypes[0]
          : undefined;
      const permitted =
        permission === "media" &&
        requestedType !== undefined &&
        isTrustedRendererUrl(webContents.getURL()) &&
        hasActiveMediaAuthorization(webContents.id, requestedType);
      callback(permitted);
    },
  );
}

function hasActiveMediaAuthorization(webContentsId: number, kind: "audio" | "video"): boolean {
  const authorization = mediaAuthorizations.get(webContentsId);
  if (!authorization || authorization.expiresAt <= Date.now()) {
    mediaAuthorizations.delete(webContentsId);
    return false;
  }
  return authorization.kind === kind;
}

const ProjectIdSchema = z.uuid();
const SendAgentMessageSchema = z.object({
  projectId: z.uuid(),
  text: z.string().trim().min(1).max(100_000),
  attachmentIds: z.array(z.uuid()).max(20).optional(),
  captureIds: z.array(z.uuid()).max(10).optional(),
});
const ProviderIdSchema = z.string().trim().min(1).max(200);
const StartProviderLoginSchema = z.object({
  providerId: ProviderIdSchema,
  authType: z.enum(["api_key", "oauth"]),
});
const RespondToAuthPromptSchema = z.object({
  flowId: z.uuid(),
  promptId: z.uuid(),
  value: z.string().max(100_000),
});
const SetAgentModelSchema = z.object({
  projectId: z.uuid(),
  providerId: ProviderIdSchema,
  modelId: z.string().trim().min(1).max(500),
});
const ResolveCircuitProposalSchema = z.object({
  projectId: z.uuid(),
  proposalId: z.uuid(),
});
const SaveCameraCaptureSchema = z.object({
  projectId: z.uuid(),
  jpegBytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= 12 * 1024 * 1024),
  width: z.int().positive().max(16_384),
  height: z.int().positive().max(16_384),
  expectedCircuitRevision: z.int().nonnegative(),
  deviceLabel: z.string().trim().min(1).max(200),
  source: z.enum(["local_camera", "remote_camera"]),
});
const AttachmentMutationSchema = z.object({
  projectId: z.uuid(),
  attachmentId: z.uuid(),
});
const RestoreAttachmentSchema = z.object({
  projectId: z.uuid(),
  trashId: z.uuid(),
});
const TranscribeAudioSchema = z.object({
  projectId: z.uuid(),
  wavBytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= 4 * 1024 * 1024),
  durationMs: z.int().min(250).max(60_000),
});
const ExternalUrlSchema = z.url().refine((rawUrl) => {
  const url = new URL(rawUrl);
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
}, "Only HTTPS and localhost callback URLs may be opened.");

function assertTrustedIpc(event: IpcMainInvokeEvent): void {
  const senderFrame = event.senderFrame;

  if (!senderFrame || !isTrustedRendererUrl(senderFrame.url)) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

function registerIpcHandlers(
  projectService: ProjectService,
  piService: PiService,
  circuitService: CircuitService,
  assemblyService: AssemblyService,
  coachService: CoachService,
  embeddedCatalogService: EmbeddedCatalogService,
  firmwareService: FirmwareService,
  simulationModelService: SimulationModelService,
  attachmentService: AttachmentService,
  captureService: CaptureService,
  cameraEvidenceService: CameraEvidenceService,
  lanCameraRelayService: LanCameraRelayService,
  exportService: ExportService,
  archiveService: ArchiveService,
  integrityService: ProjectIntegrityService,
  remoteCameraService: RemoteCameraService,
  transcriptionService: TranscriptionService,
  preferencesService: PreferencesService,
  voiceAssetService: VoiceAssetService,
  ttsService: TtsService,
  wakeWordService: WakeWordService,
): void {
  ipcMain.handle("app:get-info", (event): AppInfo => {
    assertTrustedIpc(event);

    return {
      version: APP_VERSION,
      platform: process.platform,
    };
  });

  ipcMain.handle("preferences:get", (event) => {
    assertTrustedIpc(event);
    return preferencesService.get();
  });

  ipcMain.handle("preferences:update", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ preferences: AppPreferencesSchema }).parse(input);
    return preferencesService.update(parsed.preferences);
  });

  ipcMain.handle("embedded:get-catalog", (event) => {
    assertTrustedIpc(event);
    return embeddedCatalogService.getSnapshot();
  });

  ipcMain.handle("firmware:read-esphome", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return firmwareService.readEspHome(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("firmware:read-arduino", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return firmwareService.readArduino(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("firmware:compile-arduino", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        targetId: EmbeddedTargetIdSchema,
        source: z
          .string()
          .min(1)
          .max(1024 * 1024),
      })
      .parse(input);
    return firmwareService.compileArduino(parsed);
  });

  ipcMain.handle("firmware:validate-esphome", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        yaml: z
          .string()
          .min(1)
          .max(1024 * 1024),
      })
      .parse(input);
    return firmwareService.validateEspHome(parsed);
  });

  ipcMain.handle("firmware:compile-esphome", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        yaml: z
          .string()
          .min(1)
          .max(1024 * 1024),
      })
      .parse(input);
    return firmwareService.compileEspHome(parsed);
  });

  ipcMain.handle("firmware:run-simulation", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        targetId: EmbeddedTargetIdSchema,
        firmwareKind: z.enum(["arduino", "esphome"]),
        engine: z.enum(["simavr", "qemu"]),
        virtualDurationMicros: z.int().min(1_000).max(5_000_000).optional(),
        circuit: FirmwareCircuitRequestSchema.optional(),
      })
      .parse(input);
    const simulationInput = {
      projectId: parsed.projectId,
      targetId: parsed.targetId,
      firmwareKind: parsed.firmwareKind,
      engine: parsed.engine,
      ...(parsed.virtualDurationMicros !== undefined
        ? { virtualDurationMicros: parsed.virtualDurationMicros }
        : {}),
      ...(parsed.circuit ? { circuit: parsed.circuit } : {}),
    };
    return firmwareService.runSimulation(simulationInput).then(async (firmwareResult) => {
      if (!parsed.circuit) return firmwareResult;
      if (!firmwareResult.trace) {
        return {
          ...firmwareResult,
          circuitBridge: {
            outcome: "blocked" as const,
            appliedStimuli: {},
            diagnostics: [
              firmwareResult.coverage.gpioOutputTrace === "unsupported"
                ? "This target engine does not expose firmware GPIO output state."
                : "No verified firmware GPIO trace was produced.",
            ],
          },
        };
      }
      const preparation = prepareFirmwareCircuitScenario(firmwareResult.trace, parsed.circuit);
      if (preparation.outcome === "blocked" || !preparation.scenario) {
        return {
          ...firmwareResult,
          circuitBridge: {
            outcome: "blocked" as const,
            appliedStimuli: preparation.appliedStimuli,
            diagnostics: preparation.diagnostics,
          },
        };
      }
      const scenario = await circuitService.runModelScenario(
        parsed.projectId,
        preparation.scenario,
      );
      return {
        ...firmwareResult,
        coverage: { ...firmwareResult.coverage, circuitAssertions: "evaluated" as const },
        circuitBridge: {
          outcome: scenario.outcome,
          appliedStimuli: preparation.appliedStimuli,
          diagnostics: preparation.diagnostics,
          scenario,
        },
      };
    });
  });

  ipcMain.handle("simulation-model:list", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return simulationModelService.list(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("circuit:run-model-scenario", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({ projectId: z.uuid(), scenario: CircuitModelScenarioSchema })
      .strict()
      .parse(input);
    return circuitService.runModelScenario(parsed.projectId, parsed.scenario);
  });

  ipcMain.handle("simulation-model:install", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        proposal: z.unknown(),
      })
      .parse(input);
    return simulationModelService.install(parsed.projectId, parsed.proposal);
  });

  ipcMain.handle("simulation-model:evaluate", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        modelId: z.string().min(1).max(100),
        event: DeclarativeSimulationEventSchema,
      })
      .strict()
      .parse(input);
    return simulationModelService.evaluate(parsed.projectId, parsed.modelId, parsed.event);
  });

  ipcMain.handle("app:open-external", async (event, rawUrl: unknown) => {
    assertTrustedIpc(event);
    await shell.openExternal(ExternalUrlSchema.parse(rawUrl));
  });

  ipcMain.handle("project:get-state", (event) => {
    assertTrustedIpc(event);
    return projectService.getState();
  });

  ipcMain.handle("project:choose-root", async (event) => {
    assertTrustedIpc(event);
    const currentState = await projectService.getState();
    const result = await dialog.showOpenDialog({
      title: "Choose circuit project folder",
      defaultPath: currentState.rootPath,
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths[0]) {
      return currentState;
    }

    piService.dispose();
    return projectService.setProjectRoot(result.filePaths[0]);
  });

  ipcMain.handle("project:import-archive", async (event) => {
    assertTrustedIpc(event);
    const currentState = await projectService.getState();
    const result = await dialog.showOpenDialog({
      title: "Import portable circuit project",
      defaultPath: currentState.rootPath,
      properties: ["openFile"],
      filters: [{ name: "Circuit project archive", extensions: ["gz", "tgz"] }],
    });
    const archivePath = result.filePaths[0];
    if (result.canceled || !archivePath) {
      return currentState;
    }

    const state = await archiveService.importProject(archivePath);
    const projectId = state.activeProjectId;
    if (projectId) {
      const projectDirectory = await projectService.getProjectDirectory(projectId);
      void piService.activateProject(projectId, projectDirectory);
    }
    return state;
  });

  ipcMain.handle("project:create", async (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ title: ProjectTitleSchema }).parse(input);
    const state = await projectService.createProject(parsed.title);
    const projectId = state.activeProjectId;
    if (projectId) {
      const projectDirectory = await projectService.getProjectDirectory(projectId);
      void piService.activateProject(projectId, projectDirectory);
    }
    return state;
  });

  ipcMain.handle("project:activate", async (event, projectId: unknown) => {
    assertTrustedIpc(event);
    const parsedProjectId = ProjectIdSchema.parse(projectId);
    const state = await projectService.activateProject(parsedProjectId);
    const projectDirectory = await projectService.getProjectDirectory(parsedProjectId);
    void piService.activateProject(parsedProjectId, projectDirectory);
    return state;
  });

  ipcMain.handle("project:rename", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ projectId: z.uuid(), title: ProjectTitleSchema }).parse(input);
    return projectService.renameProject(parsed.projectId, parsed.title);
  });

  ipcMain.handle("project:verify-integrity", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return integrityService.verify(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("agent:get-snapshot", (event) => {
    assertTrustedIpc(event);
    return piService.getSnapshot();
  });

  ipcMain.handle("agent:send-message", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = SendAgentMessageSchema.parse(input);
    return piService.sendMessage(
      parsed.projectId,
      parsed.text,
      parsed.attachmentIds ?? [],
      parsed.captureIds ?? [],
    );
  });

  ipcMain.handle("agent:abort", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return piService.abort(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("agent:set-model", (event, input: unknown) => {
    assertTrustedIpc(event);
    return piService.setModel(SetAgentModelSchema.parse(input));
  });

  ipcMain.handle("agent:approve-circuit-proposal", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = ResolveCircuitProposalSchema.parse(input);
    return piService.approveCircuitProposal(parsed.projectId, parsed.proposalId);
  });

  ipcMain.handle("agent:reject-circuit-proposal", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = ResolveCircuitProposalSchema.parse(input);
    return piService.rejectCircuitProposal(parsed.projectId, parsed.proposalId);
  });

  ipcMain.handle("agent:approve-assembly-proposal", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = ResolveCircuitProposalSchema.parse(input);
    return piService.approveAssemblyProposal(parsed.projectId, parsed.proposalId);
  });

  ipcMain.handle("agent:reject-assembly-proposal", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = ResolveCircuitProposalSchema.parse(input);
    return piService.rejectAssemblyProposal(parsed.projectId, parsed.proposalId);
  });

  ipcMain.handle("agent:start-login", (event, input: unknown) => {
    assertTrustedIpc(event);
    return piService.startLogin(StartProviderLoginSchema.parse(input));
  });

  ipcMain.handle("agent:respond-auth-prompt", (event, input: unknown) => {
    assertTrustedIpc(event);
    piService.respondToAuthPrompt(RespondToAuthPromptSchema.parse(input));
  });

  ipcMain.handle("agent:cancel-login", (event, flowId: unknown) => {
    assertTrustedIpc(event);
    piService.cancelLogin(z.uuid().parse(flowId));
  });

  ipcMain.handle("agent:logout", (event, providerId: unknown) => {
    assertTrustedIpc(event);
    return piService.logout(ProviderIdSchema.parse(providerId));
  });

  ipcMain.handle("circuit:get", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return circuitService.getSnapshot(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("assembly:get", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return assemblyService.getSnapshot(ProjectIdSchema.parse(projectId));
  });
  ipcMain.handle("coach:get", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return coachService.getSnapshot(ProjectIdSchema.parse(projectId));
  });
  ipcMain.handle("coach:start-lesson", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({ projectId: z.uuid(), lessonId: z.string().trim().min(1).max(60) })
      .parse(input);
    return coachService.startLesson(parsed.projectId, parsed.lessonId);
  });
  ipcMain.handle("coach:advance", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ projectId: z.uuid() }).parse(input);
    return coachService.advance(parsed.projectId);
  });
  ipcMain.handle("coach:go-to-step", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({ projectId: z.uuid(), stepIndex: z.int().nonnegative().max(100) })
      .parse(input);
    return coachService.goToStep(parsed.projectId, parsed.stepIndex);
  });
  ipcMain.handle("coach:clear", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ projectId: z.uuid() }).parse(input);
    return coachService.clear(parsed.projectId);
  });
  ipcMain.handle("coach:get-firmware", (event, lessonId: unknown) => {
    assertTrustedIpc(event);
    const id = z.string().trim().min(1).max(60).parse(lessonId);
    return coachService.getLessonFirmwareSummary(id);
  });
  ipcMain.handle("coach:apply-firmware", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        projectId: z.uuid(),
        lessonId: z.string().trim().min(1).max(60).optional(),
      })
      .parse(input);
    return coachService.applyLessonFirmware(parsed.projectId, parsed.lessonId);
  });

  ipcMain.handle("attachment:list", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return attachmentService.list(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("attachment:choose", async (event, projectId: unknown) => {
    assertTrustedIpc(event);
    const parsedProjectId = ProjectIdSchema.parse(projectId);
    const result = await dialog.showOpenDialog({
      title: "Attach circuit evidence",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Supported evidence",
          extensions: ["pdf", "txt", "md", "markdown", "png", "jpg", "jpeg"],
        },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return attachmentService.list(parsedProjectId);
    }
    await attachmentService.importFiles(parsedProjectId, result.filePaths);
    return attachmentService.list(parsedProjectId);
  });

  ipcMain.handle("attachment:page-image", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        attachmentId: z.uuid(),
        projectId: z.uuid(),
        pageNumber: z.int().positive().max(100),
      })
      .parse(input);
    return attachmentService.getPageImage(parsed.projectId, parsed.attachmentId, parsed.pageNumber);
  });

  ipcMain.handle("attachment:reindex", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = AttachmentMutationSchema.parse(input);
    return attachmentService.reindex(parsed.projectId, parsed.attachmentId);
  });

  ipcMain.handle("attachment:trash", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = AttachmentMutationSchema.parse(input);
    return attachmentService.trash(parsed.projectId, parsed.attachmentId);
  });

  ipcMain.handle("attachment:list-trashed", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return attachmentService.listTrashed(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("attachment:restore", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = RestoreAttachmentSchema.parse(input);
    return attachmentService.restore(parsed.projectId, parsed.trashId);
  });

  ipcMain.handle("media:authorize-camera", (event) => {
    assertTrustedIpc(event);
    mediaAuthorizations.set(event.sender.id, { kind: "video", expiresAt: Date.now() + 15_000 });
  });

  ipcMain.handle("media:remote-camera-frame", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z.object({ url: z.string().trim().min(1).max(500) }).parse(input);
    return remoteCameraService.fetchFrame(parsed);
  });

  ipcMain.handle("media:update-camera-preview", (event, input: unknown) => {
    assertTrustedIpc(event);
    cameraEvidenceService.update(SaveCameraCaptureSchema.parse(input));
  });

  ipcMain.handle("media:clear-camera-preview", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    cameraEvidenceService.clear(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("media:get-camera-preview", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return cameraEvidenceService.getLatest(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("media:start-lan-camera-relay", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({ projectId: z.uuid(), circuitRevision: z.int().nonnegative() })
      .parse(input);
    return lanCameraRelayService.start(parsed);
  });

  ipcMain.handle("media:get-lan-camera-relay-status", (event) => {
    assertTrustedIpc(event);
    return lanCameraRelayService.getStatus();
  });

  ipcMain.handle("media:update-lan-camera-relay-context", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({ projectId: z.uuid(), circuitRevision: z.int().nonnegative() })
      .parse(input);
    lanCameraRelayService.setProjectContext(parsed);
  });

  ipcMain.handle("media:stop-lan-camera-relay", (event) => {
    assertTrustedIpc(event);
    return lanCameraRelayService.stop();
  });

  ipcMain.handle("media:authorize-microphone", (event) => {
    assertTrustedIpc(event);
    mediaAuthorizations.set(event.sender.id, { kind: "audio", expiresAt: Date.now() + 15_000 });
  });

  ipcMain.handle("voice:transcribe", (event, input: unknown) => {
    assertTrustedIpc(event);
    return transcriptionService.transcribe(TranscribeAudioSchema.parse(input));
  });

  ipcMain.handle("voice:cancel-transcription", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    transcriptionService.cancel(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("voice:asset-status", (event) => {
    assertTrustedIpc(event);
    return voiceAssetService.getStatus();
  });

  ipcMain.handle("voice:ensure-assets", async (event) => {
    assertTrustedIpc(event);
    await voiceAssetService.ensureAssets();
    return voiceAssetService.getStatus();
  });

  ipcMain.handle("voice:speak", (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        text: z.string().trim().min(1).max(500),
        exaggeration: z.number().finite().min(0).max(1).optional(),
      })
      .parse(input);
    return ttsService.speak({
      text: parsed.text,
      ...(parsed.exaggeration !== undefined ? { exaggeration: parsed.exaggeration } : {}),
    });
  });

  ipcMain.handle("voice:cancel-speech", (event) => {
    assertTrustedIpc(event);
    ttsService.cancel();
  });

  ipcMain.handle("wake:start", async (event) => {
    assertTrustedIpc(event);
    await wakeWordService.start();
  });

  ipcMain.handle("wake:stop", (event) => {
    assertTrustedIpc(event);
    wakeWordService.stop();
  });

  ipcMain.handle("wake:push-audio", async (event, input: unknown) => {
    assertTrustedIpc(event);
    const parsed = z
      .object({
        pcm16: z.union([
          z.instanceof(Int16Array),
          z.array(z.number().int().min(-32_768).max(32_767)).max(64_000),
        ]),
      })
      .parse(input);
    const samples =
      parsed.pcm16 instanceof Int16Array ? parsed.pcm16 : Int16Array.from(parsed.pcm16);
    await wakeWordService.pushPcm16(samples);
  });

  ipcMain.handle("capture:save", (event, input: unknown) => {
    assertTrustedIpc(event);
    return captureService.save(SaveCameraCaptureSchema.parse(input));
  });

  ipcMain.handle("capture:list", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return captureService.list(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("export:circuit", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return exportService.exportCircuit(ProjectIdSchema.parse(projectId));
  });

  ipcMain.handle("export:project-archive", (event, projectId: unknown) => {
    assertTrustedIpc(event);
    return archiveService.exportProject(ProjectIdSchema.parse(projectId));
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#15171c",
    title: "Circuit Design Harness",
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });

  window.once("ready-to-show", () => window.show());

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
  }

  return window;
}

let activePiService: PiService | undefined;
let activeTranscriptionService: TranscriptionService | undefined;
let activeTtsService: TtsService | undefined;
let activeVoiceAssetService: VoiceAssetService | undefined;
let activeWakeWordService: WakeWordService | undefined;
let activeLanCameraRelayService: LanCameraRelayService | undefined;

async function startApplication(): Promise<void> {
  await enforcePersistentLogBudget([app.getPath("logs")]);

  if (!process.env.ELECTRON_RENDERER_URL) {
    registerProductionProtocol();
  }

  registerSecurityHandlers();
  const configuredProjectRoot = process.env.CIRCUIT_HARNESS_PROJECT_ROOT?.trim();
  const projectService = new ProjectService(
    path.join(app.getPath("userData"), "settings.json"),
    path.join(app.getPath("documents"), "Circuit Design Harness"),
    configuredProjectRoot ? path.resolve(configuredProjectRoot) : undefined,
  );
  const projectState = await projectService.initialize();
  const preferencesService = new PreferencesService(
    path.join(app.getPath("userData"), "preferences.json"),
  );
  await preferencesService.initialize();
  createMainWindow();
  const broadcast = (channel: string, event: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, event);
      }
    }
  };
  const circuitService = new CircuitService(projectService, (event) => {
    broadcast("circuit:event", event);
  });
  const assemblyService = new AssemblyService(projectService, circuitService, (event) => {
    broadcast("assembly:event", event);
  });
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const localSimulatorService = new LocalSimulatorService(
    app.isPackaged,
    process.resourcesPath,
    repositoryRoot,
  );
  const resolveLocalExecutable = (name: string) => localSimulatorService.resolveExecutable(name);
  const embeddedCatalogService = new EmbeddedCatalogService(resolveLocalExecutable);
  const firmwareService = new FirmwareService(projectService, undefined, resolveLocalExecutable);
  const attachmentService = new AttachmentService(projectService);
  const simulationModelService = new SimulationModelService(projectService, attachmentService);
  const captureService = new CaptureService(projectService);
  const cameraEvidenceService = new CameraEvidenceService(captureService);
  const lanCameraRelayService = new LanCameraRelayService(cameraEvidenceService);
  activeLanCameraRelayService = lanCameraRelayService;
  const coachService = new CoachService(projectService, firmwareService);
  const exportService = new ExportService(projectService, circuitService);
  const archiveService = new ArchiveService(projectService);
  const integrityService = new ProjectIntegrityService(projectService);
  const remoteCameraService = new RemoteCameraService();
  const piService = new PiService(
    (event) => {
      broadcast("agent:event", event);
    },
    circuitService,
    assemblyService,
    embeddedCatalogService,
    firmwareService,
    simulationModelService,
    attachmentService,
    captureService,
    cameraEvidenceService,
    () => preferencesService.get(),
    coachService,
  );
  activePiService = piService;
  const voiceSourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "voice-sources.json")
    : path.join(repositoryRoot, "voice", "sources.json");
  const voiceSources = await loadVoiceSources(voiceSourcesPath);
  const voiceAssetService = new VoiceAssetService({
    assetsRoot: path.join(app.getPath("userData"), "voice-assets"),
    sources: voiceSources,
    resolveWhisperExecutable: () => localSimulatorService.resolveVoiceAsset("bin/whisper-cli"),
    resolvePackagedWhisperModel: () =>
      localSimulatorService.resolveVoiceAsset("models/ggml-small-q5_1.bin"),
    resolvePackagedWakewordModel: async () => {
      const candidate = app.isPackaged
        ? path.join(process.resourcesPath, "wakeword", "hey_eve.onnx")
        : path.join(repositoryRoot, "voice", "wakeword", "hey_eve.onnx");
      try {
        await access(candidate);
        return candidate;
      } catch {
        return undefined;
      }
    },
    onStatus: (status) => {
      broadcast("voice:asset-status", status);
    },
  });
  activeVoiceAssetService = voiceAssetService;
  const chatterboxSidecarPath = app.isPackaged
    ? path.join(process.resourcesPath, "scripts", "chatterbox-speak.py")
    : path.join(repositoryRoot, "scripts", "chatterbox-speak.py");
  const ttsService = new TtsService(
    () => voiceAssetService.resolveChatterboxModel(),
    chatterboxSidecarPath,
    "python3",
    undefined,
    voiceSources.tts?.id ?? "chatterbox-nano-v1",
  );
  activeTtsService = ttsService;
  const wakewordSidecarPath = app.isPackaged
    ? path.join(process.resourcesPath, "scripts", "wakeword-detect.py")
    : path.join(repositoryRoot, "scripts", "wakeword-detect.py");
  const wakeWordService = new WakeWordService(
    () => voiceAssetService.resolveWakeWordModel(),
    wakewordSidecarPath,
    "python3",
    (event) => {
      if (event.type === "detection") {
        broadcast("wake:detection", {
          name: event.name,
          confidence: event.confidence,
        });
      }
    },
  );
  activeWakeWordService = wakeWordService;
  const transcriptionService = new TranscriptionService(
    async () => voiceAssetService.resolveWhisperRuntime(),
    (projectId) => piService.isProjectActive(projectId),
  );
  activeTranscriptionService = transcriptionService;
  registerIpcHandlers(
    projectService,
    piService,
    circuitService,
    assemblyService,
    coachService,
    embeddedCatalogService,
    firmwareService,
    simulationModelService,
    attachmentService,
    captureService,
    cameraEvidenceService,
    lanCameraRelayService,
    exportService,
    archiveService,
    integrityService,
    remoteCameraService,
    transcriptionService,
    preferencesService,
    voiceAssetService,
    ttsService,
    wakeWordService,
  );
  // First-start (and subsequent) model download — models are not installer-packaged.
  void voiceAssetService.ensureAssets().catch(() => undefined);

  if (projectState.activeProjectId) {
    const projectDirectory = await projectService.getProjectDirectory(projectState.activeProjectId);
    void piService.activateProject(projectState.activeProjectId, projectDirectory);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}

void app
  .whenReady()
  .then(startApplication)
  .catch((reason: unknown) => {
    dialog.showErrorBox("Circuit Design Harness could not start", toErrorMessage(reason));
    app.quit();
  });

app.on("before-quit", () => {
  activeTranscriptionService?.dispose();
  activeTtsService?.dispose();
  activeWakeWordService?.dispose();
  activeVoiceAssetService?.dispose();
  activePiService?.dispose();
  void activeLanCameraRelayService?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unexpected startup error occurred.";
}
