import type {
  AgentEvent,
  AgentSnapshot,
  ResolveCircuitProposalInput,
  RespondToAuthPromptInput,
  SendAgentMessageInput,
  SetAgentModelInput,
  StartProviderLoginInput,
} from "./agent-contract";
import type { AssemblyEvent, AssemblySnapshot } from "./assembly-contract";
import type {
  AttachmentMutationInput,
  AttachmentPageImage,
  GetAttachmentPageImageInput,
  ProjectAttachment,
  ProjectTrashedAttachment,
  RestoreAttachmentInput,
} from "./attachment-contract";
import type {
  CameraPreviewFrame,
  LanCameraRelayStatus,
  ProjectCapture,
  RemoteCameraFrame,
  RemoteCameraFrameInput,
  SaveCameraCaptureInput,
  StartLanCameraRelayInput,
  UpdateCameraPreviewFrameInput,
} from "./capture-contract";
import type { CircuitEvent, CircuitSnapshot } from "./circuit-contract";
import type {
  RunCircuitModelScenarioInput,
  RunCircuitModelScenarioResult,
} from "./circuit-simulation-contract";
import type { EmbeddedCatalogSnapshot } from "./embedded-contract";
import type { CircuitExportResult, ProjectArchiveResult } from "./export-contract";
import type {
  CompileArduinoInput,
  CompileArduinoResult,
  CompileEspHomeInput,
  CompileEspHomeResult,
  EspHomeValidationResult,
  FirmwareSimulationResult,
  ReadArduinoSketchResult,
  ReadEspHomeResult,
  RunFirmwareSimulationInput,
  ValidateEspHomeInput,
} from "./firmware-contract";
import type { ProjectIntegrityReport } from "./integrity-contract";
import type { AppPreferencesSnapshot, UpdateAppPreferencesInput } from "./preferences-contract";
import type { CreateProjectInput, ProjectState, RenameProjectInput } from "./project-contract";
import type {
  EvaluateSimulationModelInput,
  EvaluateSimulationModelResult,
  InstallSimulationModelInput,
  SimulationModelSnapshot,
} from "./simulation-model-contract";
import type { TranscribeAudioInput, TranscriptionResult } from "./voice-contract";

export const APP_VERSION = "0.1.0";

export type AppPlatform =
  | "aix"
  | "android"
  | "cygwin"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "netbsd"
  | "openbsd"
  | "sunos"
  | "win32";

export interface AppInfo {
  readonly version: string;
  readonly platform: AppPlatform;
}

export interface CircuitHarnessApi {
  getAppInfo(): Promise<AppInfo>;
  getAppPreferences(): Promise<AppPreferencesSnapshot>;
  updateAppPreferences(input: UpdateAppPreferencesInput): Promise<AppPreferencesSnapshot>;
  getEmbeddedCatalog(): Promise<EmbeddedCatalogSnapshot>;
  readArduinoSketch(projectId: string): Promise<ReadArduinoSketchResult>;
  compileArduinoSketch(input: CompileArduinoInput): Promise<CompileArduinoResult>;
  readEspHomeConfig(projectId: string): Promise<ReadEspHomeResult>;
  validateEspHomeConfig(input: ValidateEspHomeInput): Promise<EspHomeValidationResult>;
  compileEspHomeConfig(input: CompileEspHomeInput): Promise<CompileEspHomeResult>;
  runFirmwareSimulation(input: RunFirmwareSimulationInput): Promise<FirmwareSimulationResult>;
  getSimulationModels(projectId: string): Promise<SimulationModelSnapshot>;
  installSimulationModel(input: InstallSimulationModelInput): Promise<SimulationModelSnapshot>;
  evaluateSimulationModel(
    input: EvaluateSimulationModelInput,
  ): Promise<EvaluateSimulationModelResult>;
  getProjectState(): Promise<ProjectState>;
  chooseProjectRoot(): Promise<ProjectState>;
  importProjectArchive(): Promise<ProjectState>;
  createProject(input: CreateProjectInput): Promise<ProjectState>;
  activateProject(projectId: string): Promise<ProjectState>;
  renameProject(input: RenameProjectInput): Promise<ProjectState>;
  verifyProjectIntegrity(projectId: string): Promise<ProjectIntegrityReport>;
  getAssembly(projectId: string): Promise<AssemblySnapshot>;
  getAgentSnapshot(): Promise<AgentSnapshot>;
  sendAgentMessage(input: SendAgentMessageInput): Promise<void>;
  abortAgent(projectId: string): Promise<void>;
  setAgentModel(input: SetAgentModelInput): Promise<AgentSnapshot>;
  approveCircuitProposal(input: ResolveCircuitProposalInput): Promise<CircuitSnapshot>;
  rejectCircuitProposal(input: ResolveCircuitProposalInput): Promise<void>;
  approveAssemblyProposal(input: ResolveCircuitProposalInput): Promise<AssemblySnapshot>;
  rejectAssemblyProposal(input: ResolveCircuitProposalInput): Promise<void>;
  startProviderLogin(input: StartProviderLoginInput): Promise<string>;
  respondToAuthPrompt(input: RespondToAuthPromptInput): Promise<void>;
  cancelProviderLogin(flowId: string): Promise<void>;
  logoutProvider(providerId: string): Promise<AgentSnapshot>;
  getCircuit(projectId: string): Promise<CircuitSnapshot>;
  runCircuitModelScenario(
    input: RunCircuitModelScenarioInput,
  ): Promise<RunCircuitModelScenarioResult>;
  getAttachments(projectId: string): Promise<readonly ProjectAttachment[]>;
  chooseAttachments(projectId: string): Promise<readonly ProjectAttachment[]>;
  getAttachmentPageImage(input: GetAttachmentPageImageInput): Promise<AttachmentPageImage>;
  reindexAttachment(input: AttachmentMutationInput): Promise<readonly ProjectAttachment[]>;
  trashAttachment(input: AttachmentMutationInput): Promise<readonly ProjectAttachment[]>;
  getTrashedAttachments(projectId: string): Promise<readonly ProjectTrashedAttachment[]>;
  restoreAttachment(input: RestoreAttachmentInput): Promise<readonly ProjectAttachment[]>;
  authorizeCamera(): Promise<void>;
  fetchRemoteCameraFrame(input: RemoteCameraFrameInput): Promise<RemoteCameraFrame>;
  updateCameraPreviewFrame(input: UpdateCameraPreviewFrameInput): Promise<void>;
  clearCameraPreviewFrame(projectId: string): Promise<void>;
  getCameraPreviewFrame(projectId: string): Promise<CameraPreviewFrame | undefined>;
  startLanCameraRelay(input: StartLanCameraRelayInput): Promise<LanCameraRelayStatus>;
  getLanCameraRelayStatus(): Promise<LanCameraRelayStatus>;
  updateLanCameraRelayContext(input: StartLanCameraRelayInput): Promise<void>;
  stopLanCameraRelay(): Promise<void>;
  authorizeMicrophone(): Promise<void>;
  transcribeAudio(input: TranscribeAudioInput): Promise<TranscriptionResult>;
  cancelTranscription(projectId: string): Promise<void>;
  saveCameraCapture(input: SaveCameraCaptureInput): Promise<ProjectCapture>;
  getCaptures(projectId: string): Promise<readonly ProjectCapture[]>;
  exportCircuit(projectId: string): Promise<CircuitExportResult>;
  exportProjectArchive(projectId: string): Promise<ProjectArchiveResult>;
  openExternalUrl(url: string): Promise<void>;
  onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  onCircuitEvent(listener: (event: CircuitEvent) => void): () => void;
  onAssemblyEvent(listener: (event: AssemblyEvent) => void): () => void;
}
