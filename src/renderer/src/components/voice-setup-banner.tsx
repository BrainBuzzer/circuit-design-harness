import type { VoiceAssetStatus } from "@shared/voice-contract";
import { DownloadIcon, LoaderCircleIcon, ShieldCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function VoiceSetupBanner({
  status,
  onRetry,
  busy,
}: {
  readonly status: VoiceAssetStatus | undefined;
  readonly onRetry: () => void;
  readonly busy: boolean;
}): React.JSX.Element | null {
  if (!status) {
    return (
      <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
        Checking voice assets…
      </div>
    );
  }
  if (status.allReady) {
    return null;
  }

  const rows = [
    status.whisper,
    status.chatterbox,
    status.wakeword,
    {
      kind: "python" as const,
      label: "Python runtime (LiveKit + Chatterbox)",
      ready: status.python.ready,
      downloading: status.python.installing,
      percent: undefined as number | undefined,
      message: status.python.message,
      error: status.python.error,
      currentFile: undefined as string | undefined,
    },
  ];

  return (
    <section
      aria-label="Voice setup progress"
      className="border-b border-sky-200 bg-sky-50 px-3 py-2.5 text-sky-950"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <DownloadIcon className="size-3.5 shrink-0" />
        <p className="text-xs font-semibold">{status.summary}</p>
        <Badge className="border-sky-200 bg-white text-sky-900" variant="outline">
          First-start download
        </Badge>
        <Button
          className="ml-auto h-7"
          disabled={busy}
          onClick={onRetry}
          size="sm"
          variant="outline"
        >
          {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
          Retry setup
        </Button>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            className="rounded-md border border-sky-100 bg-white/80 px-2 py-1.5 text-[11px]"
            key={row.kind}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{row.label}</span>
              <span className="text-sky-800">
                {row.ready ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <ShieldCheckIcon className="size-3" /> ready
                  </span>
                ) : row.downloading ? (
                  `${row.percent ?? "…"}%`
                ) : row.error ? (
                  "error"
                ) : (
                  "pending"
                )}
              </span>
            </div>
            {row.downloading || (!row.ready && row.message) ? (
              <div className="mt-1">
                <div className="h-1.5 overflow-hidden rounded bg-sky-100">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{
                      width: `${row.ready ? 100 : Math.max(row.percent ?? (row.downloading ? 5 : 0), 0)}%`,
                    }}
                  />
                </div>
                <p className="mt-0.5 truncate text-sky-900/80">
                  {row.error ?? row.message ?? row.currentFile ?? "Working…"}
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {status.python.logTail ? (
        <pre className="mt-2 max-h-24 overflow-auto rounded border border-sky-100 bg-white/70 p-2 font-mono text-[10px] leading-snug text-sky-950/90">
          {status.python.logTail}
        </pre>
      ) : null}
    </section>
  );
}
