import type { AppPreferences } from "@domain/preferences";
import type { ProjectIntegrityReport } from "@shared/integrity-contract";
import type { ProjectState } from "@shared/project-contract";
import {
  ArchiveRestoreIcon,
  CircuitBoardIcon,
  FolderCogIcon,
  PencilIcon,
  PlusIcon,
  Settings2Icon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

interface AppSidebarProps {
  readonly state: ProjectState | undefined;
  readonly preferences: AppPreferences | undefined;
  readonly busy: boolean;
  readonly onCreateProject: () => void;
  readonly onActivateProject: (projectId: string) => void;
  readonly onChooseRoot: () => void;
  readonly onImportProject: () => void;
  readonly onRenameProject: (projectId: string, title: string) => void;
  readonly onUpdatePreferences: (preferences: AppPreferences) => Promise<void>;
  readonly onVerifyProject: (projectId: string) => Promise<ProjectIntegrityReport | undefined>;
}

export function AppSidebar({
  state,
  preferences,
  busy,
  onCreateProject,
  onActivateProject,
  onChooseRoot,
  onImportProject,
  onRenameProject,
  onUpdatePreferences,
  onVerifyProject,
}: AppSidebarProps): React.JSX.Element {
  const [renameTarget, setRenameTarget] = useState<{
    readonly id: string;
    readonly title: string;
  }>();
  const [renameTitle, setRenameTitle] = useState("");
  const [integrityReport, setIntegrityReport] = useState<ProjectIntegrityReport>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();

  const closeRename = (): void => {
    setRenameTarget(undefined);
    setRenameTitle("");
  };

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip="Circuit Design Harness">
                <span className="flex size-8 items-center justify-center rounded-[10px] bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_55%,#000),0_1px_2px_#0285ff33]">
                  <CircuitBoardIcon />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold tracking-[-0.01em]">
                    Circuit Harness
                  </span>
                  <span className="truncate text-[12px] text-ink-2">Pi-powered workbench</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Button
            className="group-data-[collapsible=icon]:hidden"
            disabled={busy}
            onClick={onCreateProject}
          >
            <PlusIcon data-icon="inline-start" />
            New circuit project
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction
              aria-label="Create circuit project"
              disabled={busy}
              onClick={onCreateProject}
            >
              <PlusIcon />
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {!state && (
                  <>
                    <SidebarMenuItem>
                      <Skeleton className="h-8 w-full" />
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <Skeleton className="h-8 w-4/5" />
                    </SidebarMenuItem>
                  </>
                )}
                {state?.projects.map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={project.id === state.activeProjectId}
                      tooltip={project.title}
                      onClick={() => onActivateProject(project.id)}
                    >
                      <CircuitBoardIcon />
                      <span>{project.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      aria-label={`Rename ${project.title}`}
                      onClick={() => {
                        setRenameTarget({ id: project.id, title: project.title });
                        setRenameTitle(project.title);
                      }}
                      showOnHover
                    >
                      <PencilIcon />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
                {state?.projects.length === 0 && (
                  <SidebarMenuItem>
                    <p className="px-2 py-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
                      No projects in this folder yet.
                    </p>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled={busy || !state?.activeProjectId}
                tooltip="Verify active project integrity"
                onClick={() => {
                  if (state?.activeProjectId) {
                    void onVerifyProject(state.activeProjectId).then(setIntegrityReport);
                  }
                }}
              >
                <ShieldCheckIcon />
                <span>Verify project integrity</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                disabled={busy}
                tooltip="Import portable project archive"
                onClick={onImportProject}
              >
                <ArchiveRestoreIcon />
                <span>Import project archive</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Choose project folder" onClick={onChooseRoot}>
                <FolderCogIcon />
                <span>{state ? basename(state.rootPath) : "Project folder"}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings2Icon />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && closeRename()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename circuit project</DialogTitle>
            <DialogDescription>
              This updates the portable project manifest without moving its folder.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const title = renameTitle.trim();
              if (renameTarget && title) {
                onRenameProject(renameTarget.id, title);
                closeRename();
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="rename-project-title">Project name</Label>
              <Input
                autoFocus
                id="rename-project-title"
                maxLength={120}
                onChange={(event) => setRenameTitle(event.currentTarget.value)}
                value={renameTitle}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeRename}>
                Cancel
              </Button>
              <Button disabled={!renameTitle.trim()} type="submit">
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(integrityReport)}
        onOpenChange={(open) => !open && setIntegrityReport(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {integrityReport?.healthy
                ? "Project integrity verified"
                : "Project integrity needs attention"}
            </DialogTitle>
            <DialogDescription>
              Checked {integrityReport?.checkedFileCount ?? 0} canonical, evidence, and capture
              files against their schemas and recorded hashes.
            </DialogDescription>
          </DialogHeader>
          {integrityReport?.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No integrity problems were found.</p>
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto">
              {integrityReport?.issues.map((issue) => (
                <div className="rounded-md border p-3" key={`${issue.code}:${issue.path}`}>
                  <p className="text-sm font-medium">{issue.path}</p>
                  <p className="text-xs text-muted-foreground">{issue.message}</p>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIntegrityReport(undefined)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Harness settings</DialogTitle>
            <DialogDescription>
              Configure project storage, Eve voice control, camera handoff, and local spoken
              replies. Wake-word listening always remains an explicit opt-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">Project folder</p>
              <p className="break-all text-xs text-muted-foreground">
                {state?.rootPath ?? "Loading project folder…"}
              </p>
              <Button onClick={onChooseRoot} size="sm" variant="outline">
                <FolderCogIcon /> Choose folder
              </Button>
            </div>
            {preferences ? (
              <>
                <PreferenceCheckbox
                  checked={preferences.wakeWordEnabled}
                  description="Listen locally for “Eve” or “Hey Eve”. The microphone indicator stays visible while enabled."
                  disabled={settingsBusy}
                  label="Enable Eve wake word"
                  onChange={(wakeWordEnabled) =>
                    void savePreferences({ ...preferences, wakeWordEnabled })
                  }
                />
                <PreferenceCheckbox
                  checked={preferences.autoCaptureVisualRequests}
                  description="When a request says “take a look” or asks Eve to check the camera, allow the camera tool to capture the current frame into this project."
                  disabled={settingsBusy}
                  label="Camera capture for visual requests"
                  onChange={(autoCaptureVisualRequests) =>
                    void savePreferences({ ...preferences, autoCaptureVisualRequests })
                  }
                />
                <PreferenceCheckbox
                  checked={preferences.spokenReplies}
                  description="Speak a short local Chatterbox summary of completed assistant responses (full text stays on screen)."
                  disabled={settingsBusy}
                  label="Speak Eve’s replies"
                  onChange={(spokenReplies) =>
                    void savePreferences({ ...preferences, spokenReplies })
                  }
                />
                <label className="grid gap-1.5 text-sm" htmlFor="assistant-tone">
                  Eve’s tone
                  <select
                    className="h-9 rounded-md border bg-background px-3"
                    disabled={settingsBusy}
                    id="assistant-tone"
                    onChange={(event) =>
                      void savePreferences({
                        ...preferences,
                        voiceTone: event.currentTarget.value as AppPreferences["voiceTone"],
                      })
                    }
                    value={preferences.voiceTone}
                  >
                    <option value="warm">Warm peer</option>
                    <option value="focused">Focused engineer</option>
                    <option value="calm">Calm guide</option>
                    <option value="energetic">Energetic collaborator</option>
                  </select>
                </label>
              </>
            ) : (
              <Skeleton className="h-36 w-full" />
            )}
            {settingsError && (
              <p className="text-xs text-destructive" role="alert">
                {settingsError}
              </p>
            )}
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );

  async function savePreferences(nextPreferences: AppPreferences): Promise<void> {
    setSettingsBusy(true);
    setSettingsError(undefined);
    try {
      await onUpdatePreferences(nextPreferences);
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : "Could not save settings.");
    } finally {
      setSettingsBusy(false);
    }
  }
}

function PreferenceCheckbox({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly description: string;
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex gap-3 rounded-lg border p-3">
      <input
        checked={checked}
        className="mt-0.5 size-4 accent-primary"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}
