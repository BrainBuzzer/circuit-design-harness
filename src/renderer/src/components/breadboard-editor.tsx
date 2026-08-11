import { type BreadboardHole, buildBreadboardOccupancy } from "@domain/assembly";
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

const JUMPER_COLORS: Record<string, string> = {
  black: "#1e293b",
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#ca8a04",
  green: "#16a34a",
  blue: "#2563eb",
  violet: "#7c3aed",
  white: "#e2e8f0",
};

export function BreadboardEditor({
  assembly,
  circuit,
}: {
  readonly assembly: AssemblySnapshot | undefined;
  readonly circuit: CircuitSnapshot | undefined;
}): React.JSX.Element {
  const document = assembly?.document;
  const circuitDocument = circuit?.document;
  const holePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    for (const [rowIndex, row] of ROWS.entries()) {
      for (const column of COLUMNS) {
        const hole = `${row}${column}`;
        positions.set(hole, {
          x: 30 + column * 29,
          y: 24 + rowIndex * 28 + (rowIndex > 6 ? 12 : 0),
        });
      }
    }
    return positions;
  }, []);

  const occupied = useMemo(() => {
    if (!document || !circuitDocument) {
      return new Map<string, string>();
    }
    return buildBreadboardOccupancy(document, circuitDocument);
  }, [circuitDocument, document]);

  const jumpers = document?.jumpers ?? [];
  const placementCount = document?.placements.length ?? 0;

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
            {placementCount} part(s) · {jumpers.length} jumper(s) · assembly rev{" "}
            {document?.revision ?? "…"} · circuit rev {document?.circuitRevision ?? "…"}
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
            {jumpers.map((jumper, index) => {
              const from = holePositions.get(jumper.from);
              const to = holePositions.get(jumper.to);
              if (!from || !to) return null;
              return (
                <line
                  key={jumper.id}
                  aria-label={`Jumper J${index + 1} ${jumper.color} from ${jumper.from} to ${jumper.to}`}
                  stroke={JUMPER_COLORS[jumper.color] ?? "#334155"}
                  strokeLinecap="round"
                  strokeWidth="3"
                  x1={from.x}
                  x2={to.x}
                  y1={from.y}
                  y2={to.y}
                />
              );
            })}
            {ROWS.flatMap((row, rowIndex) =>
              COLUMNS.map((column) => {
                const hole = `${row}${column}` as BreadboardHole;
                const position = holePositions.get(hole) ?? {
                  x: 30 + column * 29,
                  y: 24 + rowIndex * 28 + (rowIndex > 6 ? 12 : 0),
                };
                const label = occupied.get(hole);
                return (
                  <g aria-label={`${hole}${label ? ` occupied by ${label}` : " empty"}`} key={hole}>
                    <circle
                      className={
                        label ? "fill-amber-400 stroke-amber-800" : "fill-white stroke-slate-500"
                      }
                      cx={position.x}
                      cy={position.y}
                      r="7"
                    />
                    {label && (
                      <title>
                        {hole} occupied by {label}
                      </title>
                    )}
                    {column === 1 && (
                      <text className="fill-slate-600 text-[9px]" x="3" y={position.y + 3}>
                        {row}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        </div>
        {jumpers.length > 0 ? (
          <ul className="mt-2 grid gap-1 text-[11px] text-slate-600" aria-label="Jumper list">
            {jumpers.map((jumper, index) => (
              <li key={jumper.id}>
                J{index + 1}: {jumper.color} {jumper.from} → {jumper.to}
              </li>
            ))}
          </ul>
        ) : null}
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
