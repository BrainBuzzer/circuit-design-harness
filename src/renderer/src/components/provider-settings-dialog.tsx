import type {
  AgentEvent,
  AgentSnapshot,
  AuthNotification,
  AuthPromptDetails,
  PiAuthType,
  PiProviderInfo,
} from "@shared/agent-contract";
import { CheckCircle2Icon, ExternalLinkIcon, KeyRoundIcon, LogOutIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AuthFlowEvent = Extract<
  AgentEvent,
  { type: "auth-prompt" | "auth-notification" | "auth-complete" | "auth-error" }
>;

interface ProviderSettingsDialogProps {
  readonly snapshot: AgentSnapshot | undefined;
  readonly authEvent: AuthFlowEvent | undefined;
}

export function ProviderSettingsDialog({
  snapshot,
  authEvent,
}: ProviderSettingsDialogProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [flowId, setFlowId] = useState<string>();
  const [providerName, setProviderName] = useState<string>();
  const [prompt, setPrompt] = useState<{
    readonly promptId: string;
    readonly details: AuthPromptDetails;
  }>();
  const [notification, setNotification] = useState<AuthNotification>();
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busyProviderId, setBusyProviderId] = useState<string>();
  const ignoredFlowId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!authEvent || authEvent.flowId === ignoredFlowId.current) {
      return;
    }

    setOpen(true);
    setFlowId(authEvent.flowId);

    if (authEvent.type === "auth-prompt") {
      setProviderName(authEvent.providerName);
      setPrompt({ promptId: authEvent.promptId, details: authEvent.prompt });
      setAnswer("");
      setStatus(undefined);
      setError(undefined);
      return;
    }

    if (authEvent.type === "auth-notification") {
      setNotification(authEvent.notification);
      setStatus(notificationMessage(authEvent.notification));
      return;
    }

    setPrompt(undefined);
    setBusyProviderId(undefined);

    if (authEvent.type === "auth-complete") {
      setStatus("Provider connected. Pi models are being refreshed.");
      setError(undefined);
      return;
    }

    setStatus(undefined);
    setError(authEvent.cancelled ? "Sign-in cancelled." : authEvent.message);
  }, [authEvent]);

  const providers = useMemo(
    () =>
      [...(snapshot?.providers ?? [])].sort(
        (left, right) =>
          Number(right.authenticated) - Number(left.authenticated) ||
          left.name.localeCompare(right.name),
      ),
    [snapshot],
  );

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);

    if (!nextOpen) {
      if (flowId) {
        ignoredFlowId.current = flowId;
        void window.circuitHarness.cancelProviderLogin(flowId);
      }
      resetFlowState();
    }
  };

  const resetFlowState = (): void => {
    setFlowId(undefined);
    setProviderName(undefined);
    setPrompt(undefined);
    setNotification(undefined);
    setAnswer("");
    setStatus(undefined);
    setError(undefined);
    setBusyProviderId(undefined);
  };

  const startLogin = async (provider: PiProviderInfo, authType: PiAuthType): Promise<void> => {
    ignoredFlowId.current = undefined;
    setBusyProviderId(provider.id);
    setProviderName(provider.name);
    setPrompt(undefined);
    setNotification(undefined);
    setStatus(`Starting ${provider.name} sign-in…`);
    setError(undefined);

    try {
      setFlowId(
        await window.circuitHarness.startProviderLogin({ providerId: provider.id, authType }),
      );
    } catch (reason) {
      setBusyProviderId(undefined);
      setStatus(undefined);
      setError(toErrorMessage(reason));
    }
  };

  const submitPrompt = async (): Promise<void> => {
    if (!flowId || !prompt || !answer) {
      return;
    }

    try {
      await window.circuitHarness.respondToAuthPrompt({
        flowId,
        promptId: prompt.promptId,
        value: answer,
      });
      setPrompt(undefined);
      setAnswer("");
      setStatus("Continuing sign-in…");
    } catch (reason) {
      setError(toErrorMessage(reason));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <KeyRoundIcon data-icon="inline-start" />
        Providers
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{providerName ? `Connect ${providerName}` : "Pi providers"}</DialogTitle>
          <DialogDescription>
            Credentials are managed by Pi. This app never sends a key anywhere except the provider
            flow you choose.
          </DialogDescription>
        </DialogHeader>

        {prompt ? (
          <AuthPromptForm
            answer={answer}
            details={prompt.details}
            error={error}
            notification={notification}
            onAnswerChange={setAnswer}
            onOpenExternal={(url) => void window.circuitHarness.openExternalUrl(url)}
            onSubmit={() => void submitPrompt()}
            status={status}
          />
        ) : (
          <>
            {(status || error || notification) && (
              <AuthFlowStatus
                error={error}
                notification={notification}
                onOpenExternal={(url) => void window.circuitHarness.openExternalUrl(url)}
                status={status}
              />
            )}
            <ScrollArea className="min-h-0 max-h-[55vh] pr-3">
              <div className="grid gap-2">
                {providers.map((provider) => (
                  <ProviderCard
                    busy={busyProviderId === provider.id}
                    key={provider.id}
                    onLogin={(authType) => void startLogin(provider, authType)}
                    onLogout={() => {
                      setBusyProviderId(provider.id);
                      setError(undefined);
                      void window.circuitHarness
                        .logoutProvider(provider.id)
                        .catch((reason: unknown) => setError(toErrorMessage(reason)))
                        .finally(() => setBusyProviderId(undefined));
                    }}
                    provider={provider}
                  />
                ))}
                {providers.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Discovering the providers included with Pi…
                  </p>
                )}
              </div>
            </ScrollArea>
          </>
        )}
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function ProviderCard({
  provider,
  busy,
  onLogin,
  onLogout,
}: {
  readonly provider: PiProviderInfo;
  readonly busy: boolean;
  readonly onLogin: (authType: PiAuthType) => void;
  readonly onLogout: () => void;
}): React.JSX.Element {
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center gap-3">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2">
            {provider.name}
            {provider.authenticated && <CheckCircle2Icon className="size-3.5 text-emerald-500" />}
          </CardTitle>
          <CardDescription>
            {provider.authenticated
              ? provider.authSource || "Connected"
              : provider.supportsApiKey || provider.supportsOAuth
                ? "Not connected"
                : "Configure through Pi environment or provider files"}
          </CardDescription>
        </div>
        <CardContent className="flex shrink-0 gap-2 p-0">
          {provider.authenticated && provider.canLogout ? (
            <Button disabled={busy} onClick={onLogout} size="sm" variant="ghost">
              <LogOutIcon data-icon="inline-start" />
              Disconnect
            </Button>
          ) : !provider.authenticated ? (
            <>
              {provider.supportsApiKey && (
                <Button
                  disabled={busy}
                  onClick={() => onLogin("api_key")}
                  size="sm"
                  variant="outline"
                >
                  API key
                </Button>
              )}
              {provider.supportsOAuth && (
                <Button disabled={busy} onClick={() => onLogin("oauth")} size="sm">
                  Sign in
                </Button>
              )}
            </>
          ) : null}
        </CardContent>
      </CardHeader>
    </Card>
  );
}

function AuthPromptForm({
  details,
  answer,
  error,
  notification,
  status,
  onAnswerChange,
  onOpenExternal,
  onSubmit,
}: {
  readonly details: AuthPromptDetails;
  readonly answer: string;
  readonly error: string | undefined;
  readonly notification: AuthNotification | undefined;
  readonly status: string | undefined;
  readonly onAnswerChange: (value: string) => void;
  readonly onOpenExternal: (url: string) => void;
  readonly onSubmit: () => void;
}): React.JSX.Element {
  return (
    <div className="grid gap-4">
      <AuthFlowStatus
        error={error}
        notification={notification}
        onOpenExternal={onOpenExternal}
        status={status}
      />
      <div className="grid gap-2">
        <Label htmlFor="pi-auth-answer">{details.message}</Label>
        {details.type === "select" ? (
          <Select value={answer || null} onValueChange={(value) => onAnswerChange(value ?? "")}>
            <SelectTrigger id="pi-auth-answer" className="w-full">
              <SelectValue placeholder="Choose an option">
                {details.options.find((option) => option.id === answer)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {details.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  <span className="grid">
                    <span>{option.label}</span>
                    {option.description && (
                      <span className="text-xs text-muted-foreground">{option.description}</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            autoFocus
            id="pi-auth-answer"
            onChange={(event) => onAnswerChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder={details.placeholder}
            type={details.type === "secret" ? "password" : "text"}
            value={answer}
          />
        )}
      </div>
      <Button disabled={!answer} onClick={onSubmit}>
        Continue
      </Button>
    </div>
  );
}

function AuthFlowStatus({
  error,
  notification,
  status,
  onOpenExternal,
}: {
  readonly error: string | undefined;
  readonly notification: AuthNotification | undefined;
  readonly status: string | undefined;
  readonly onOpenExternal: (url: string) => void;
}): React.JSX.Element | null {
  const external = notificationExternalLink(notification);

  if (!status && !error && !notification) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      {status && <p>{status}</p>}
      {notification?.type === "device_code" && (
        <p>
          Device code:{" "}
          <code className="rounded bg-background px-1.5 py-0.5 font-mono">
            {notification.userCode}
          </code>
        </p>
      )}
      {error && <p className="text-destructive">{error}</p>}
      {external && (
        <Button onClick={() => onOpenExternal(external.url)} size="sm" variant="outline">
          <ExternalLinkIcon data-icon="inline-start" />
          {external.label}
        </Button>
      )}
    </div>
  );
}

function notificationMessage(notification: AuthNotification): string {
  switch (notification.type) {
    case "info":
    case "progress":
      return notification.message;
    case "auth_url":
      return notification.instructions ?? "Open the provider sign-in page to continue.";
    case "device_code":
      return "Open the provider page and enter the device code shown below.";
  }
}

function notificationExternalLink(
  notification: AuthNotification | undefined,
): { readonly url: string; readonly label: string } | undefined {
  if (notification?.type === "auth_url") {
    return { url: notification.url, label: "Open sign-in page" };
  }

  if (notification?.type === "device_code") {
    return { url: notification.verificationUri, label: "Open verification page" };
  }

  const link = notification?.type === "info" ? notification.links?.[0] : undefined;
  return link ? { url: link.url, label: link.label ?? "Open provider page" } : undefined;
}

function toErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "An unexpected provider error occurred.";
}
