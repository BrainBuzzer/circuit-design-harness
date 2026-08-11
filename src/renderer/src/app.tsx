import type { AppPreferences } from "@domain/preferences";
import type { AgentEvent, AgentSnapshot } from "@shared/agent-contract";
import type { AssemblySnapshot } from "@shared/assembly-contract";
import type { ProjectAttachment } from "@shared/attachment-contract";
import type { ProjectCapture } from "@shared/capture-contract";
import type { CircuitSnapshot } from "@shared/circuit-contract";
import type { CircuitExportResult, ProjectArchiveResult } from "@shared/export-contract";
import type { ProjectIntegrityReport } from "@shared/integrity-contract";
import type { ProjectState } from "@shared/project-contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@/chat-types";
import { AppSidebar } from "@/components/app-sidebar";
import { Badge } from "@/components/ui/badge";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Workbench } from "@/components/workbench";
import { userFacingProjectError } from "@/lib/user-facing-error";

type AuthFlowEvent = Extract<
  AgentEvent,
  { type: "auth-prompt" | "auth-notification" | "auth-complete" | "auth-error" }
>;

export function App(): React.JSX.Element {
  const [projectState, setProjectState] = useState<ProjectState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [agentSnapshot, setAgentSnapshot] = useState<AgentSnapshot>();
  const [authEvent, setAuthEvent] = useState<AuthFlowEvent>();
  const [messagesByProject, setMessagesByProject] = useState<
    Readonly<Record<string, readonly ChatMessage[]>>
  >({});
  const [circuitsByProject, setCircuitsByProject] = useState<
    Readonly<Record<string, CircuitSnapshot>>
  >({});
  const [assembliesByProject, setAssembliesByProject] = useState<
    Readonly<Record<string, AssemblySnapshot>>
  >({});
  const [attachmentsByProject, setAttachmentsByProject] = useState<
    Readonly<Record<string, readonly ProjectAttachment[]>>
  >({});
  const [capturesByProject, setCapturesByProject] = useState<
    Readonly<Record<string, readonly ProjectCapture[]>>
  >({});
  const [preferences, setPreferences] = useState<AppPreferences>();

  useEffect(() => {
    void window.circuitHarness
      .getProjectState()
      .then(setProjectState)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
    void window.circuitHarness
      .getAppPreferences()
      .then(setPreferences)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
  }, []);

  useEffect(
    () =>
      window.circuitHarness.onCircuitEvent((event) => {
        setCircuitsByProject((current) => ({
          ...current,
          [event.projectId]: event.snapshot,
        }));
      }),
    [],
  );

  useEffect(
    () =>
      window.circuitHarness.onAssemblyEvent((event) => {
        setAssembliesByProject((current) => ({
          ...current,
          [event.projectId]: event.snapshot,
        }));
      }),
    [],
  );

  useEffect(() => {
    void window.circuitHarness
      .getAgentSnapshot()
      .then(setAgentSnapshot)
      .catch((reason: unknown) => setError(toErrorMessage(reason)));

    return window.circuitHarness.onAgentEvent((event) => {
      handleAgentEvent(event, setAgentSnapshot, setMessagesByProject, setAuthEvent, setError);
      if (event.type === "response-end") {
        void window.circuitHarness
          .getCaptures(event.projectId)
          .then((captures) =>
            setCapturesByProject((current) => ({ ...current, [event.projectId]: captures })),
          );
      }
    });
  }, []);

  const runProjectAction = useCallback(async (action: () => Promise<ProjectState>) => {
    setBusy(true);
    setError(undefined);

    try {
      setProjectState(await action());
    } catch (reason) {
      setError(toErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  const updateAppPreferences = useCallback(async (nextPreferences: AppPreferences) => {
    setError(undefined);
    setPreferences(nextPreferences);
    try {
      setPreferences(
        await window.circuitHarness.updateAppPreferences({ preferences: nextPreferences }),
      );
    } catch (reason) {
      try {
        setPreferences(await window.circuitHarness.getAppPreferences());
      } catch {
        // Preserve the optimistic value when the recovery read is also unavailable.
      }
      setError(toErrorMessage(reason));
      throw reason;
    }
  }, []);

  const activeProject = useMemo(
    () => projectState?.projects.find((project) => project.id === projectState.activeProjectId),
    [projectState],
  );

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    void window.circuitHarness
      .getCircuit(activeProject.id)
      .then((snapshot) =>
        setCircuitsByProject((current) => ({ ...current, [activeProject.id]: snapshot })),
      )
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
    void window.circuitHarness
      .getAssembly(activeProject.id)
      .then((snapshot) =>
        setAssembliesByProject((current) => ({ ...current, [activeProject.id]: snapshot })),
      )
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
    void window.circuitHarness
      .getAttachments(activeProject.id)
      .then((attachments) =>
        setAttachmentsByProject((current) => ({
          ...current,
          [activeProject.id]: attachments,
        })),
      )
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
    void window.circuitHarness
      .getCaptures(activeProject.id)
      .then((captures) =>
        setCapturesByProject((current) => ({ ...current, [activeProject.id]: captures })),
      )
      .catch((reason: unknown) => setError(toErrorMessage(reason)));
  }, [activeProject]);

  const sendMessage = useCallback(
    async (text: string, attachmentIds: readonly string[], captureIds: readonly string[]) => {
      if (!activeProject) {
        return;
      }

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        timestamp: Date.now(),
      };
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessagesByProject((current) => ({
        ...current,
        [activeProject.id]: [...(current[activeProject.id] ?? []), userMessage, assistantMessage],
      }));
      setError(undefined);

      try {
        await window.circuitHarness.sendAgentMessage({
          projectId: activeProject.id,
          text,
          attachmentIds,
          captureIds,
        });
      } catch (reason) {
        setError(toErrorMessage(reason));
      }
    },
    [activeProject],
  );

  const chooseAttachments = useCallback(
    async (projectId: string) => {
      setError(undefined);
      try {
        const attachments = await window.circuitHarness.chooseAttachments(projectId);
        setAttachmentsByProject((current) => ({ ...current, [projectId]: attachments }));
        return attachments;
      } catch (reason) {
        setError(toErrorMessage(reason));
        return attachmentsByProject[projectId] ?? [];
      }
    },
    [attachmentsByProject],
  );

  const reindexAttachment = useCallback(async (projectId: string, attachmentId: string) => {
    setError(undefined);
    try {
      const attachments = await window.circuitHarness.reindexAttachment({
        projectId,
        attachmentId,
      });
      setAttachmentsByProject((current) => ({ ...current, [projectId]: attachments }));
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  }, []);

  const trashAttachment = useCallback(async (projectId: string, attachmentId: string) => {
    setError(undefined);
    try {
      const attachments = await window.circuitHarness.trashAttachment({
        projectId,
        attachmentId,
      });
      setAttachmentsByProject((current) => ({ ...current, [projectId]: attachments }));
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  }, []);

  const restoreAttachment = useCallback(async (projectId: string, trashId: string) => {
    setError(undefined);
    try {
      const attachments = await window.circuitHarness.restoreAttachment({ projectId, trashId });
      setAttachmentsByProject((current) => ({ ...current, [projectId]: attachments }));
    } catch (reason) {
      setError(toErrorMessage(reason));
      throw reason;
    }
  }, []);

  const setModel = useCallback(async (projectId: string, providerId: string, modelId: string) => {
    setError(undefined);

    try {
      setAgentSnapshot(
        await window.circuitHarness.setAgentModel({ projectId, providerId, modelId }),
      );
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }, []);

  const approveCircuitProposal = useCallback(async (projectId: string, proposalId: string) => {
    setError(undefined);
    try {
      const updated = await window.circuitHarness.approveCircuitProposal({ projectId, proposalId });
      setCircuitsByProject((current) => ({ ...current, [projectId]: updated }));
      setProjectState(await window.circuitHarness.getProjectState());
      setAgentSnapshot(await window.circuitHarness.getAgentSnapshot());
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }, []);

  const rejectCircuitProposal = useCallback(async (projectId: string, proposalId: string) => {
    setError(undefined);
    try {
      await window.circuitHarness.rejectCircuitProposal({ projectId, proposalId });
      setAgentSnapshot(await window.circuitHarness.getAgentSnapshot());
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }, []);

  const approveAssemblyProposal = useCallback(async (projectId: string, proposalId: string) => {
    setError(undefined);
    try {
      const updated = await window.circuitHarness.approveAssemblyProposal({
        projectId,
        proposalId,
      });
      setAssembliesByProject((current) => ({ ...current, [projectId]: updated }));
      setAgentSnapshot(await window.circuitHarness.getAgentSnapshot());
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }, []);

  const rejectAssemblyProposal = useCallback(async (projectId: string, proposalId: string) => {
    setError(undefined);
    try {
      await window.circuitHarness.rejectAssemblyProposal({ projectId, proposalId });
      setAgentSnapshot(await window.circuitHarness.getAgentSnapshot());
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  }, []);

  const exportCircuit = useCallback(async (): Promise<CircuitExportResult | undefined> => {
    if (!activeProject) {
      return undefined;
    }
    setError(undefined);
    try {
      return await window.circuitHarness.exportCircuit(activeProject.id);
    } catch (reason) {
      setError(toErrorMessage(reason));
      return undefined;
    }
  }, [activeProject]);

  const exportProjectArchive = useCallback(async (): Promise<ProjectArchiveResult | undefined> => {
    if (!activeProject) {
      return undefined;
    }
    setError(undefined);
    try {
      return await window.circuitHarness.exportProjectArchive(activeProject.id);
    } catch (reason) {
      setError(toErrorMessage(reason));
      return undefined;
    }
  }, [activeProject]);

  const verifyProjectIntegrity = useCallback(
    async (projectId: string): Promise<ProjectIntegrityReport | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        return await window.circuitHarness.verifyProjectIntegrity(projectId);
      } catch (reason) {
        setError(toErrorMessage(reason));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen>
        <AppSidebar
          busy={busy}
          preferences={preferences}
          state={projectState}
          onActivateProject={(projectId) =>
            runProjectAction(() => window.circuitHarness.activateProject(projectId))
          }
          onChooseRoot={() => runProjectAction(() => window.circuitHarness.chooseProjectRoot())}
          onImportProject={() =>
            runProjectAction(() => window.circuitHarness.importProjectArchive())
          }
          onCreateProject={() =>
            runProjectAction(() =>
              window.circuitHarness.createProject({ title: nextUntitledTitle(projectState) }),
            )
          }
          onRenameProject={(projectId, title) =>
            runProjectAction(() => window.circuitHarness.renameProject({ projectId, title }))
          }
          onUpdatePreferences={updateAppPreferences}
          onVerifyProject={verifyProjectIntegrity}
        />
        <SidebarInset className="h-svh min-w-0 overflow-hidden bg-page">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-3 backdrop-blur-sm">
            <SidebarTrigger aria-label="Toggle project sidebar" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">
                {activeProject?.title ?? "Circuit Design Harness"}
              </p>
              <p className="truncate text-[12px] text-ink-2">
                {activeProject
                  ? `Design revision ${activeProject.circuitRevision}`
                  : "Create or select a project to begin"}
              </p>
            </div>
            <Badge variant={activeProject ? "success" : "outline"}>
              {activeProject ? "Project active" : "No project"}
            </Badge>
          </header>
          <Workbench
            activeProject={activeProject}
            agentSnapshot={agentSnapshot}
            authEvent={authEvent}
            attachments={activeProject ? (attachmentsByProject[activeProject.id] ?? []) : []}
            assemblySnapshot={activeProject ? assembliesByProject[activeProject.id] : undefined}
            busy={busy}
            circuitSnapshot={activeProject ? circuitsByProject[activeProject.id] : undefined}
            captures={activeProject ? (capturesByProject[activeProject.id] ?? []) : []}
            error={error}
            messages={activeProject ? (messagesByProject[activeProject.id] ?? []) : []}
            preferences={preferences}
            onAbort={() => {
              if (activeProject) {
                void window.circuitHarness.abortAgent(activeProject.id);
              }
            }}
            onApproveCircuitProposal={approveCircuitProposal}
            onApproveAssemblyProposal={approveAssemblyProposal}
            onRejectCircuitProposal={rejectCircuitProposal}
            onRejectAssemblyProposal={rejectAssemblyProposal}
            onChooseAttachments={chooseAttachments}
            onReindexAttachment={reindexAttachment}
            onTrashAttachment={trashAttachment}
            onRestoreAttachment={restoreAttachment}
            onCaptureSaved={(capture) =>
              setCapturesByProject((current) => ({
                ...current,
                [capture.projectId]: [...(current[capture.projectId] ?? []), capture],
              }))
            }
            onSendMessage={sendMessage}
            onSetModel={setModel}
            onUpdatePreferences={updateAppPreferences}
            onExportCircuit={exportCircuit}
            onExportProjectArchive={exportProjectArchive}
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

function handleAgentEvent(
  event: AgentEvent,
  setSnapshot: React.Dispatch<React.SetStateAction<AgentSnapshot | undefined>>,
  setMessages: React.Dispatch<
    React.SetStateAction<Readonly<Record<string, readonly ChatMessage[]>>>
  >,
  setAuthEvent: React.Dispatch<React.SetStateAction<AuthFlowEvent | undefined>>,
  setError: React.Dispatch<React.SetStateAction<string | undefined>>,
): void {
  if (event.type === "snapshot") {
    setSnapshot(event.snapshot);
    return;
  }

  if (event.type === "error") {
    setError(event.message);
    return;
  }

  if (event.type === "conversation") {
    setMessages((current) => ({ ...current, [event.projectId]: event.messages }));
    return;
  }

  if (
    event.type === "auth-prompt" ||
    event.type === "auth-notification" ||
    event.type === "auth-complete" ||
    event.type === "auth-error"
  ) {
    setAuthEvent(event);
    return;
  }

  if (event.type === "text-delta") {
    setMessages((current) => {
      const messages = [...(current[event.projectId] ?? [])];
      const lastMessage = messages.at(-1);

      if (lastMessage?.role === "assistant") {
        messages[messages.length - 1] = {
          ...lastMessage,
          content: `${lastMessage.content}${event.delta}`,
        };
      } else {
        messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: event.delta,
          timestamp: Date.now(),
        });
      }

      return { ...current, [event.projectId]: messages };
    });
  }
}

function nextUntitledTitle(state: ProjectState | undefined): string {
  const existing = state?.projects.filter((project) =>
    project.title.startsWith("Untitled Circuit"),
  );
  const suffix = existing?.length ? ` ${existing.length + 1}` : "";
  return `Untitled Circuit${suffix}`;
}

function toErrorMessage(reason: unknown): string {
  return userFacingProjectError(reason);
}
