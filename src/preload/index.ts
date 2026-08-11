import type { CircuitHarnessApi } from "@shared/app-contract";
import { contextBridge, ipcRenderer } from "electron";

const api: CircuitHarnessApi = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  getAppPreferences: () => ipcRenderer.invoke("preferences:get"),
  updateAppPreferences: (input) => ipcRenderer.invoke("preferences:update", input),
  getEmbeddedCatalog: () => ipcRenderer.invoke("embedded:get-catalog"),
  readArduinoSketch: (projectId) => ipcRenderer.invoke("firmware:read-arduino", projectId),
  compileArduinoSketch: (input) => ipcRenderer.invoke("firmware:compile-arduino", input),
  readEspHomeConfig: (projectId) => ipcRenderer.invoke("firmware:read-esphome", projectId),
  validateEspHomeConfig: (input) => ipcRenderer.invoke("firmware:validate-esphome", input),
  compileEspHomeConfig: (input) => ipcRenderer.invoke("firmware:compile-esphome", input),
  runFirmwareSimulation: (input) => ipcRenderer.invoke("firmware:run-simulation", input),
  getSimulationModels: (projectId) => ipcRenderer.invoke("simulation-model:list", projectId),
  installSimulationModel: (input) => ipcRenderer.invoke("simulation-model:install", input),
  evaluateSimulationModel: (input) => ipcRenderer.invoke("simulation-model:evaluate", input),
  getProjectState: () => ipcRenderer.invoke("project:get-state"),
  chooseProjectRoot: () => ipcRenderer.invoke("project:choose-root"),
  importProjectArchive: () => ipcRenderer.invoke("project:import-archive"),
  createProject: (input) => ipcRenderer.invoke("project:create", input),
  activateProject: (projectId) => ipcRenderer.invoke("project:activate", projectId),
  renameProject: (input) => ipcRenderer.invoke("project:rename", input),
  verifyProjectIntegrity: (projectId) => ipcRenderer.invoke("project:verify-integrity", projectId),
  getAssembly: (projectId) => ipcRenderer.invoke("assembly:get", projectId),
  getCoach: (projectId) => ipcRenderer.invoke("coach:get", projectId),
  startCoachLesson: (input) => ipcRenderer.invoke("coach:start-lesson", input),
  advanceCoachLesson: (input) => ipcRenderer.invoke("coach:advance", input),
  goToCoachStep: (input) => ipcRenderer.invoke("coach:go-to-step", input),
  clearCoachLesson: (input) => ipcRenderer.invoke("coach:clear", input),
  getCoachLessonFirmware: (lessonId) => ipcRenderer.invoke("coach:get-firmware", lessonId),
  applyCoachLessonFirmware: (input) => ipcRenderer.invoke("coach:apply-firmware", input),
  getAgentSnapshot: () => ipcRenderer.invoke("agent:get-snapshot"),
  sendAgentMessage: (input) => ipcRenderer.invoke("agent:send-message", input),
  abortAgent: (projectId) => ipcRenderer.invoke("agent:abort", projectId),
  setAgentModel: (input) => ipcRenderer.invoke("agent:set-model", input),
  approveCircuitProposal: (input) => ipcRenderer.invoke("agent:approve-circuit-proposal", input),
  rejectCircuitProposal: (input) => ipcRenderer.invoke("agent:reject-circuit-proposal", input),
  approveAssemblyProposal: (input) => ipcRenderer.invoke("agent:approve-assembly-proposal", input),
  rejectAssemblyProposal: (input) => ipcRenderer.invoke("agent:reject-assembly-proposal", input),
  startProviderLogin: (input) => ipcRenderer.invoke("agent:start-login", input),
  respondToAuthPrompt: (input) => ipcRenderer.invoke("agent:respond-auth-prompt", input),
  cancelProviderLogin: (flowId) => ipcRenderer.invoke("agent:cancel-login", flowId),
  logoutProvider: (providerId) => ipcRenderer.invoke("agent:logout", providerId),
  getCircuit: (projectId) => ipcRenderer.invoke("circuit:get", projectId),
  runCircuitModelScenario: (input) => ipcRenderer.invoke("circuit:run-model-scenario", input),
  getAttachments: (projectId) => ipcRenderer.invoke("attachment:list", projectId),
  chooseAttachments: (projectId) => ipcRenderer.invoke("attachment:choose", projectId),
  getAttachmentPageImage: (input) => ipcRenderer.invoke("attachment:page-image", input),
  reindexAttachment: (input) => ipcRenderer.invoke("attachment:reindex", input),
  trashAttachment: (input) => ipcRenderer.invoke("attachment:trash", input),
  getTrashedAttachments: (projectId) => ipcRenderer.invoke("attachment:list-trashed", projectId),
  restoreAttachment: (input) => ipcRenderer.invoke("attachment:restore", input),
  authorizeCamera: () => ipcRenderer.invoke("media:authorize-camera"),
  fetchRemoteCameraFrame: (input) => ipcRenderer.invoke("media:remote-camera-frame", input),
  updateCameraPreviewFrame: (input) => ipcRenderer.invoke("media:update-camera-preview", input),
  clearCameraPreviewFrame: (projectId) =>
    ipcRenderer.invoke("media:clear-camera-preview", projectId),
  getCameraPreviewFrame: (projectId) => ipcRenderer.invoke("media:get-camera-preview", projectId),
  startLanCameraRelay: (input) => ipcRenderer.invoke("media:start-lan-camera-relay", input),
  getLanCameraRelayStatus: () => ipcRenderer.invoke("media:get-lan-camera-relay-status"),
  updateLanCameraRelayContext: (input) =>
    ipcRenderer.invoke("media:update-lan-camera-relay-context", input),
  stopLanCameraRelay: () => ipcRenderer.invoke("media:stop-lan-camera-relay"),
  authorizeMicrophone: () => ipcRenderer.invoke("media:authorize-microphone"),
  transcribeAudio: (input) => ipcRenderer.invoke("voice:transcribe", input),
  cancelTranscription: (projectId) => ipcRenderer.invoke("voice:cancel-transcription", projectId),
  getVoiceAssetStatus: () => ipcRenderer.invoke("voice:asset-status"),
  ensureVoiceAssets: () => ipcRenderer.invoke("voice:ensure-assets"),
  speakText: (input) => ipcRenderer.invoke("voice:speak", input),
  cancelSpeech: () => ipcRenderer.invoke("voice:cancel-speech"),
  onVoiceAssetStatus: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on("voice:asset-status", handler);
    return () => ipcRenderer.removeListener("voice:asset-status", handler);
  },
  startWakeWord: () => ipcRenderer.invoke("wake:start"),
  stopWakeWord: () => ipcRenderer.invoke("wake:stop"),
  pushWakeWordAudio: (input) => ipcRenderer.invoke("wake:push-audio", input),
  onWakeWordDetection: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on("wake:detection", handler);
    return () => ipcRenderer.removeListener("wake:detection", handler);
  },
  saveCameraCapture: (input) => ipcRenderer.invoke("capture:save", input),
  getCaptures: (projectId) => ipcRenderer.invoke("capture:list", projectId),
  exportCircuit: (projectId) => ipcRenderer.invoke("export:circuit", projectId),
  exportProjectArchive: (projectId) => ipcRenderer.invoke("export:project-archive", projectId),
  openExternalUrl: (url) => ipcRenderer.invoke("app:open-external", url),
  onAgentEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on("agent:event", handler);
    return () => ipcRenderer.removeListener("agent:event", handler);
  },
  onCircuitEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on("circuit:event", handler);
    return () => ipcRenderer.removeListener("circuit:event", handler);
  },
  onAssemblyEvent: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof listener>[0],
    ) => {
      listener(payload);
    };
    ipcRenderer.on("assembly:event", handler);
    return () => ipcRenderer.removeListener("assembly:event", handler);
  },
};

contextBridge.exposeInMainWorld("circuitHarness", api);
