import type { CircuitComponent } from "@domain/circuit";
import { COMPONENT_CATALOG, getComponentCatalogEntry } from "@domain/component-catalog";
import { buildSchematicScene, type SchematicPrimitive } from "@domain/schematic-geometry";
import type { CircuitSnapshot } from "@shared/circuit-contract";
import type { CircuitExportResult, ProjectArchiveResult } from "@shared/export-contract";
import {
  ArchiveIcon,
  BotIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  LibraryIcon,
  PanelRightIcon,
  SearchIcon,
  ShieldCheckIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CircuitEditorProps {
  readonly projectId: string;
  readonly snapshot: CircuitSnapshot | undefined;
  readonly onExport: () => Promise<CircuitExportResult | undefined>;
  readonly onExportArchive: () => Promise<ProjectArchiveResult | undefined>;
}

export function CircuitEditor({
  projectId,
  snapshot,
  onExport,
  onExportArchive,
}: CircuitEditorProps): React.JSX.Element {
  const [selectedComponentId, setSelectedComponentId] = useState<string>();
  const [exportedRevision, setExportedRevision] = useState<number>();
  const [archivedFileCount, setArchivedFileCount] = useState<number>();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [zoom, setZoom] = useState(0.8);
  const [showInspector, setShowInspector] = useState(false);
  const [statusVisible, setStatusVisible] = useState(false);
  const [statusSequence, setStatusSequence] = useState(0);
  const document = snapshot?.document;
  const scene = useMemo(() => (document ? buildSchematicScene(document) : undefined), [document]);
  const selected = document?.components.find((component) => component.id === selectedComponentId);

  useEffect(() => {
    if (statusSequence === 0) return;
    setStatusVisible(true);
    const timeout = window.setTimeout(() => setStatusVisible(false), 4_000);
    return () => window.clearTimeout(timeout);
  }, [statusSequence]);

  return (
    <section
      className="relative flex size-full min-h-0 flex-col bg-[#f7f8fb] text-slate-900"
      aria-label="AI-managed circuit design"
    >
      <div className="flex shrink-0 flex-col border-b border-slate-200 bg-white">
        <div className="flex min-h-10 items-center gap-2 px-3 py-1.5">
          <div className="grid size-8 place-items-center rounded-lg bg-slate-900 text-white">
            <BotIcon className="size-4" />
          </div>
          <h2 className="truncate text-sm font-semibold">AI schematic</h2>
          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800" variant="outline">
            <ShieldCheckIcon data-icon="inline-start" />
            Review only
          </Badge>
          <Button
            aria-label="Export publication package"
            className="ml-auto"
            disabled={!document}
            onClick={() =>
              void onExport().then((result) => {
                setExportedRevision(result?.circuitRevision);
                if (result) setStatusSequence((sequence) => sequence + 1);
              })
            }
            size="sm"
            variant="default"
          >
            <DownloadIcon />
            Export
          </Button>
        </div>
        <div className="flex min-h-9 items-center gap-1 border-t border-slate-100 px-3 py-1">
          <Button
            aria-expanded={showCatalog}
            aria-label="Show AI component catalog"
            onClick={() => setShowCatalog((visible) => !visible)}
            size="xs"
            variant="ghost"
          >
            <LibraryIcon />
            {COMPONENT_CATALOG.length} symbols
          </Button>
          {snapshot?.diagnostics.length ? (
            <Button
              aria-expanded={showDiagnostics}
              aria-label={`${snapshot?.diagnostics.length ?? 0} structural diagnostics`}
              onClick={() => setShowDiagnostics((visible) => !visible)}
              size="xs"
              variant="ghost"
            >
              <CircleAlertIcon />
              {snapshot?.diagnostics.length}
            </Button>
          ) : (
            <Badge className="border-slate-200 bg-white text-slate-600" variant="outline">
              <CheckCircle2Icon data-icon="inline-start" />
              ERC clear
            </Badge>
          )}
          <Button
            aria-label="Zoom out schematic"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}
            size="icon-sm"
            variant="ghost"
          >
            <ZoomOutIcon />
          </Button>
          <span className="w-10 text-center text-[11px] tabular-nums text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            aria-label="Zoom in schematic"
            disabled={zoom >= 1.6}
            onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.1).toFixed(1))))}
            size="icon-sm"
            variant="ghost"
          >
            <ZoomInIcon />
          </Button>
          <Button
            aria-label="Export portable project archive"
            disabled={!document}
            onClick={() =>
              void onExportArchive().then((result) => {
                setArchivedFileCount(result?.fileCount);
                if (result) setStatusSequence((sequence) => sequence + 1);
              })
            }
            size="icon-sm"
            title="Archive chat, design, evidence, captures, and history"
            variant="ghost"
          >
            <ArchiveIcon />
          </Button>
          <Button
            aria-label="Toggle schematic inspector"
            aria-pressed={showInspector}
            onClick={() => setShowInspector((visible) => !visible)}
            size="icon-sm"
            variant="ghost"
          >
            <PanelRightIcon />
          </Button>
        </div>
      </div>

      {statusVisible && (exportedRevision !== undefined || archivedFileCount !== undefined) && (
        <div
          aria-live="polite"
          className="absolute top-[78px] right-3 z-20 rounded-md border border-emerald-200 bg-emerald-50/95 px-2.5 py-1.5 text-[10px] font-medium text-emerald-900 shadow-sm"
          role="status"
        >
          {exportedRevision !== undefined && <span>Exported revision {exportedRevision}</span>}
          {exportedRevision !== undefined && archivedFileCount !== undefined && <span> · </span>}
          {archivedFileCount !== undefined && (
            <span>Archived {archivedFileCount} project files</span>
          )}
        </div>
      )}

      {showCatalog && (
        <div className="max-h-40 overflow-auto border-b border-slate-200 bg-white px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-700">
            <LibraryIcon className="size-3.5" />
            Agent component catalog
            <span className="font-normal text-slate-500">
              Structural symbols only; ratings and footprints remain evidence-backed fields.
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-1.5">
            {COMPONENT_CATALOG.map((entry) => (
              <div
                className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5"
                key={entry.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{entry.label}</span>
                  <code className="text-[9px] text-slate-500">{entry.id}</code>
                </div>
                <p className="truncate text-[10px] text-slate-500">
                  {entry.category} · {entry.pins.length} pin{entry.pins.length === 1 ? "" : "s"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {showDiagnostics && snapshot && snapshot.diagnostics.length > 0 && (
        <div
          className="max-h-28 overflow-auto border-b border-amber-200 bg-amber-50 px-3 py-2"
          role="status"
        >
          <ul className="space-y-1 text-xs text-amber-950">
            {snapshot.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.message}`}>
                <Badge className="mr-2 border-amber-300 bg-white text-amber-900" variant="outline">
                  {diagnostic.severity}
                </Badge>
                {diagnostic.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className={`grid min-h-0 flex-1 ${showInspector ? "grid-cols-[minmax(0,1fr)_minmax(160px,26%)]" : "grid-cols-1"}`}
      >
        <div className="relative min-h-0 overflow-auto bg-[#eef1f5] p-4">
          {!document || !scene ? (
            <div className="grid size-full place-items-center text-sm text-slate-500">
              Loading canonical circuit…
            </div>
          ) : document.components.length === 0 ? (
            <div className="grid size-full place-items-center">
              <div className="max-w-sm rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                <BotIcon className="mx-auto mb-3 size-7 text-slate-700" />
                <h3 className="text-sm font-semibold">Ask Pi to create the circuit</h3>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Describe the behavior, constraints, parts on hand, and publication metadata in
                  chat. Pi will use the component catalog, stage a typed proposal, and wait for your
                  approval.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="mx-auto rounded-sm border border-slate-300 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] transition-[width,min-height] duration-200 motion-reduce:transition-none"
              style={{
                width: `${scene.bounds.width * zoom}px`,
                minHeight: `${scene.bounds.height * zoom}px`,
              }}
            >
              <svg
                aria-label={`Publication schematic for project ${projectId}`}
                className="block size-full"
                role="img"
                viewBox={`${scene.bounds.x} ${scene.bounds.y} ${scene.bounds.width} ${scene.bounds.height}`}
              >
                <title>{document.schematic.metadata.title}</title>
                <g className="fill-none stroke-[#344158] [stroke-linecap:round] [stroke-linejoin:round]">
                  {keyedPrimitives(scene.wires).map(({ key, primitive }) => (
                    <Primitive key={key} primitive={primitive} />
                  ))}
                </g>
                {scene.components.map((geometry) => (
                  // biome-ignore lint/a11y/useSemanticElements: SVG schematic groups cannot be HTML buttons.
                  <g
                    aria-label={`${geometry.component.reference}, ${getComponentCatalogEntry(geometry.component.kind).label}`}
                    className="group cursor-pointer outline-none focus-visible:[&_.selection]:stroke-blue-600"
                    key={geometry.component.id}
                    onClick={() => {
                      setSelectedComponentId(geometry.component.id);
                      setShowInspector(true);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedComponentId(geometry.component.id);
                        setShowInspector(true);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    transform={`translate(${geometry.placement.position.x} ${geometry.placement.position.y}) rotate(${geometry.placement.rotation})`}
                  >
                    {selectedComponentId === geometry.component.id && (
                      <rect
                        className="selection fill-blue-50/30 stroke-blue-500 [stroke-dasharray:5_4]"
                        height="132"
                        rx="8"
                        width="142"
                        x="-71"
                        y="-66"
                      />
                    )}
                    {keyedPrimitives(geometry.primitives).map(({ key, primitive }) => (
                      <Primitive
                        counterRotation={-geometry.placement.rotation}
                        key={`${geometry.component.id}:${key}`}
                        primitive={primitive}
                      />
                    ))}
                    {Object.entries(geometry.localPins).map(([pinId, point]) => (
                      <circle
                        className="fill-white stroke-[#344158] opacity-0 transition-opacity group-hover:opacity-100"
                        cx={point.x}
                        cy={point.y}
                        key={pinId}
                        r="3"
                      />
                    ))}
                  </g>
                ))}
              </svg>
            </div>
          )}
        </div>

        {showInspector && (
          <aside
            className="min-h-0 overflow-auto border-l border-slate-200 bg-white p-3"
            aria-label="Schematic inspector"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <SearchIcon className="size-3.5" />
              Inspector
            </div>
            {selected ? (
              <ComponentInspector component={selected} />
            ) : (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Select a symbol to inspect stable IDs, pins, and limitations. Design changes are
                made only through agent proposals in chat.
              </p>
            )}
            <div className="mt-5 border-t border-slate-200 pt-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <FileTextIcon className="size-3.5" />
                Publication
              </div>
              <dl className="mt-2 space-y-2 text-[11px]">
                <InspectorRow label="Title" value={document?.schematic.metadata.title ?? "—"} />
                <InspectorRow
                  label="Author"
                  value={document?.schematic.metadata.author || "Not set"}
                />
                <InspectorRow
                  label="Document"
                  value={document?.schematic.metadata.documentNumber || "Not set"}
                />
                <InspectorRow
                  label="Format"
                  value={
                    document
                      ? `${document.schematic.metadata.paperSize.toUpperCase()} · ${document.schematic.metadata.orientation}`
                      : "—"
                  }
                />
                <InspectorRow label="Revision" value={String(document?.revision ?? "—")} />
              </dl>
              {exportedRevision !== undefined && (
                <p className="mt-3 rounded-md bg-emerald-50 px-2 py-1.5 text-[10px] text-emerald-800">
                  Exported revision {exportedRevision}: page SVG, transparent SVG, BOM CSV/Markdown,
                  design report, and canonical JSON.
                </p>
              )}
              {archivedFileCount !== undefined && (
                <p className="mt-2 text-[10px] text-slate-500">
                  Archived {archivedFileCount} project files.
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function ComponentInspector({
  component,
}: {
  readonly component: CircuitComponent;
}): React.JSX.Element {
  const entry = getComponentCatalogEntry(component.kind);
  return (
    <div className="mt-3 space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">{component.reference}</span>
          <Badge className="border-slate-200 bg-slate-50 text-slate-700" variant="outline">
            {entry.label}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">{component.value ?? "No value recorded"}</p>
      </div>
      <dl className="space-y-2 text-[11px]">
        <InspectorRow label="Kind ID" value={component.kind} mono />
        <InspectorRow label="Component ID" value={component.id} mono />
        {component.modelId && <InspectorRow label="Model ID" value={component.modelId} mono />}
      </dl>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Stable pins
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {component.pins.map((pin) => (
            <code
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px]"
              key={pin.id}
            >
              {pin.id} · {pin.name}
            </code>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[10px] leading-4 text-amber-950">
        {entry.limitations}
      </div>
    </div>
  );
}

function InspectorRow({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`min-w-0 break-words text-slate-800 ${mono ? "font-mono text-[9px]" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function Primitive({
  primitive,
  counterRotation = 0,
}: {
  readonly primitive: SchematicPrimitive;
  readonly counterRotation?: number;
}): React.JSX.Element {
  const stroke = primitive.role === "accent" ? "#d85645" : "#344158";
  const common = {
    stroke,
    strokeWidth: primitive.role === "wire" ? 2.4 : 2.2,
    vectorEffect: "non-scaling-stroke" as const,
  };
  const filled = "fill" in primitive && primitive.fill;
  switch (primitive.type) {
    case "line":
      return (
        <line {...common} x1={primitive.x1} x2={primitive.x2} y1={primitive.y1} y2={primitive.y2} />
      );
    case "path":
      return (
        <path
          {...common}
          d={primitive.d}
          fill={filled ? (primitive.role === "accent" ? "#d85645" : "#ffe08a") : "none"}
        />
      );
    case "circle":
      return (
        <circle
          {...common}
          cx={primitive.cx}
          cy={primitive.cy}
          fill={filled ? stroke : "white"}
          r={primitive.r}
        />
      );
    case "rect":
      return (
        <rect
          {...common}
          fill={filled ? "#fff7d6" : "white"}
          height={primitive.height}
          rx={primitive.rx}
          width={primitive.width}
          x={primitive.x}
          y={primitive.y}
        />
      );
    case "polygon":
      return (
        <polygon
          {...common}
          fill={filled ? (primitive.role === "accent" ? "#d85645" : "#ffe08a") : "white"}
          points={primitive.points.map((point) => `${point.x},${point.y}`).join(" ")}
        />
      );
    case "text": {
      const className =
        primitive.role === "reference"
          ? "text-[17px] font-semibold"
          : primitive.role === "value"
            ? "text-[12px]"
            : primitive.role === "net_label"
              ? "text-[10px] font-semibold [paint-order:stroke] stroke-white [stroke-width:4px]"
              : "text-[9px] font-medium";
      return (
        <text
          className={`${className} fill-[#273044] stroke-none`}
          textAnchor={primitive.anchor ?? "middle"}
          transform={
            counterRotation === 0
              ? undefined
              : `rotate(${counterRotation} ${primitive.x} ${primitive.y})`
          }
          x={primitive.x}
          y={primitive.y}
        >
          {primitive.text}
        </text>
      );
    }
  }
}

function keyedPrimitives(
  primitives: readonly SchematicPrimitive[],
): readonly { readonly key: string; readonly primitive: SchematicPrimitive }[] {
  const counts = new Map<string, number>();
  return primitives.map((primitive) => {
    const base = JSON.stringify(primitive);
    const occurrence = counts.get(base) ?? 0;
    counts.set(base, occurrence + 1);
    return { key: `${base}:${occurrence}`, primitive };
  });
}
