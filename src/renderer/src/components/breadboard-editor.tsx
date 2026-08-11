import type { BreadboardHole } from "@domain/assembly";
import type { AssemblySnapshot } from "@shared/assembly-contract";
import type { CircuitSnapshot } from "@shared/circuit-contract";
import { BotIcon, CableIcon, CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";

const ROWS = [
  "top+",
  "top-",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "bottom+",
  "bottom-",
] as const;
const COLUMNS = Array.from({ length: 30 }, (_, index) => index + 1);

export function BreadboardEditor({
  assembly,
  circuit,
}: {
  readonly assembly: AssemblySnapshot | undefined;
  readonly circuit: CircuitSnapshot | undefined;
}): React.JSX.Element {
  const document = assembly?.document;
  const circuitDocument = circuit?.document;
  const occupied = useMemo(() => {
    const holes = new Map<string, string>();
    for (const placement of document?.placements ?? []) {
      const reference = circuitDocument?.components.find(
        (candidate) => candidate.id === placement.componentId,
      )?.reference;
      for (const pin of placement.pins) {
        holes.set(pin.hole, `${reference ?? "?"}.${pin.pinId}`);
      }
    }
    for (const [index, jumper] of (document?.jumpers ?? []).entries()) {
      holes.set(jumper.from, `J${index + 1}`);
      holes.set(jumper.to, `J${index + 1}`);
    }
    return holes;
  }, [circuitDocument, document]);

  return (
    <section
      className="flex size-full min-h-0 flex-col bg-[#f7f8fb] text-slate-900"
      aria-label="AI-managed breadboard assembly"
    >
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
        <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white">
          <BotIcon className="size-4" />
        </div>
        <h2 className="text-sm font-semibold">AI breadboard map</h2>
        <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
          <ShieldCheckIcon data-icon="inline-start" />
          Review only
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {assembly?.diagnostics.length ? (
            <Badge className="border-amber-200 bg-amber-50 text-amber-900" variant="outline">
              <CircleAlertIcon /> {assembly.diagnostics.length}
            </Badge>
          ) : null}
          <span className="text-xs text-slate-500">
            Assembly rev {document?.revision ?? "…"} · circuit rev{" "}
            {document?.circuitRevision ?? "…"}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-2 flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[11px] text-blue-950">
          <CableIcon className="size-3.5 shrink-0" />
          Ask Pi to place pins or add jumpers. Every build-map transaction is validated and waits
          for explicit approval.
        </div>
        <div className="min-w-[960px] rounded-xl border border-slate-300 bg-[#f5f1e8] p-3 shadow-sm">
          <svg
            aria-label="Thirty-column solderless breadboard"
            className="h-auto w-full"
            role="img"
            viewBox="0 0 960 420"
          >
            <title>Solderless breadboard holes</title>
            {ROWS.flatMap((row, rowIndex) =>
              COLUMNS.map((column) => {
                const hole = `${row}${column}` as BreadboardHole;
                const x = 30 + column * 29;
                const y = 24 + rowIndex * 28 + (rowIndex > 6 ? 12 : 0);
                const label = occupied.get(hole);
                return (
                  <g aria-label={`${hole}${label ? ` occupied by ${label}` : " empty"}`} key={hole}>
                    <circle
                      className={
                        label ? "fill-amber-400 stroke-amber-800" : "fill-white stroke-slate-500"
                      }
                      cx={x}
                      cy={y}
                      r="7"
                    />
                    {label && (
                      <title>
                        {hole} occupied by {label}
                      </title>
                    )}
                    {column === 1 && (
                      <text className="fill-slate-600 text-[9px]" x="3" y={y + 3}>
                        {row}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        </div>
        {assembly?.diagnostics.length ? (
          <div className="mt-2 space-y-1" role="status">
            {assembly.diagnostics.map((diagnostic) => (
              <p
                className="text-xs text-slate-600"
                key={`${diagnostic.code}:${diagnostic.paths.join()}`}
              >
                {diagnostic.message}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
