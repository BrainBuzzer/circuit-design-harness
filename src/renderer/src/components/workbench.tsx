import type { AssemblyProposal } from "@domain/assembly";
import type { CircuitOperation, CircuitProposal } from "@domain/circuit";
import type { AppPreferences } from "@domain/preferences";
import { prepareSpokenReply } from "@domain/speech-summary";
import type { AgentEvent, AgentSnapshot } from "@shared/agent-contract";
import type { AssemblySnapshot } from "@shared/assembly-contract";
import type { ProjectAttachment, ProjectTrashedAttachment } from "@shared/attachment-contract";
import type { LanCameraRelayStatus, ProjectCapture } from "@shared/capture-contract";
import type { CircuitSnapshot } from "@shared/circuit-contract";
import type { CircuitExportResult, ProjectArchiveResult } from "@shared/export-contract";
import type { ProjectSummary } from "@shared/project-contract";
import type { VoiceAssetStatus } from "@shared/voice-contract";
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircuitBoardIcon,
  EyeIcon,
  FileUpIcon,
  HistoryIcon,
  MicIcon,
  PlayIcon,
  RefreshCwIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  Trash2Icon,
  Volume2Icon,
  VolumeXIcon,
  WifiIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/chat-types";
import { BreadboardEditor } from "@/components/breadboard-editor";
import { CircuitEditor } from "@/components/circuit-editor";
import { LabCoachPanel } from "@/components/lab-coach-panel";
import { ProviderSettingsDialog } from "@/components/provider-settings-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEveWakeWord } from "@/hooks/use-eve-wake-word";
import { encodedAudioBlobToWav } from "@/lib/audio";

type AuthFlowEvent = Extract<
  AgentEvent,
  { type: "auth-prompt" | "auth-notification" | "auth-complete" | "auth-error" }
>;

interface WorkbenchProps {
  readonly activeProject: ProjectSummary | undefined;
  readonly agentSnapshot: AgentSnapshot | undefined;
  readonly authEvent: AuthFlowEvent | undefined;
  readonly attachments: readonly ProjectAttachment[];
  readonly busy: boolean;
  readonly assemblySnapshot: AssemblySnapshot | undefined;
  readonly circuitSnapshot: CircuitSnapshot | undefined;
  readonly captures: readonly ProjectCapture[];
  readonly error: string | undefined;
  readonly messages: readonly ChatMessage[];
  readonly preferences: AppPreferences | undefined;
  readonly onSendMessage: (
    text: string,
    attachmentIds: readonly string[],
    captureIds: readonly string[],
  ) => Promise<void>;
  readonly onChooseAttachments: (projectId: string) => Promise<readonly ProjectAttachment[]>;
  readonly onReindexAttachment: (projectId: string, attachmentId: string) => Promise<void>;
  readonly onTrashAttachment: (projectId: string, attachmentId: string) => Promise<void>;
  readonly onRestoreAttachment: (projectId: string, trashId: string) => Promise<void>;
  readonly onSetModel: (projectId: string, providerId: string, modelId: string) => Promise<void>;
  readonly onAbort: () => void;
  readonly onApproveCircuitProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onRejectCircuitProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onApproveAssemblyProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onRejectAssemblyProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onCaptureSaved: (capture: ProjectCapture) => void;
  readonly onExportCircuit: () => Promise<CircuitExportResult | undefined>;
  readonly onExportProjectArchive: () => Promise<ProjectArchiveResult | undefined>;
  readonly onUpdatePreferences: (preferences: AppPreferences) => Promise<void>;
}

export function Workbench({
  activeProject,
  agentSnapshot,
  authEvent,
  attachments,
  busy,
  assemblySnapshot,
  circuitSnapshot,
  captures,
  error,
  messages,
  preferences,
  onSendMessage,
  onChooseAttachments,
  onReindexAttachment,
  onTrashAttachment,
  onRestoreAttachment,
  onSetModel,
  onAbort,
  onApproveCircuitProposal,
  onRejectCircuitProposal,
  onApproveAssemblyProposal,
  onRejectAssemblyProposal,
  onCaptureSaved,
  onExportCircuit,
  onExportProjectArchive,
  onUpdatePreferences,
}: WorkbenchProps): React.JSX.Element {
  const [designView, setDesignView] = useState<"lab" | "schematic" | "breadboard">("lab");
  const [composerSeed, setComposerSeed] = useState<string>();
  if (!activeProject) {
    return (
      <Empty className="min-h-0 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircuitBoardIcon />
          </EmptyMedia>
          <EmptyTitle>No circuit project selected</EmptyTitle>
          <EmptyDescription>
            Create a project from the sidebar. Its chat, design, attachments, captures, and history
            will stay together in your chosen folder.
          </EmptyDescription>
        </EmptyHeader>
        {error && (
          <EmptyContent>
            <p className="text-destructive">{error}</p>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <ResizablePanelGroup
        id="primary-workspace"
        orientation="horizontal"
        defaultLayout={{ conversation: 40, laboratory: 60 }}
      >
        <ResizablePanel id="conversation" minSize="34%">
          <ConversationPane
            key={activeProject.id}
            project={activeProject}
            agentSnapshot={agentSnapshot}
            authEvent={authEvent}
            attachments={attachments}
            captures={captures}
            busy={busy}
            error={error}
            messages={messages}
            preferences={preferences}
            composerSeed={composerSeed}
            onComposerSeedConsumed={() => setComposerSeed(undefined)}
            onAbort={onAbort}
            onApproveCircuitProposal={onApproveCircuitProposal}
            onApproveAssemblyProposal={onApproveAssemblyProposal}
            onChooseAttachments={onChooseAttachments}
            onReindexAttachment={onReindexAttachment}
            onTrashAttachment={onTrashAttachment}
            onRestoreAttachment={onRestoreAttachment}
            onRejectCircuitProposal={onRejectCircuitProposal}
            onRejectAssemblyProposal={onRejectAssemblyProposal}
            onSendMessage={onSendMessage}
            onSetModel={onSetModel}
            onUpdatePreferences={onUpdatePreferences}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="laboratory" minSize="38%">
          <ResizablePanelGroup
            id="laboratory-workspace"
            orientation="vertical"
            defaultLayout={{ camera: 42, circuit: 58 }}
          >
            <ResizablePanel id="camera" minSize="18%">
              <CameraPane
                circuitRevision={activeProject.circuitRevision}
                key={activeProject.id}
                onCaptureSaved={onCaptureSaved}
                projectId={activeProject.id}
              />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="circuit" minSize="22%">
              <div className="flex size-full min-h-0 flex-col">
                <fieldset className="flex shrink-0 flex-wrap gap-1 border-b border-line bg-surface/80 px-3 py-1.5 backdrop-blur-sm">
                  <legend className="sr-only">Design view</legend>
                  <div className="inline-flex rounded-full bg-field p-0.5 shadow-btn">
                    <Button
                      aria-pressed={designView === "lab"}
                      onClick={() => setDesignView("lab")}
                      size="xs"
                      variant={designView === "lab" ? "secondary" : "ghost"}
                      className={
                        designView === "lab"
                          ? "rounded-full bg-surface shadow-btn"
                          : "rounded-full text-ink-3 hover:text-ink"
                      }
                    >
                      Lab coach
                    </Button>
                    <Button
                      aria-pressed={designView === "schematic"}
                      onClick={() => setDesignView("schematic")}
                      size="xs"
                      variant={designView === "schematic" ? "secondary" : "ghost"}
                      className={
                        designView === "schematic"
                          ? "rounded-full bg-surface shadow-btn"
                          : "rounded-full text-ink-3 hover:text-ink"
                      }
                    >
                      Schematic
                    </Button>
                    <Button
                      aria-pressed={designView === "breadboard"}
                      onClick={() => setDesignView("breadboard")}
                      size="xs"
                      variant={designView === "breadboard" ? "secondary" : "ghost"}
                      className={
                        designView === "breadboard"
                          ? "rounded-full bg-surface shadow-btn"
                          : "rounded-full text-ink-3 hover:text-ink"
                      }
                    >
                      Breadboard
                    </Button>
                  </div>
                  <span className="ml-auto self-center text-[11.5px] text-ink-3">
                    Lab coach is the beginner default · CAD is sandbox
                  </span>
                </fieldset>
                <div className="min-h-0 flex-1">
                  {designView === "lab" ? (
                    <LabCoachPanel
                      key={activeProject.id}
                      projectId={activeProject.id}
                      onAskCoach={(prompt) => setComposerSeed(prompt)}
                    />
                  ) : designView === "schematic" ? (
                    <CircuitEditor
                      onExport={onExportCircuit}
                      onExportArchive={onExportProjectArchive}
                      projectId={activeProject.id}
                      snapshot={circuitSnapshot}
                    />
                  ) : (
                    <BreadboardEditor assembly={assemblySnapshot} circuit={circuitSnapshot} />
                  )}
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function ConversationPane({
  project,
  agentSnapshot,
  authEvent,
  attachments,
  captures,
  busy,
  error,
  messages,
  preferences,
  composerSeed,
  onComposerSeedConsumed,
  onSendMessage,
  onChooseAttachments,
  onReindexAttachment,
  onTrashAttachment,
  onRestoreAttachment,
  onSetModel,
  onUpdatePreferences,
  onAbort,
  onApproveCircuitProposal,
  onRejectCircuitProposal,
  onApproveAssemblyProposal,
  onRejectAssemblyProposal,
}: {
  readonly project: ProjectSummary;
  readonly agentSnapshot: AgentSnapshot | undefined;
  readonly authEvent: AuthFlowEvent | undefined;
  readonly attachments: readonly ProjectAttachment[];
  readonly captures: readonly ProjectCapture[];
  readonly busy: boolean;
  readonly error: string | undefined;
  readonly messages: readonly ChatMessage[];
  readonly preferences: AppPreferences | undefined;
  readonly composerSeed: string | undefined;
  readonly onComposerSeedConsumed: () => void;
  readonly onSendMessage: (
    text: string,
    attachmentIds: readonly string[],
    captureIds: readonly string[],
  ) => Promise<void>;
  readonly onChooseAttachments: (projectId: string) => Promise<readonly ProjectAttachment[]>;
  readonly onReindexAttachment: (projectId: string, attachmentId: string) => Promise<void>;
  readonly onTrashAttachment: (projectId: string, attachmentId: string) => Promise<void>;
  readonly onRestoreAttachment: (projectId: string, trashId: string) => Promise<void>;
  readonly onSetModel: (projectId: string, providerId: string, modelId: string) => Promise<void>;
  readonly onUpdatePreferences: (preferences: AppPreferences) => Promise<void>;
  readonly onAbort: () => void;
  readonly onApproveCircuitProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onRejectCircuitProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onApproveAssemblyProposal: (projectId: string, proposalId: string) => Promise<void>;
  readonly onRejectAssemblyProposal: (projectId: string, proposalId: string) => Promise<void>;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<readonly string[]>([]);
  const [selectedCaptureIds, setSelectedCaptureIds] = useState<readonly string[]>([]);
  const [viewerAttachment, setViewerAttachment] = useState<ProjectAttachment>();
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerUrl, setViewerUrl] = useState<string>();
  const [viewerError, setViewerError] = useState<string>();
  const [deleteAttachment, setDeleteAttachment] = useState<ProjectAttachment>();
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedAttachments, setTrashedAttachments] = useState<readonly ProjectTrashedAttachment[]>(
    [],
  );
  const [attachmentActionBusy, setAttachmentActionBusy] = useState(false);
  const [attachmentActionError, setAttachmentActionError] = useState<string>();
  const [speakReplies, setSpeakReplies] = useState(preferences?.spokenReplies ?? false);
  const [speaking, setSpeaking] = useState(false);
  const [speechSettingsOpen, setSpeechSettingsOpen] = useState(false);
  const [speechRate, setSpeechRate] = useState(preferences?.speechRate ?? 1);
  const [speechVolume, setSpeechVolume] = useState(preferences?.speechVolume ?? 1);
  const [voiceAssets, setVoiceAssets] = useState<VoiceAssetStatus>();
  const [speechStatus, setSpeechStatus] = useState<string>();
  const [voiceInputState, setVoiceInputState] = useState<
    "idle" | "requesting" | "recording" | "transcribing" | "error"
  >("idle");
  const [voiceStatus, setVoiceStatus] = useState<string>();
  const [voiceDevices, setVoiceDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [voiceDeviceId, setVoiceDeviceId] = useState<string>();
  const [voiceLevel, setVoiceLevel] = useState(0);
  const spokenMessageIdRef = useRef<string | undefined>(undefined);
  const speechAudioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const speechObjectUrlRef = useRef<string | undefined>(undefined);
  const voiceRecorderRef = useRef<MediaRecorder | undefined>(undefined);
  const voiceStreamRef = useRef<MediaStream | undefined>(undefined);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceStartedAtRef = useRef(0);
  const voiceTimeoutRef = useRef<number | undefined>(undefined);
  const voiceDisposedRef = useRef(false);
  const voiceRecordingFailedRef = useRef(false);
  const voiceAudioContextRef = useRef<AudioContext | undefined>(undefined);
  const voiceMeterFrameRef = useRef<number | undefined>(undefined);
  const configured = Boolean(agentSnapshot?.availableModels.length);
  const sessionReady =
    agentSnapshot?.activeProjectId === project.id && agentSnapshot.activity === "ready";
  const thinking = agentSnapshot?.activity === "thinking";
  const wakeWordEnabled = preferences?.wakeWordEnabled ?? false;

  useEffect(() => {
    if (!composerSeed) {
      return;
    }
    setDraft(composerSeed);
    onComposerSeedConsumed();
  }, [composerSeed, onComposerSeedConsumed]);

  const eve = useEveWakeWord({
    enabled: wakeWordEnabled,
    paused:
      !sessionReady ||
      thinking ||
      speaking ||
      voiceInputState === "requesting" ||
      voiceInputState === "recording" ||
      voiceInputState === "transcribing",
    projectId: project.id,
    onCommand: async (command) => {
      await onSendMessage(command, [], []);
    },
  });

  const stopSpeechPlayback = useCallback((): void => {
    void window.circuitHarness.cancelSpeech();
    if (speechAudioRef.current) {
      speechAudioRef.current.pause();
      speechAudioRef.current.src = "";
      speechAudioRef.current = undefined;
    }
    if (speechObjectUrlRef.current) {
      URL.revokeObjectURL(speechObjectUrlRef.current);
      speechObjectUrlRef.current = undefined;
    }
    setSpeaking(false);
  }, []);

  const speakText = useCallback(
    (text: string): void => {
      // Never pass raw assistant message.content to TTS — only the summary.
      const summary = prepareSpokenReply(text);
      if (!summary) return;
      stopSpeechPlayback();
      setSpeaking(true);
      setSpeechStatus("Synthesizing with local Chatterbox…");
      const prosody = toneProsody(preferences?.voiceTone ?? "warm");
      // Map tone to a bounded exaggeration hint; rate still shapes playback.
      const exaggeration =
        preferences?.voiceTone === "energetic"
          ? 0.7
          : preferences?.voiceTone === "calm"
            ? 0.35
            : 0.5;
      void window.circuitHarness
        .speakText({ text: summary, exaggeration })
        .then((result) => {
          if (voiceDisposedRef.current) return;
          const blob = new Blob([result.wavBytes.slice()], { type: "audio/wav" });
          const url = URL.createObjectURL(blob);
          speechObjectUrlRef.current = url;
          const audio = new Audio(url);
          audio.playbackRate = Math.max(0.5, Math.min(2, speechRate * prosody.rate));
          audio.volume = speechVolume;
          speechAudioRef.current = audio;
          audio.onended = () => {
            setSpeaking(false);
            setSpeechStatus(undefined);
            if (speechObjectUrlRef.current === url) {
              URL.revokeObjectURL(url);
              speechObjectUrlRef.current = undefined;
            }
          };
          audio.onerror = () => {
            setSpeaking(false);
            setSpeechStatus("Spoken reply playback failed.");
          };
          setSpeechStatus(`Speaking summary (${result.model})`);
          void audio.play().catch(() => {
            setSpeaking(false);
            setSpeechStatus("Spoken reply playback was blocked.");
          });
        })
        .catch((reason: unknown) => {
          setSpeaking(false);
          setSpeechStatus(reason instanceof Error ? reason.message : "Chatterbox speech failed.");
          void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
        });
    },
    [preferences?.voiceTone, speechRate, speechVolume, stopSpeechPlayback],
  );

  useEffect(() => {
    if (!preferences) return;
    setSpeakReplies(preferences.spokenReplies);
    setSpeechRate(preferences.speechRate);
    setSpeechVolume(preferences.speechVolume);
  }, [preferences]);

  useEffect(() => {
    void window.circuitHarness
      .getVoiceAssetStatus()
      .then(setVoiceAssets)
      .catch(() => undefined);
    void window.circuitHarness
      .ensureVoiceAssets()
      .then(setVoiceAssets)
      .catch(() => undefined);
    return window.circuitHarness.onVoiceAssetStatus(setVoiceAssets);
  }, []);

  useEffect(() => {
    if (
      !speakReplies ||
      thinking ||
      voiceInputState === "requesting" ||
      voiceInputState === "recording"
    ) {
      stopSpeechPlayback();
      return;
    }
    const message = [...messages]
      .reverse()
      .find((candidate) => candidate.role === "assistant" && candidate.content.trim());
    if (!message || spokenMessageIdRef.current === message.id) {
      return;
    }
    spokenMessageIdRef.current = message.id;
    // Speak a summary only — full chat text stays on screen unchanged.
    speakText(message.content);
  }, [messages, speakReplies, thinking, voiceInputState, speakText, stopSpeechPlayback]);

  useEffect(() => {
    voiceDisposedRef.current = false;
    return () => {
      stopSpeechPlayback();
      voiceDisposedRef.current = true;
      if (voiceTimeoutRef.current !== undefined) {
        window.clearTimeout(voiceTimeoutRef.current);
      }
      if (voiceRecorderRef.current?.state === "recording") {
        voiceRecorderRef.current.stop();
      }
      for (const track of voiceStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      if (voiceMeterFrameRef.current !== undefined) {
        window.cancelAnimationFrame(voiceMeterFrameRef.current);
      }
      void voiceAudioContextRef.current?.close();
      void window.circuitHarness.cancelTranscription(project.id);
    };
  }, [project.id, stopSpeechPlayback]);

  useEffect(() => {
    if (!viewerAttachment) {
      setViewerUrl(undefined);
      return;
    }
    let disposed = false;
    let objectUrl: string | undefined;
    setViewerUrl(undefined);
    setViewerError(undefined);
    void window.circuitHarness
      .getAttachmentPageImage({
        projectId: project.id,
        attachmentId: viewerAttachment.id,
        pageNumber: viewerPage,
      })
      .then((pageImage) => {
        if (!disposed) {
          const bytes = Uint8Array.from(pageImage.jpegBytes);
          objectUrl = URL.createObjectURL(new Blob([bytes.buffer], { type: pageImage.mimeType }));
          setViewerUrl(objectUrl);
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setViewerError(toErrorMessage(reason));
        }
      });
    return () => {
      disposed = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [project.id, viewerAttachment, viewerPage]);

  const submit = async (): Promise<void> => {
    const message = draft.trim();
    if (!message || !sessionReady || thinking) {
      return;
    }

    setDraft("");
    const attachmentIds = selectedAttachmentIds;
    const captureIds = selectedCaptureIds;
    setSelectedAttachmentIds([]);
    setSelectedCaptureIds([]);
    await onSendMessage(message, attachmentIds, captureIds);
  };

  const refreshTrash = async (): Promise<void> => {
    setAttachmentActionError(undefined);
    setTrashedAttachments(await window.circuitHarness.getTrashedAttachments(project.id));
  };

  const stopVoiceTracks = (): void => {
    for (const track of voiceStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    voiceStreamRef.current = undefined;
    if (voiceMeterFrameRef.current !== undefined) {
      window.cancelAnimationFrame(voiceMeterFrameRef.current);
      voiceMeterFrameRef.current = undefined;
    }
    void voiceAudioContextRef.current?.close();
    voiceAudioContextRef.current = undefined;
    setVoiceLevel(0);
  };

  const startVoiceMeter = (stream: MediaStream): void => {
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      voiceAudioContextRef.current = context;
      const update = (): void => {
        analyser.getByteTimeDomainData(samples);
        let squaredTotal = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          squaredTotal += normalized * normalized;
        }
        setVoiceLevel(Math.min(1, Math.sqrt(squaredTotal / samples.length) * 4));
        voiceMeterFrameRef.current = window.requestAnimationFrame(update);
      };
      update();
    } catch {
      setVoiceLevel(0);
    }
  };

  const stopVoiceRecording = (): void => {
    if (voiceTimeoutRef.current !== undefined) {
      window.clearTimeout(voiceTimeoutRef.current);
      voiceTimeoutRef.current = undefined;
    }
    if (voiceRecorderRef.current?.state === "recording") {
      voiceRecorderRef.current.stop();
    }
  };

  const startVoiceRecording = async (): Promise<void> => {
    if (voiceInputState === "recording") {
      stopVoiceRecording();
      return;
    }
    if (voiceInputState === "requesting" || voiceInputState === "transcribing") {
      return;
    }

    stopSpeechPlayback();
    setVoiceInputState("requesting");
    setVoiceStatus("Requesting microphone permission…");
    try {
      await window.circuitHarness.authorizeMicrophone();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(voiceDeviceId ? { deviceId: { exact: voiceDeviceId } } : {}),
        },
        video: false,
      });
      const selectedTrack = stream.getAudioTracks()[0];
      setVoiceDeviceId(selectedTrack?.getSettings().deviceId);
      setVoiceDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === "audioinput",
        ),
      );
      startVoiceMeter(stream);
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      voiceStartedAtRef.current = Date.now();
      voiceRecordingFailedRef.current = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        voiceRecordingFailedRef.current = true;
        stopVoiceTracks();
        setVoiceInputState("error");
        setVoiceStatus("Microphone recording failed. Try again.");
      };
      recorder.onstop = () => {
        stopVoiceTracks();
        if (voiceRecordingFailedRef.current) {
          return;
        }
        const durationMs = Math.min(
          60_000,
          Math.max(250, Math.round(Date.now() - voiceStartedAtRef.current)),
        );
        const blob = new Blob(voiceChunksRef.current, { type: "audio/webm" });
        voiceChunksRef.current = [];
        if (voiceDisposedRef.current) {
          return;
        }
        setVoiceInputState("transcribing");
        setVoiceStatus("Transcribing locally with Whisper small multilingual…");
        void encodedAudioBlobToWav(blob)
          .then((wavBytes) =>
            window.circuitHarness.transcribeAudio({ projectId: project.id, wavBytes, durationMs }),
          )
          .then((result) => {
            if (voiceDisposedRef.current) {
              return;
            }
            setDraft((current) =>
              current.trim() ? `${current.trim()} ${result.text}` : result.text,
            );
            setVoiceInputState("idle");
            setVoiceStatus("Transcript ready to review — it has not been sent.");
          })
          .catch((reason: unknown) => {
            if (voiceDisposedRef.current) {
              return;
            }
            setVoiceInputState("error");
            setVoiceStatus(toErrorMessage(reason));
          });
      };
      recorder.start(250);
      setVoiceInputState("recording");
      setVoiceStatus(
        `Listening on ${selectedTrack?.label || "microphone"} — click again to transcribe.`,
      );
      voiceTimeoutRef.current = window.setTimeout(stopVoiceRecording, 60_000);
    } catch (reason) {
      stopVoiceTracks();
      setVoiceInputState("error");
      setVoiceStatus(toErrorMessage(reason));
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        void startVoiceRecording();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  return (
    <section className="flex size-full min-h-0 flex-col bg-canvas" aria-label="Conversation">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <AgentStatusOrb thinking={thinking} speaking={speaking} ready={sessionReady} />
        <div className="min-w-32 flex-1">
          <h2 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
            Design assistant
          </h2>
          <p className="text-[12px] text-ink-2">
            {speaking
              ? "Speaking reply"
              : wakeWordEnabled && eve.state !== "off"
                ? eve.status
                : agentStatusLabel(agentSnapshot, project.id)}
          </p>
        </div>
        {configured && agentSnapshot && (
          <ModelSelect projectId={project.id} snapshot={agentSnapshot} onSetModel={onSetModel} />
        )}
        <Button
          aria-label={wakeWordEnabled ? "Disable Eve wake word" : "Enable Eve wake word"}
          aria-pressed={wakeWordEnabled}
          disabled={!preferences}
          onClick={() => {
            if (preferences) {
              void onUpdatePreferences({
                ...preferences,
                wakeWordEnabled: !wakeWordEnabled,
              });
            }
          }}
          size="sm"
          title={eve.status}
          variant={wakeWordEnabled ? "secondary" : "ghost"}
        >
          <MicIcon /> Eve
        </Button>
        <Button
          aria-label={speakReplies ? "Disable spoken replies" : "Enable spoken replies"}
          aria-pressed={speakReplies}
          onClick={() => {
            if (speakReplies) {
              stopSpeechPlayback();
              setSpeakReplies(false);
              if (preferences) {
                void onUpdatePreferences({ ...preferences, spokenReplies: false });
              }
            } else {
              spokenMessageIdRef.current = [...messages]
                .reverse()
                .find((message) => message.role === "assistant")?.id;
              setSpeakReplies(true);
              if (preferences) {
                void onUpdatePreferences({ ...preferences, spokenReplies: true });
              }
            }
          }}
          size="icon-sm"
          variant="ghost"
        >
          {speakReplies ? <Volume2Icon /> : <VolumeXIcon />}
        </Button>
        <Button
          aria-label="Spoken reply settings"
          onClick={() => setSpeechSettingsOpen(true)}
          size="icon-sm"
          variant="ghost"
        >
          <SlidersHorizontalIcon />
        </Button>
        <ProviderSettingsDialog authEvent={authEvent} snapshot={agentSnapshot} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-5">
          {messages.length === 0 && (
            <Card size="sm" className="animate-fade-up border-0 bg-surface">
              <CardHeader>
                <CardTitle>{configured ? "Pi is ready" : "Project ready"}</CardTitle>
                <CardDescription>
                  {configured
                    ? `Using ${agentSnapshot?.activeModel?.name ?? "a Pi-supported model"}. Describe the first circuit or attach a datasheet.`
                    : `${project.title} is ready, but Pi has no authenticated model. Configure any provider supported by Pi through its auth file, environment, or OAuth flow.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-[12.5px] text-ink-2">
                {agentSnapshot
                  ? `${agentSnapshot.providers.filter((provider) => provider.authenticated).length} authenticated provider(s), ${agentSnapshot.availableModels.length} available model(s).`
                  : "Discovering Pi providers and models…"}
              </CardContent>
            </Card>
          )}
          {messages.map((message, index) => {
            const isUser = message.role === "user";
            const isStreamingAssistant =
              !isUser && thinking && index === messages.length - 1 && !message.content;
            return (
              <div
                key={message.id}
                className={`animate-fade-up flex w-full ${isUser ? "justify-end" : "justify-start"}`}
                style={{ animationDelay: `${Math.min(index, 6) * 30}ms` }}
              >
                <div
                  className={
                    isUser
                      ? "max-w-[80%] rounded-[14px] bg-field px-3.5 py-2.5 shadow-btn"
                      : "max-w-[90%] rounded-[14px] bg-surface px-3.5 py-2.5 shadow-card"
                  }
                >
                  <p className="mb-1 text-[11.5px] font-medium text-ink-3">
                    {isUser ? "You" : "Pi"}
                  </p>
                  {isStreamingAssistant || (!isUser && !message.content && thinking) ? (
                    <ThinkingTrace />
                  ) : (
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                      {message.content || "Thinking…"}
                      {!isUser && thinking && index === messages.length - 1 && message.content ? (
                        <span className="stream-caret is-streaming" aria-hidden="true" />
                      ) : null}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {agentSnapshot?.pendingCircuitProposals
            .filter((proposal) => proposal.projectId === project.id)
            .map((proposal) => (
              <CircuitProposalCard
                key={proposal.id}
                proposal={proposal}
                onApprove={() => onApproveCircuitProposal(project.id, proposal.id)}
                onReject={() => onRejectCircuitProposal(project.id, proposal.id)}
              />
            ))}
          {agentSnapshot?.pendingAssemblyProposals
            .filter((proposal) => proposal.projectId === project.id)
            .map((proposal) => (
              <AssemblyProposalCard
                key={proposal.id}
                proposal={proposal}
                onApprove={() => onApproveAssemblyProposal(project.id, proposal.id)}
                onReject={() => onRejectAssemblyProposal(project.id, proposal.id)}
              />
            ))}
          {error && (
            <p className="rounded-[10px] bg-red-tint px-3 py-2 text-[13px] text-red" role="alert">
              {error}
            </p>
          )}
        </div>
      </ScrollArea>
      <div className="border-t border-line bg-surface/90 p-3 backdrop-blur-sm">
        {attachments.length > 0 && (
          <fieldset
            className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5"
            aria-label="Project attachments"
          >
            {attachments.map((attachment) => {
              const selected = selectedAttachmentIds.includes(attachment.id);
              return (
                <span className="inline-flex" key={attachment.id}>
                  <Button
                    aria-pressed={selected}
                    onClick={() =>
                      setSelectedAttachmentIds((current) =>
                        selected
                          ? current.filter((id) => id !== attachment.id)
                          : [...current, attachment.id],
                      )
                    }
                    size="xs"
                    variant={selected ? "secondary" : "ghost"}
                  >
                    <FileUpIcon />
                    {attachment.originalName}
                  </Button>
                  {attachment.pages.some((page) => page.imageRelativePath) && (
                    <Button
                      aria-label={`View ${attachment.originalName}`}
                      onClick={() => {
                        setViewerPage(1);
                        setViewerAttachment(attachment);
                      }}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <EyeIcon />
                    </Button>
                  )}
                  <Button
                    aria-label={`Re-index ${attachment.originalName}`}
                    disabled={attachmentActionBusy}
                    onClick={() => {
                      setAttachmentActionError(undefined);
                      setAttachmentActionBusy(true);
                      void onReindexAttachment(project.id, attachment.id)
                        .catch((reason: unknown) =>
                          setAttachmentActionError(toErrorMessage(reason)),
                        )
                        .finally(() => setAttachmentActionBusy(false));
                    }}
                    size="icon-xs"
                    title="Rebuild extracted text and rendered pages"
                    variant="ghost"
                  >
                    <RefreshCwIcon />
                  </Button>
                  <Button
                    aria-label={`Delete ${attachment.originalName}`}
                    disabled={attachmentActionBusy}
                    onClick={() => setDeleteAttachment(attachment)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Trash2Icon />
                  </Button>
                </span>
              );
            })}
          </fieldset>
        )}
        {captures.length > 0 && (
          <fieldset
            aria-label="Saved camera snapshots"
            className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-1.5"
          >
            {captures.map((capture, index) => {
              const selected = selectedCaptureIds.includes(capture.id);
              return (
                <Button
                  aria-label={`Camera snapshot ${index + 1} from revision ${capture.circuitRevision}`}
                  aria-pressed={selected}
                  key={capture.id}
                  onClick={() =>
                    setSelectedCaptureIds((current) =>
                      selected
                        ? current.filter((id) => id !== capture.id)
                        : [...current, capture.id],
                    )
                  }
                  size="xs"
                  variant={selected ? "secondary" : "ghost"}
                >
                  <CameraIcon />
                  Snapshot {index + 1} · rev {capture.circuitRevision}
                </Button>
              );
            })}
          </fieldset>
        )}
        <InputGroup className="mx-auto max-w-3xl">
          <InputGroupTextarea
            aria-label="Message the design assistant"
            disabled={busy || !sessionReady}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Describe the circuit, ask a question, or request a change…"
            rows={2}
            value={draft}
          />
          <InputGroupAddon align="block-end" className="justify-between">
            <div className="flex items-center gap-1">
              <InputGroupButton
                aria-label="Attach design files"
                disabled={busy}
                onClick={() => {
                  void onChooseAttachments(project.id).then((records) =>
                    setSelectedAttachmentIds(records.map((record) => record.id)),
                  );
                }}
              >
                <FileUpIcon />
              </InputGroupButton>
              <InputGroupButton
                aria-label="Deleted evidence"
                disabled={busy || attachmentActionBusy}
                onClick={() => {
                  setAttachmentActionBusy(true);
                  void refreshTrash()
                    .then(() => setTrashOpen(true))
                    .catch((reason: unknown) => setAttachmentActionError(toErrorMessage(reason)))
                    .finally(() => setAttachmentActionBusy(false));
                }}
                title="Restore deleted evidence"
              >
                <HistoryIcon />
              </InputGroupButton>
              {voiceDevices.length > 1 && voiceInputState !== "recording" && (
                <Select
                  value={voiceDeviceId ?? null}
                  onValueChange={(value) => setVoiceDeviceId(value ?? undefined)}
                >
                  <SelectTrigger aria-label="Microphone source" className="h-7 max-w-40" size="sm">
                    <SelectValue placeholder="Microphone">
                      {voiceDevices.find((device) => device.deviceId === voiceDeviceId)?.label ||
                        "Microphone"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {voiceDevices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${index + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <InputGroupButton
                aria-label={
                  voiceInputState === "recording" ? "Stop and transcribe" : "Start push to talk"
                }
                aria-pressed={voiceInputState === "recording"}
                disabled={
                  busy ||
                  !sessionReady ||
                  thinking ||
                  voiceInputState === "requesting" ||
                  voiceInputState === "transcribing"
                }
                onClick={() => void startVoiceRecording()}
                title="Push to talk (⌘/Ctrl+Shift+M)"
              >
                <MicIcon />
              </InputGroupButton>
            </div>
            {thinking ? (
              <InputGroupButton
                aria-label="Stop response"
                onClick={onAbort}
                size="icon-sm"
                variant="outline"
              >
                <span className="size-2.5 rounded-sm bg-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                aria-label="Send message"
                disabled={!sessionReady || !draft.trim()}
                onClick={() => void submit()}
                size="icon-sm"
                variant="default"
              >
                <SendIcon />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
        {voiceStatus && (
          <div className="mx-auto mt-1 flex max-w-3xl items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-muted-foreground" aria-live="polite">
              {voiceStatus}
            </p>
            {voiceInputState === "recording" && (
              <meter
                aria-label="Microphone input level"
                className="h-2 w-20 accent-primary"
                max={1}
                min={0}
                value={voiceLevel}
              />
            )}
          </div>
        )}
        {attachmentActionError && (
          <p className="mx-auto mt-1 max-w-3xl text-xs text-destructive" role="alert">
            {attachmentActionError}
          </p>
        )}
      </div>
      <Dialog
        open={Boolean(viewerAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            setViewerAttachment(undefined);
          }
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{viewerAttachment?.originalName}</DialogTitle>
            <DialogDescription>
              Rendered page {viewerPage} of {viewerAttachment?.pages.length ?? 0}. Extracted text is
              stored with the same page number.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-48 place-items-center overflow-auto rounded-md border bg-white p-2">
            {viewerError ? (
              <p className="text-sm text-destructive">{viewerError}</p>
            ) : viewerUrl ? (
              <img
                alt={`${viewerAttachment?.originalName ?? "Attachment"} page ${viewerPage}`}
                className="max-h-[65vh] max-w-full"
                src={viewerUrl}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Rendering page…</p>
            )}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {viewerAttachment?.pages[viewerPage - 1]?.extractionMethod === "ocr"
                ? `OCR confidence ${Math.round((viewerAttachment.pages[viewerPage - 1]?.ocrConfidence ?? 0) * 100)}%`
                : "Native PDF text"}
            </p>
            <div className="flex gap-2">
              <Button
                aria-label="Previous attachment page"
                disabled={viewerPage <= 1}
                onClick={() => setViewerPage((page) => page - 1)}
                size="icon-sm"
                variant="outline"
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                aria-label="Next attachment page"
                disabled={viewerPage >= (viewerAttachment?.pages.length ?? 0)}
                onClick={() => setViewerPage((page) => page + 1)}
                size="icon-sm"
                variant="outline"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteAttachment)}
        onOpenChange={(open) => {
          if (!open && !attachmentActionBusy) {
            setDeleteAttachment(undefined);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move evidence to project trash?</DialogTitle>
            <DialogDescription>
              {deleteAttachment?.originalName} and all derived text, OCR, and rendered pages will be
              removed from agent evidence. You can restore them from Deleted evidence.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={attachmentActionBusy}
              onClick={() => setDeleteAttachment(undefined)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={attachmentActionBusy || !deleteAttachment}
              onClick={() => {
                if (!deleteAttachment) {
                  return;
                }
                const attachmentId = deleteAttachment.id;
                setAttachmentActionError(undefined);
                setAttachmentActionBusy(true);
                void onTrashAttachment(project.id, attachmentId)
                  .then(() => {
                    setSelectedAttachmentIds((current) =>
                      current.filter((id) => id !== attachmentId),
                    );
                    setDeleteAttachment(undefined);
                  })
                  .catch((reason: unknown) => setAttachmentActionError(toErrorMessage(reason)))
                  .finally(() => setAttachmentActionBusy(false));
              }}
              variant="destructive"
            >
              Move to trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Deleted evidence</DialogTitle>
            <DialogDescription>
              Deleted originals and derived artifacts remain inside this project until a future
              explicit purge.
            </DialogDescription>
          </DialogHeader>
          {trashedAttachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Project trash is empty.</p>
          ) : (
            <ul className="space-y-2">
              {trashedAttachments.map((trashed) => (
                <li className="flex items-center gap-3 rounded-md border p-2" key={trashed.trashId}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{trashed.record.originalName}</p>
                    <p className="text-xs text-muted-foreground">
                      Deleted {new Date(trashed.deletedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    disabled={attachmentActionBusy}
                    onClick={() => {
                      setAttachmentActionError(undefined);
                      setAttachmentActionBusy(true);
                      void onRestoreAttachment(project.id, trashed.trashId)
                        .then(refreshTrash)
                        .catch((reason: unknown) =>
                          setAttachmentActionError(toErrorMessage(reason)),
                        )
                        .finally(() => setAttachmentActionBusy(false));
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={speechSettingsOpen} onOpenChange={setSpeechSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Spoken reply settings</DialogTitle>
            <DialogDescription>
              Replies use local Resemble Chatterbox TTS. Long technical messages are summarized
              before speech; full chat text stays on screen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-inset px-3 py-2 text-xs text-ink-2">
              <p>
                Whisper STT:{" "}
                {voiceAssets?.whisper.ready
                  ? "ready"
                  : voiceAssets?.whisper.downloading
                    ? "downloading…"
                    : voiceAssets?.whisper.error
                      ? `error — ${voiceAssets.whisper.error}`
                      : "not ready"}
              </p>
              <p>
                Chatterbox TTS:{" "}
                {voiceAssets?.chatterbox.ready
                  ? "ready"
                  : voiceAssets?.chatterbox.downloading
                    ? "downloading…"
                    : voiceAssets?.chatterbox.error
                      ? `error — ${voiceAssets.chatterbox.error}`
                      : "not ready"}
              </p>
              <p>
                LiveKit wake word:{" "}
                {voiceAssets?.wakeword.ready
                  ? "ready"
                  : voiceAssets?.wakeword.downloading
                    ? "downloading…"
                    : voiceAssets?.wakeword.error
                      ? `error — ${voiceAssets.wakeword.error}`
                      : "not ready"}
              </p>
              {speechStatus ? <p className="mt-1 text-ink-3">{speechStatus}</p> : null}
            </div>
            <label className="grid gap-1.5 text-sm" htmlFor="speech-rate">
              Rate · {speechRate.toFixed(1)}×
              <input
                id="speech-rate"
                max="2"
                min="0.5"
                onChange={(event) => {
                  const speechRate = Number(event.currentTarget.value);
                  setSpeechRate(speechRate);
                  if (preferences) {
                    void onUpdatePreferences({ ...preferences, speechRate });
                  }
                }}
                step="0.1"
                type="range"
                value={speechRate}
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="speech-volume">
              Volume · {Math.round(speechVolume * 100)}%
              <input
                id="speech-volume"
                max="1"
                min="0"
                onChange={(event) => {
                  const speechVolume = Number(event.currentTarget.value);
                  setSpeechVolume(speechVolume);
                  if (preferences) {
                    void onUpdatePreferences({ ...preferences, speechVolume });
                  }
                }}
                step="0.05"
                type="range"
                value={speechVolume}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Tone: {preferences?.voiceTone ?? "warm"}. Chatterbox-Nano weights download on first
            start; synthesis stays on-device and never uses browser speechSynthesis.
          </p>
          <DialogFooter>
            <Button
              disabled={!messages.some((message) => message.role === "assistant")}
              onClick={() => {
                const message = [...messages]
                  .reverse()
                  .find((candidate) => candidate.role === "assistant" && candidate.content.trim());
                if (message) {
                  speakText(message.content);
                }
              }}
              variant="outline"
            >
              <PlayIcon />
              Replay latest reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CircuitProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  readonly proposal: CircuitProposal;
  readonly onApprove: () => Promise<void>;
  readonly onReject: () => Promise<void>;
}): React.JSX.Element {
  const [resolving, setResolving] = useState(false);

  const resolve = async (action: () => Promise<void>): Promise<void> => {
    setResolving(true);
    try {
      await action();
    } finally {
      setResolving(false);
    }
  };

  return (
    <Card
      className="animate-fade-up border-0 bg-surface shadow-raised ring-1 ring-primary/20"
      size="sm"
    >
      <CardHeader className="border-b border-line pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Pi proposes {proposal.operations.length} circuit change(s)</CardTitle>
          <Badge variant="info">Needs approval</Badge>
        </div>
        <CardDescription>{proposal.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <ul className="space-y-1.5 text-[12.5px] text-ink-2">
          {(proposal.semanticDiff.length > 0
            ? proposal.semanticDiff
            : proposal.operations.map(describeCircuitOperation)
          ).map((description) => (
            <li
              key={`${proposal.id}:${description}`}
              className="flex gap-2 rounded-[8px] bg-inset px-2.5 py-1.5"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <span>{description}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-ink-3">
          Based on revision {proposal.baseRevision}. Nothing changes until you approve.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={resolving} onClick={() => void resolve(onApprove)} size="sm">
            <CheckIcon />
            Approve
          </Button>
          <Button
            disabled={resolving}
            onClick={() => void resolve(onReject)}
            size="sm"
            variant="outline"
          >
            <XIcon />
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssemblyProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  readonly proposal: AssemblyProposal;
  readonly onApprove: () => Promise<void>;
  readonly onReject: () => Promise<void>;
}): React.JSX.Element {
  const [resolving, setResolving] = useState(false);
  const resolve = async (action: () => Promise<void>): Promise<void> => {
    setResolving(true);
    try {
      await action();
    } finally {
      setResolving(false);
    }
  };
  return (
    <Card
      className="animate-fade-up border-0 bg-surface shadow-raised ring-1 ring-[color-mix(in_srgb,var(--green)_35%,transparent)]"
      size="sm"
    >
      <CardHeader className="border-b border-line pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Pi proposes {proposal.operations.length} breadboard change(s)</CardTitle>
          <Badge variant="success">Build map</Badge>
        </div>
        <CardDescription>{proposal.rationale}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-3">
        <ul className="space-y-1.5 text-[12.5px] text-ink-2">
          {proposal.semanticDiff.map((description) => (
            <li
              key={`${proposal.id}:${description}`}
              className="flex gap-2 rounded-[8px] bg-inset px-2.5 py-1.5"
            >
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-green" aria-hidden />
              <span>{description}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-ink-3">
          Based on assembly revision {proposal.baseRevision} and circuit revision{" "}
          {proposal.circuitRevision}. Nothing changes until you approve.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={resolving} onClick={() => void resolve(onApprove)} size="sm">
            <CheckIcon /> Approve build map
          </Button>
          <Button
            disabled={resolving}
            onClick={() => void resolve(onReject)}
            size="sm"
            variant="outline"
          >
            <XIcon /> Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AgentStatusOrb({
  thinking,
  speaking,
  ready,
}: {
  readonly thinking: boolean;
  readonly speaking: boolean;
  readonly ready: boolean;
}): React.JSX.Element {
  const active = thinking || speaking;
  return (
    <div
      className="relative grid size-9 place-items-center rounded-full bg-accent-tint text-accent-ink shadow-btn"
      aria-hidden
    >
      {active ? (
        <svg
          aria-hidden="true"
          className="status-ring absolute inset-0 size-full"
          focusable="false"
          viewBox="0 0 36 36"
        >
          <circle cx="18" cy="18" r="16" fill="none" stroke="var(--line)" strokeWidth="2" />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="28 72"
          />
        </svg>
      ) : null}
      <SparklesIcon className="relative size-4" />
      <span
        className={`absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-surface ${
          thinking ? "bg-orange" : speaking ? "bg-primary" : ready ? "bg-green" : "bg-ink-3"
        }`}
      />
    </div>
  );
}

function ThinkingTrace(): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 py-0.5" aria-live="polite">
      <span className="inline-flex items-center gap-1">
        <span className="thinking-dot size-1.5 rounded-full bg-ink-3" />
        <span className="thinking-dot size-1.5 rounded-full bg-ink-3" />
        <span className="thinking-dot size-1.5 rounded-full bg-ink-3" />
      </span>
      <span className="text-[13px] text-ink-2">Thinking…</span>
    </div>
  );
}

function describeCircuitOperation(operation: CircuitOperation): string {
  switch (operation.type) {
    case "add_component":
      return `Add ${operation.reference} (${operation.kind}${operation.value ? `, ${operation.value}` : ""}).`;
    case "remove_component":
      return `Remove component ${shortId(operation.componentId)}.`;
    case "move_component":
      return `Move component ${shortId(operation.componentId)} to (${operation.position.x}, ${operation.position.y}).`;
    case "set_component_value":
      return `Set component ${shortId(operation.componentId)} to ${operation.value}.`;
    case "connect_terminals":
      return `Connect ${operation.terminals.length} terminals${operation.name ? ` as ${operation.name}` : ""}.`;
    case "disconnect_terminal":
      return `Disconnect one terminal on ${shortId(operation.terminal.componentId)}.`;
    case "rename_net":
      return `Rename net ${shortId(operation.netId)} to ${operation.name}.`;
    case "set_schematic_metadata":
      return "Update publication title-block metadata.";
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function ModelSelect({
  projectId,
  snapshot,
  onSetModel,
}: {
  readonly projectId: string;
  readonly snapshot: AgentSnapshot;
  readonly onSetModel: (projectId: string, providerId: string, modelId: string) => Promise<void>;
}): React.JSX.Element {
  const activeValue = snapshot.activeModel
    ? modelSelectValue(snapshot.activeModel.provider, snapshot.activeModel.id)
    : null;

  return (
    <Select
      value={activeValue}
      onValueChange={(value) => {
        if (!value) {
          return;
        }

        const model = snapshot.availableModels.find(
          (candidate) => modelSelectValue(candidate.provider, candidate.id) === value,
        );
        if (model) {
          void onSetModel(projectId, model.provider, model.id);
        }
      }}
    >
      <SelectTrigger aria-label="Active Pi model" className="hidden max-w-64 sm:flex" size="sm">
        <SelectValue placeholder="Choose model">{snapshot.activeModel?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="max-w-96">
        {snapshot.availableModels.map((model) => (
          <SelectItem
            key={modelSelectValue(model.provider, model.id)}
            value={modelSelectValue(model.provider, model.id)}
          >
            <span className="truncate">
              {model.provider} · {model.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function modelSelectValue(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

function agentStatusLabel(snapshot: AgentSnapshot | undefined, projectId: string): string {
  if (!snapshot) {
    return "Discovering Pi providers…";
  }

  if (snapshot.activity === "thinking") {
    return "Pi is thinking";
  }

  if (snapshot.activity === "error") {
    return snapshot.error ?? "Pi needs attention";
  }

  if (!snapshot.availableModels.length) {
    return "No authenticated Pi provider";
  }

  if (snapshot.activeProjectId !== projectId) {
    return "Starting this project’s Pi session…";
  }

  return `${snapshot.activeModel?.name ?? "Pi"} ready`;
}

function CameraPane({
  projectId,
  circuitRevision,
  onCaptureSaved,
}: {
  readonly projectId: string;
  readonly circuitRevision: number;
  readonly onCaptureSaved: (capture: ProjectCapture) => void;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteImageRef = useRef<HTMLImageElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const remoteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const remoteGenerationRef = useRef(0);
  const remoteBytesRef = useRef<Uint8Array | undefined>(undefined);
  const remotePreviewUrlRef = useRef<string | undefined>(undefined);
  const remoteLabelRef = useRef<string | undefined>(undefined);
  const frozenBytesRef = useRef<Uint8Array | undefined>(undefined);
  const frozenSizeRef = useRef<{ readonly width: number; readonly height: number } | undefined>(
    undefined,
  );
  const frozenUrlRef = useRef<string | undefined>(undefined);
  const frozenRevisionRef = useRef<number | undefined>(undefined);
  const frozenDeviceLabelRef = useRef<string | undefined>(undefined);
  const frozenSourceRef = useRef<"local_camera" | "remote_camera" | undefined>(undefined);
  const [state, setState] = useState<"idle" | "requesting" | "live" | "frozen">("idle");
  const [activeSource, setActiveSource] = useState<"local" | "remote">();
  const [frozenUrl, setFrozenUrl] = useState<string>();
  const [remotePreviewUrl, setRemotePreviewUrl] = useState<string>();
  const [remoteDialogOpen, setRemoteDialogOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [status, setStatus] = useState("Local preview off");
  const [error, setError] = useState<string>();
  const [cameraDevices, setCameraDevices] = useState<readonly MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string>();
  const [lanRelayStatus, setLanRelayStatus] = useState<LanCameraRelayStatus>();

  const stopStream = (): void => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = undefined;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    void window.circuitHarness.clearCameraPreviewFrame(projectId);
  };

  const stopRemotePreview = (): void => {
    remoteGenerationRef.current += 1;
    if (remoteTimerRef.current) {
      clearTimeout(remoteTimerRef.current);
      remoteTimerRef.current = undefined;
    }
    if (remotePreviewUrlRef.current) {
      URL.revokeObjectURL(remotePreviewUrlRef.current);
      remotePreviewUrlRef.current = undefined;
    }
    remoteBytesRef.current = undefined;
    remoteLabelRef.current = undefined;
    setRemotePreviewUrl(undefined);
    void window.circuitHarness.clearCameraPreviewFrame(projectId);
  };

  const clearFrozen = (): void => {
    if (frozenUrlRef.current) {
      URL.revokeObjectURL(frozenUrlRef.current);
    }
    frozenUrlRef.current = undefined;
    setFrozenUrl(undefined);
    frozenBytesRef.current = undefined;
    frozenSizeRef.current = undefined;
    frozenRevisionRef.current = undefined;
    frozenDeviceLabelRef.current = undefined;
    frozenSourceRef.current = undefined;
  };

  const setRemoteFrame = useCallback((jpegBytes: Uint8Array, endpointLabel: string): void => {
    if (remotePreviewUrlRef.current) {
      URL.revokeObjectURL(remotePreviewUrlRef.current);
    }
    const previewUrl = URL.createObjectURL(
      new Blob([Uint8Array.from(jpegBytes).buffer], { type: "image/jpeg" }),
    );
    remotePreviewUrlRef.current = previewUrl;
    remoteBytesRef.current = jpegBytes;
    remoteLabelRef.current = `Remote camera ${endpointLabel}`;
    setRemotePreviewUrl(previewUrl);
  }, []);

  useEffect(() => {
    return () => {
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      remoteGenerationRef.current += 1;
      if (remoteTimerRef.current) {
        clearTimeout(remoteTimerRef.current);
      }
      if (remotePreviewUrlRef.current) {
        URL.revokeObjectURL(remotePreviewUrlRef.current);
      }
      if (frozenUrlRef.current) {
        URL.revokeObjectURL(frozenUrlRef.current);
      }
      void window.circuitHarness.clearCameraPreviewFrame(projectId);
      void window.circuitHarness.stopLanCameraRelay();
    };
  }, [projectId]);

  useEffect(() => {
    if (!lanRelayStatus?.running) return;
    void window.circuitHarness.updateLanCameraRelayContext({ projectId, circuitRevision });
  }, [circuitRevision, lanRelayStatus?.running, projectId]);

  useEffect(() => {
    if (!lanRelayStatus?.running) return;
    let disposed = false;
    const refresh = async (): Promise<void> => {
      const nextStatus = await window.circuitHarness.getLanCameraRelayStatus();
      if (disposed) return;
      setLanRelayStatus(nextStatus);
      if (nextStatus.connected && state !== "frozen") {
        const frame = await window.circuitHarness.getCameraPreviewFrame(projectId);
        if (frame && !disposed) {
          setRemoteFrame(frame.jpegBytes, frame.deviceLabel);
          setActiveSource("remote");
          setState("live");
          setStatus("Paired LAN camera live — available to Eve on request");
          setRemoteDialogOpen(false);
        }
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 750);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [lanRelayStatus?.running, projectId, setRemoteFrame, state]);

  useEffect(() => {
    if (state !== "live" || activeSource !== "local") {
      return;
    }
    let publishing = false;
    const publish = async (): Promise<void> => {
      const video = videoRef.current;
      if (publishing || !video || video.videoWidth < 1 || video.videoHeight < 1) return;
      publishing = true;
      try {
        const scale = Math.min(1, 1280 / video.videoWidth);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.82),
        );
        if (blob) {
          await window.circuitHarness.updateCameraPreviewFrame({
            projectId,
            jpegBytes: new Uint8Array(await blob.arrayBuffer()),
            width: canvas.width,
            height: canvas.height,
            expectedCircuitRevision: circuitRevision,
            deviceLabel: streamRef.current?.getVideoTracks()[0]?.label || "Local camera",
            source: "local_camera",
          });
        }
      } finally {
        publishing = false;
      }
    };
    void publish();
    const timer = window.setInterval(() => void publish(), 1_000);
    return () => window.clearInterval(timer);
  }, [activeSource, circuitRevision, projectId, state]);

  const startCamera = async (deviceId?: string): Promise<void> => {
    stopRemotePreview();
    setState("requesting");
    setStatus("Requesting camera permission…");
    setError(undefined);
    try {
      await window.circuitHarness.authorizeCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const selectedDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      setActiveDeviceId(selectedDeviceId);
      setCameraDevices(
        (await navigator.mediaDevices.enumerateDevices()).filter(
          (device) => device.kind === "videoinput",
        ),
      );
      setState("live");
      setActiveSource("local");
      setStatus("Local preview on — not uploading");
    } catch (reason) {
      stopStream();
      setActiveDeviceId(undefined);
      setActiveSource(undefined);
      setState("idle");
      setStatus("Local preview off");
      setError(toErrorMessage(reason));
    }
  };

  const startRemoteCamera = async (): Promise<void> => {
    const endpoint = remoteUrl.trim();
    if (!endpoint) {
      return;
    }
    stopStream();
    stopRemotePreview();
    clearFrozen();
    setActiveDeviceId(undefined);
    setCameraDevices([]);
    setState("requesting");
    setStatus("Connecting to private-LAN camera…");
    setError(undefined);
    const generation = remoteGenerationRef.current;

    const poll = async (firstFrame: boolean): Promise<void> => {
      try {
        const frame = await window.circuitHarness.fetchRemoteCameraFrame({ url: endpoint });
        if (generation !== remoteGenerationRef.current) {
          return;
        }
        setRemoteFrame(frame.jpegBytes, frame.endpointLabel);
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(frame.jpegBytes).buffer], { type: "image/jpeg" }),
        );
        await window.circuitHarness.updateCameraPreviewFrame({
          projectId,
          jpegBytes: frame.jpegBytes,
          width: bitmap.width,
          height: bitmap.height,
          expectedCircuitRevision: circuitRevision,
          deviceLabel: `Remote camera ${frame.endpointLabel}`,
          source: "remote_camera",
        });
        bitmap.close();
        setActiveSource("remote");
        setState("live");
        setStatus("Private-LAN preview on — not sent to Pi");
        setRemoteDialogOpen(false);
      } catch (reason) {
        if (generation !== remoteGenerationRef.current) {
          return;
        }
        setError(toErrorMessage(reason));
        if (firstFrame) {
          setState("idle");
          setActiveSource(undefined);
          setStatus("Remote preview off");
          return;
        }
        setStatus("Remote frame unavailable — retrying…");
      }
      if (generation === remoteGenerationRef.current) {
        remoteTimerRef.current = setTimeout(() => void poll(false), 1_000);
      }
    };

    await poll(true);
  };

  const startLanRelay = async (): Promise<void> => {
    stopStream();
    stopRemotePreview();
    clearFrozen();
    setActiveSource(undefined);
    setState("requesting");
    setStatus("Creating an encrypted LAN camera relay…");
    setError(undefined);
    try {
      const relay = await window.circuitHarness.startLanCameraRelay({
        projectId,
        circuitRevision,
      });
      setLanRelayStatus(relay);
      setState("idle");
      setStatus("Scan the phone pairing code");
    } catch (reason) {
      setState("idle");
      setStatus("LAN camera relay off");
      setError(toErrorMessage(reason));
    }
  };

  const freezeFrame = async (): Promise<void> => {
    if (activeSource === "remote") {
      const image = remoteImageRef.current;
      const jpegBytes = remoteBytesRef.current;
      const deviceLabel = remoteLabelRef.current;
      if (
        !image ||
        image.naturalWidth < 1 ||
        image.naturalHeight < 1 ||
        !jpegBytes ||
        !deviceLabel
      ) {
        setError("The remote camera has not produced a complete frame yet.");
        return;
      }
      clearFrozen();
      frozenBytesRef.current = new Uint8Array(jpegBytes);
      frozenSizeRef.current = { width: image.naturalWidth, height: image.naturalHeight };
      frozenRevisionRef.current = circuitRevision;
      frozenDeviceLabelRef.current = deviceLabel;
      frozenSourceRef.current = "remote_camera";
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(jpegBytes).buffer], { type: "image/jpeg" }),
      );
      frozenUrlRef.current = url;
      setFrozenUrl(url);
      stopRemotePreview();
      setState("frozen");
      setStatus("Remote snapshot frozen — review before saving");
      return;
    }
    const video = videoRef.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setError("The camera has not produced a frame yet.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) {
      setError("The camera frame could not be encoded.");
      return;
    }
    clearFrozen();
    frozenBytesRef.current = new Uint8Array(await blob.arrayBuffer());
    frozenSizeRef.current = { width: canvas.width, height: canvas.height };
    frozenRevisionRef.current = circuitRevision;
    frozenDeviceLabelRef.current = streamRef.current?.getVideoTracks()[0]?.label || "Local camera";
    frozenSourceRef.current = "local_camera";
    const url = URL.createObjectURL(blob);
    frozenUrlRef.current = url;
    setFrozenUrl(url);
    setState("frozen");
    setStatus("Snapshot frozen — review before saving");
  };

  const saveFrame = async (): Promise<void> => {
    const jpegBytes = frozenBytesRef.current;
    const size = frozenSizeRef.current;
    const expectedCircuitRevision = frozenRevisionRef.current;
    const deviceLabel = frozenDeviceLabelRef.current;
    const source = frozenSourceRef.current;
    if (!jpegBytes || !size || expectedCircuitRevision === undefined || !deviceLabel || !source) {
      return;
    }
    setError(undefined);
    try {
      const capture = await window.circuitHarness.saveCameraCapture({
        projectId,
        jpegBytes,
        ...size,
        expectedCircuitRevision,
        deviceLabel,
        source,
      });
      onCaptureSaved(capture);
      setStatus(`Saved locally with circuit revision ${capture.circuitRevision}`);
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  };

  return (
    <section className="flex size-full min-h-0 flex-col bg-muted/20" aria-label="Camera input">
      <div className="flex items-center gap-2 border-b border-line bg-surface/80 px-4 py-2 backdrop-blur-sm">
        <CameraIcon className="size-4 text-ink-3" />
        <h2 className="text-sm font-medium">Build camera</h2>
        {activeSource === "local" && cameraDevices.length > 1 && (
          <Select
            value={activeDeviceId ?? null}
            onValueChange={(value) => {
              if (value && value !== activeDeviceId) {
                stopStream();
                setActiveDeviceId(undefined);
                setCameraDevices([]);
                void startCamera(value);
              }
            }}
          >
            <SelectTrigger aria-label="Camera source" className="h-7 max-w-48" size="sm">
              <SelectValue placeholder="Camera source">
                {cameraDevices.find((device) => device.deviceId === activeDeviceId)?.label ||
                  "Camera"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {cameraDevices.map((device, index) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{status}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          autoPlay
          className={
            state === "live" && activeSource === "local" ? "size-full object-contain" : "hidden"
          }
          muted
          playsInline
          ref={videoRef}
        />
        {remotePreviewUrl && state === "live" && activeSource === "remote" && (
          <img
            alt="Private-LAN remote camera preview"
            className="size-full object-contain"
            ref={remoteImageRef}
            src={remotePreviewUrl}
          />
        )}
        {frozenUrl && state === "frozen" && (
          <img
            alt="Frozen camera snapshot awaiting save"
            className="size-full object-contain"
            src={frozenUrl}
          />
        )}
        {(state === "idle" || state === "requesting") && (
          <div className="flex items-center justify-center gap-4 px-4 py-2">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
              <CameraIcon className="size-4" />
            </div>
            <div className="min-w-0 max-w-md flex-1">
              <p className="text-sm font-medium">No camera selected</p>
              <p className="line-clamp-2 text-xs/relaxed text-muted-foreground">
                Preview stays on this device. A frame is saved only after review and explicit
                action.
              </p>
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                disabled={state === "requesting"}
                onClick={() => void startCamera()}
                size="sm"
                variant="outline"
              >
                Choose camera
              </Button>
              <Button
                disabled={state === "requesting"}
                onClick={() => setRemoteDialogOpen(true)}
                size="sm"
                variant="outline"
              >
                <WifiIcon data-icon="inline-start" />
                Phone / LAN
              </Button>
            </div>
          </div>
        )}
        {state === "live" && (
          <div className="absolute right-3 bottom-3 flex gap-2">
            <Button onClick={() => void freezeFrame()} size="sm">
              Take snapshot
            </Button>
            <Button
              onClick={() => {
                stopStream();
                stopRemotePreview();
                if (lanRelayStatus?.running) {
                  void window.circuitHarness.stopLanCameraRelay();
                  setLanRelayStatus(undefined);
                }
                setActiveSource(undefined);
                setState("idle");
                setStatus("Camera preview off");
              }}
              size="sm"
              variant="secondary"
            >
              Stop preview
            </Button>
          </div>
        )}
        {state === "frozen" && (
          <div className="absolute right-3 bottom-3 flex gap-2">
            <Button onClick={() => void saveFrame()} size="sm">
              Save snapshot
            </Button>
            <Button
              onClick={() => {
                const wasRemote = frozenSourceRef.current === "remote_camera";
                clearFrozen();
                if (wasRemote) {
                  void startRemoteCamera();
                } else {
                  setState("live");
                  setStatus("Local preview on — not uploading");
                }
              }}
              size="sm"
              variant="secondary"
            >
              Retake
            </Button>
          </div>
        )}
      </div>
      <Dialog open={remoteDialogOpen} onOpenChange={setRemoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect a phone or LAN camera</DialogTitle>
            <DialogDescription>
              Pair a phone directly over an encrypted, token-scoped WebSocket, or use an existing
              private-LAN JPEG endpoint. Eve can save the current frame only when you ask for a
              visual check and that permission is enabled in Settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Secure phone relay</p>
                <p className="text-xs text-muted-foreground">
                  Opens a temporary HTTPS + WebSocket camera sender on this LAN. Pairing expires
                  when you stop it or close the project.
                </p>
              </div>
              {lanRelayStatus?.qrDataUrl && (
                <img
                  alt="QR code for pairing a phone build camera"
                  className="mx-auto size-48 rounded-lg bg-white p-2"
                  src={lanRelayStatus.qrDataUrl}
                />
              )}
              {lanRelayStatus?.pairingUrl && (
                <p className="break-all rounded bg-muted p-2 font-mono text-[11px]">
                  {lanRelayStatus.pairingUrl}
                </p>
              )}
              {lanRelayStatus?.certificateFingerprint && (
                <p className="break-all text-[11px] text-muted-foreground">
                  Certificate fingerprint: {lanRelayStatus.certificateFingerprint}
                </p>
              )}
              {lanRelayStatus?.warning && (
                <p className="text-xs text-amber-300">{lanRelayStatus.warning}</p>
              )}
              <Button
                onClick={() => {
                  if (lanRelayStatus?.running) {
                    void window.circuitHarness.stopLanCameraRelay().then(() => {
                      setLanRelayStatus(undefined);
                      setStatus("LAN camera relay off");
                    });
                  } else {
                    void startLanRelay();
                  }
                }}
                type="button"
              >
                {lanRelayStatus?.running
                  ? lanRelayStatus.connected
                    ? "Stop paired camera"
                    : "Cancel pairing"
                  : "Create phone pairing code"}
              </Button>
            </div>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Existing JPEG camera endpoint
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void startRemoteCamera();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="remote-camera-url">JPEG snapshot URL</Label>
                  <Input
                    id="remote-camera-url"
                    inputMode="url"
                    maxLength={500}
                    onChange={(event) => setRemoteUrl(event.currentTarget.value)}
                    placeholder="http://192.168.1.42:8080/shot.jpg"
                    value={remoteUrl}
                  />
                </div>
                <Button disabled={!remoteUrl.trim() || state === "requesting"} type="submit">
                  Connect endpoint
                </Button>
              </form>
            </details>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unexpected camera error occurred.";
}

function toneProsody(tone: AppPreferences["voiceTone"]): {
  readonly pitch: number;
  readonly rate: number;
} {
  switch (tone) {
    case "focused":
      return { pitch: 0.98, rate: 1.04 };
    case "calm":
      return { pitch: 0.96, rate: 0.9 };
    case "energetic":
      return { pitch: 1.08, rate: 1.12 };
    case "warm":
      return { pitch: 1.04, rate: 0.98 };
  }
}
