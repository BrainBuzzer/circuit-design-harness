import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const esphomeRef = process.env.ESPHOME_REF || "dev";
const docsRef = process.env.ESPHOME_DOCS_REF || "current";
const outputPath = path.resolve("src/catalog/esphome-components.json");
const platformModules = new Set([
  "alarm_control_panel",
  "binary_sensor",
  "button",
  "climate",
  "cover",
  "date",
  "datetime",
  "display",
  "event",
  "fan",
  "light",
  "lock",
  "media_player",
  "number",
  "output",
  "select",
  "sensor",
  "switch",
  "text",
  "text_sensor",
  "time",
  "update",
  "valve",
]);

const [sourceTree, docsTree] = await Promise.all([
  githubTree("esphome/esphome", esphomeRef),
  githubTree("esphome/esphome-docs", docsRef),
]);
const boardsSource = await fetchText(
  `https://raw.githubusercontent.com/esphome/esphome/${sourceTree.sha}/esphome/components/esp32/boards.py`,
);
const components = new Map();
for (const item of sourceTree.tree) {
  const match = /^esphome\/components\/([^/]+)\/([^/]+\.py)$/.exec(item.path);
  if (!match) {
    continue;
  }
  const [, name = "", filename = ""] = match;
  const entry = components.get(name) || { name, pythonModules: [], platforms: [] };
  entry.pythonModules.push(filename);
  const moduleName = filename.replace(/\.py$/, "");
  if (platformModules.has(moduleName)) {
    entry.platforms.push(moduleName);
  }
  components.set(name, entry);
}

const docs = docsTree.tree
  .map((item) => item.path)
  .filter((itemPath) => /^src\/content\/docs\/components\/.+\.mdx$/.test(itemPath));
const records = [...components.values()]
  .map((entry) => ({
    name: entry.name,
    platforms: [...new Set(entry.platforms)].sort(),
    pythonModules: [...new Set(entry.pythonModules)].sort(),
    sourceUrl: `https://github.com/esphome/esphome/tree/${sourceTree.sha}/esphome/components/${entry.name}`,
    documentationUrls: matchingDocs(entry.name, docs).map(toDocumentationUrl),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      esphomeCommit: sourceTree.sha,
      documentationCommit: docsTree.sha,
      componentCount: records.length,
      esp32Boards: parseEsp32Boards(boardsSource),
      components: records,
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${records.length} ESPHome components to ${outputPath}`);

async function githubTree(repository, ref) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json", "User-Agent": "circuit-design-harness" } },
  );
  if (!response.ok) {
    throw new Error(`GitHub tree request failed for ${repository}@${ref}: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.truncated || !payload.sha || !Array.isArray(payload.tree)) {
    throw new Error(`GitHub returned an incomplete tree for ${repository}@${ref}.`);
  }
  return payload;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": "circuit-design-harness" } });
  if (!response.ok) {
    throw new Error(`Source request failed: HTTP ${response.status}`);
  }
  return response.text();
}

function parseEsp32Boards(source) {
  const boardBlock = source.slice(source.indexOf("BOARDS = {"));
  const boards = [];
  const entryPattern = /^ {4}"([^"]+)": \{\n([\s\S]*?)^ {4}\},/gm;
  for (const match of boardBlock.matchAll(entryPattern)) {
    const id = match[1] || "";
    const body = match[2] || "";
    const name = /^ {8}"name": "([^"]+)"/m.exec(body)?.[1] || id;
    const variantConstant = /^ {8}"variant": VARIANT_([A-Z0-9]+)/m.exec(body)?.[1];
    if (!id || !variantConstant) {
      continue;
    }
    boards.push({
      id,
      name,
      target: variantConstant.toLowerCase(),
    });
  }
  return boards.sort((left, right) => left.id.localeCompare(right.id));
}

function matchingDocs(name, docsPaths) {
  return docsPaths.filter((docsPath) => {
    const relative = docsPath.replace("src/content/docs/components/", "");
    const segments = relative.split("/");
    const baseName = segments.at(-1)?.replace(/\.mdx$/, "");
    return relative === `${name}.mdx` || relative === `${name}/index.mdx` || baseName === name;
  });
}

function toDocumentationUrl(docsPath) {
  let relative = docsPath.replace("src/content/docs/", "").replace(/\.mdx$/, "");
  relative = relative.replace(/\/index$/, "");
  return `https://esphome.io/${relative}/`;
}
