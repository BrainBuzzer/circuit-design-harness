import type { CircuitComponent, CircuitDiagnostic, CircuitDocument } from "./circuit";
import { getComponentCatalogEntry } from "./component-catalog";
import {
  buildSchematicScene,
  type SchematicPrimitive,
  type SchematicScene,
} from "./schematic-geometry";

export interface BomRow {
  readonly quantity: number;
  readonly category: string;
  readonly kind: CircuitComponent["kind"];
  readonly component: string;
  readonly value: string;
  readonly references: readonly string[];
  readonly limitations: string;
}

export interface CircuitSvgOptions {
  readonly transparent?: boolean;
}

export function createBomRows(document: CircuitDocument): readonly BomRow[] {
  const groups = new Map<string, CircuitComponent[]>();
  for (const component of document.components) {
    const key = `${component.kind}\u0000${component.value ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), component]);
  }
  return [...groups.values()]
    .map((components) => {
      const first = components[0];
      if (!first) throw new Error("A BOM group cannot be empty.");
      const catalog = getComponentCatalogEntry(first.kind);
      return {
        quantity: components.length,
        category: catalog.category,
        kind: first.kind,
        component: catalog.label,
        value: first.value ?? "",
        references: components.map((component) => component.reference).sort(),
        limitations: catalog.limitations,
      };
    })
    .sort((left, right) => left.references[0]?.localeCompare(right.references[0] ?? "") ?? 0);
}

export function renderBomCsv(document: CircuitDocument): string {
  const lines = ["quantity,category,kind,component,value,references,limitations"];
  for (const row of createBomRows(document)) {
    lines.push(
      [
        row.quantity,
        row.category,
        row.kind,
        row.component,
        row.value,
        row.references.join(" "),
        row.limitations,
      ]
        .map((value) => csvCell(String(value)))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderBomMarkdown(document: CircuitDocument): string {
  const metadata = document.schematic.metadata;
  const lines = [
    `# ${metadata.title} — bill of materials`,
    "",
    `Circuit revision: ${document.revision}`,
    "",
    "| Qty | References | Component | Value | Catalog kind |",
    "| ---: | --- | --- | --- | --- |",
  ];
  for (const row of createBomRows(document)) {
    lines.push(
      `| ${row.quantity} | ${escapeMarkdown(row.references.join(", "))} | ${escapeMarkdown(row.component)} | ${escapeMarkdown(row.value || "—")} | \`${row.kind}\` |`,
    );
  }
  lines.push(
    "",
    "> This BOM describes logical schematic symbols. Verify manufacturer part numbers, packages, footprints, ratings, tolerances, availability, and safety requirements before procurement or construction.",
    "",
  );
  return lines.join("\n");
}

export function renderDesignReport(
  document: CircuitDocument,
  diagnostics: readonly CircuitDiagnostic[],
): string {
  const metadata = document.schematic.metadata;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return [
    `# ${metadata.title}`,
    "",
    ...(metadata.subtitle ? [`_${metadata.subtitle}_`, ""] : []),
    `- Revision: ${document.revision}`,
    `- Author: ${metadata.author || "Not specified"}`,
    `- Document number: ${metadata.documentNumber || "Not specified"}`,
    `- Components: ${document.components.length}`,
    `- Nets: ${document.nets.length}`,
    `- Structural diagnostics: ${errors.length} errors, ${warnings.length} warnings`,
    "",
    "## Structural diagnostics",
    "",
    ...(diagnostics.length > 0
      ? diagnostics.map(
          (diagnostic) =>
            `- **${diagnostic.severity.toUpperCase()} · ${diagnostic.code}:** ${diagnostic.message}`,
        )
      : ["No structural ERC diagnostics were reported for this revision."]),
    "",
    "## Evidence boundary",
    "",
    "This package is deterministic, revision-scoped publication material. It establishes only the canonical logical topology and the structural diagnostics listed above. It does not establish component ratings, footprint/package correctness, electrical/timing/thermal behavior, physical connectivity, regulatory compliance, or safety. Cite primary datasheets and measured evidence separately.",
    "",
  ].join("\n");
}

export function renderCircuitSvg(
  document: CircuitDocument,
  options: CircuitSvgOptions = {},
): string {
  const scene = buildSchematicScene(document);
  return options.transparent
    ? renderTransparentSvg(document, scene)
    : renderPublicationPageSvg(document, scene);
}

function renderPublicationPageSvg(document: CircuitDocument, scene: SchematicScene): string {
  const metadata = document.schematic.metadata;
  const landscape = metadata.orientation === "landscape";
  const a4 = metadata.paperSize === "a4";
  const physical = a4
    ? landscape
      ? { width: "297mm", height: "210mm" }
      : { width: "210mm", height: "297mm" }
    : landscape
      ? { width: "11in", height: "8.5in" }
      : { width: "8.5in", height: "11in" };
  const page = landscape ? { width: 1120, height: 792 } : { width: 792, height: 1120 };
  const titleHeight = 86;
  const content = { x: 44, y: 44, width: page.width - 88, height: page.height - titleHeight - 100 };
  const scale = Math.min(
    content.width / scene.bounds.width,
    content.height / scene.bounds.height,
    1.45,
  );
  const offsetX =
    content.x + (content.width - scene.bounds.width * scale) / 2 - scene.bounds.x * scale;
  const offsetY =
    content.y + (content.height - scene.bounds.height * scale) / 2 - scene.bounds.y * scale;
  const titleY = page.height - titleHeight - 24;
  const author = metadata.author || "—";
  const docNumber = metadata.documentNumber || "—";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${physical.width}" height="${physical.height}" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-labelledby="schematic-title schematic-description">`,
    publicationStyle(),
    `<title id="schematic-title">${escapeXml(metadata.title)}, revision ${document.revision}</title>`,
    '<desc id="schematic-description">Publication schematic showing logical connectivity. It is not proof of electrical behavior, physical assembly, or safety.</desc>',
    `<rect class="paper" x="0" y="0" width="${page.width}" height="${page.height}"/>`,
    `<rect class="page-border" x="24" y="24" width="${page.width - 48}" height="${page.height - 48}"/>`,
    `<g transform="translate(${n(offsetX)} ${n(offsetY)}) scale(${n(scale)})">`,
    renderScene(scene),
    "</g>",
    `<g class="title-block" transform="translate(24 ${titleY})">`,
    `<rect x="0" y="0" width="${page.width - 48}" height="${titleHeight}"/>`,
    `<line x1="${page.width - 370}" y1="0" x2="${page.width - 370}" y2="${titleHeight}"/>`,
    `<line x1="${page.width - 170}" y1="0" x2="${page.width - 170}" y2="${titleHeight}"/>`,
    `<text class="title" x="16" y="31">${escapeXml(metadata.title)}</text>`,
    `<text class="subtitle" x="16" y="56">${escapeXml(metadata.subtitle || "Logical circuit schematic")}</text>`,
    `<text class="field-label" x="${page.width - 354}" y="20">AUTHOR</text>`,
    `<text class="field-value" x="${page.width - 354}" y="48">${escapeXml(author)}</text>`,
    `<text class="field-label" x="${page.width - 154}" y="20">DOCUMENT / REV</text>`,
    `<text class="field-value" x="${page.width - 154}" y="48">${escapeXml(docNumber)} / ${document.revision}</text>`,
    `<text class="boundary" x="${page.width - 64}" y="70">STRUCTURAL SCHEMATIC · NOT SAFETY APPROVAL</text>`,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

function renderTransparentSvg(document: CircuitDocument, scene: SchematicScene): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(scene.bounds.width)}" height="${n(scene.bounds.height)}" viewBox="${n(scene.bounds.x)} ${n(scene.bounds.y)} ${n(scene.bounds.width)} ${n(scene.bounds.height)}" role="img" aria-labelledby="schematic-title schematic-description">`,
    publicationStyle(),
    `<title id="schematic-title">${escapeXml(document.schematic.metadata.title)}, revision ${document.revision}</title>`,
    '<desc id="schematic-description">Cropped transparent logical circuit schematic for publication.</desc>',
    renderScene(scene),
    "</svg>",
    "",
  ].join("\n");
}

function renderScene(scene: SchematicScene): string {
  return [
    '<g class="wires">',
    ...scene.wires.map((primitive) => renderPrimitive(primitive)),
    "</g>",
    ...scene.components.map((geometry) =>
      [
        `<g class="component" data-reference="${escapeXml(geometry.component.reference)}" transform="translate(${n(geometry.placement.position.x)} ${n(geometry.placement.position.y)}) rotate(${geometry.placement.rotation})">`,
        ...geometry.primitives.map((primitive) =>
          renderPrimitive(primitive, -geometry.placement.rotation),
        ),
        "</g>",
      ].join("\n"),
    ),
  ].join("\n");
}

function renderPrimitive(primitive: SchematicPrimitive, counterRotation = 0): string {
  const className = `${primitive.role}${"fill" in primitive && primitive.fill ? " filled" : ""}`;
  switch (primitive.type) {
    case "line":
      return `<line class="${className}" x1="${n(primitive.x1)}" y1="${n(primitive.y1)}" x2="${n(primitive.x2)}" y2="${n(primitive.y2)}"/>`;
    case "path":
      return `<path class="${className}" d="${primitive.d}"/>`;
    case "circle":
      return `<circle class="${className}" cx="${n(primitive.cx)}" cy="${n(primitive.cy)}" r="${n(primitive.r)}"/>`;
    case "rect":
      return `<rect class="${className}" x="${n(primitive.x)}" y="${n(primitive.y)}" width="${n(primitive.width)}" height="${n(primitive.height)}"${primitive.rx === undefined ? "" : ` rx="${n(primitive.rx)}"`}/>`;
    case "polygon":
      return `<polygon class="${className}" points="${primitive.points.map((point) => `${n(point.x)},${n(point.y)}`).join(" ")}"/>`;
    case "text":
      return `<text class="${primitive.role}" x="${n(primitive.x)}" y="${n(primitive.y)}" text-anchor="${primitive.anchor ?? "middle"}"${counterRotation === 0 ? "" : ` transform="rotate(${counterRotation} ${n(primitive.x)} ${n(primitive.y)})"`}>${escapeXml(primitive.text)}</text>`;
  }
}

function publicationStyle(): string {
  return `<style>
    .paper{fill:#fff}.page-border,.title-block rect,.title-block line{fill:none;stroke:#273044;stroke-width:1.5}
    .symbol,.wire,.junction,.accent,.selection{fill:none;stroke:#273044;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
    .wire{stroke:#344158}.junction.filled{fill:#344158}.symbol.filled{fill:#ffe08a}.accent{stroke:#d85645}.accent.filled{fill:#d85645}
    text{font-family:Inter,Arial,sans-serif;fill:#273044}.reference{font-size:17px;font-weight:650}.value{font-size:13px;font-weight:450}.pin_label{font-size:10px;font-weight:600}.net_label{font-size:11px;font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
    .title-block text{text-anchor:start}.title{font-size:20px;font-weight:700}.subtitle{font-size:12px}.field-label{font-size:9px;font-weight:700;letter-spacing:.08em}.field-value{font-size:12px;font-weight:600}.boundary{font-size:7px;font-weight:600;fill:#6b7280;text-anchor:end}
  </style>`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function n(value: number): string {
  return Number(value.toFixed(4)).toString();
}
