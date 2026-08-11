import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import {
  type AttachmentRecord,
  AttachmentRecordSchema,
  type TrashedAttachment,
  TrashedAttachmentSchema,
} from "@domain/attachment";
import { writeFileAtomic, writeJsonAtomic } from "./json-file";
import { resolveExistingProjectPath } from "./project-path";
import type { ProjectService } from "./project-service";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MAX_EXTRACTED_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_RENDERED_PAGE_BYTES = 200 * 1024 * 1024;

interface DetectedMedia {
  readonly mediaKind: AttachmentRecord["mediaKind"];
  readonly mimeType: AttachmentRecord["mimeType"];
  readonly extension: string;
}

export class AttachmentService {
  constructor(private readonly projects: ProjectService) {}

  async importFiles(
    projectId: string,
    sourcePaths: readonly string[],
  ): Promise<readonly AttachmentRecord[]> {
    if (sourcePaths.length > 20) {
      throw new Error("Import at most 20 attachments at once.");
    }
    const records: AttachmentRecord[] = [];
    for (const sourcePath of sourcePaths) {
      records.push(await this.importFile(projectId, sourcePath));
    }
    return records;
  }

  async list(projectId: string): Promise<readonly AttachmentRecord[]> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const extractedRoot = path.join(projectDirectory, "attachments", "extracted");
    const entries = await readdir(extractedRoot, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) =>
          AttachmentRecordSchema.parse(
            JSON.parse(
              await readFile(path.join(extractedRoot, entry.name, "manifest.json"), "utf8"),
            ),
          ),
        ),
    );
    return records
      .filter((record) => record.projectId === projectId)
      .sort((left, right) => left.importedAt.localeCompare(right.importedAt));
  }

  async buildPromptEvidence(
    projectId: string,
    attachmentIds: readonly string[],
    query = "",
  ): Promise<{
    readonly text: string;
    readonly images: readonly { readonly data: string; readonly mimeType: string }[];
  }> {
    const selected = new Set(attachmentIds);
    const records = (await this.list(projectId)).filter((record) => selected.has(record.id));
    if (records.length !== selected.size) {
      throw new Error("One or more selected attachments do not belong to the active project.");
    }

    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const candidates: {
      readonly label: string;
      readonly text: string;
      readonly score: number;
      readonly order: number;
    }[] = [];
    const images: { data: string; mimeType: string }[] = [];
    const queryTerms = tokenize(query);

    for (const [recordIndex, record] of records.entries()) {
      if (record.mediaKind === "image") {
        const bytes = await readFile(
          await resolveExistingProjectPath(projectDirectory, record.originalRelativePath),
        );
        if (bytes.byteLength > 8 * 1024 * 1024) {
          throw new Error(`${record.originalName} is too large to send as an image.`);
        }
        images.push({ data: bytes.toString("base64"), mimeType: record.mimeType });
        continue;
      }

      for (const page of record.pages) {
        const text = await readFile(
          await resolveExistingProjectPath(projectDirectory, page.textRelativePath),
          "utf8",
        );
        for (const [chunkIndex, chunk] of chunkText(text).entries()) {
          candidates.push({
            label: `[attachment ${record.id}, ${record.originalName}, page ${page.pageNumber}, excerpt ${chunkIndex + 1}${page.extractionMethod === "ocr" ? `, OCR ${Math.round((page.ocrConfidence ?? 0) * 100)}%` : ""}]`,
            text: chunk,
            score: relevanceScore(chunk, queryTerms, query),
            order: recordIndex * 1_000_000 + page.pageNumber * 1_000 + chunkIndex,
          });
        }
      }
    }

    const ranked = [...candidates].sort(
      (left, right) => right.score - left.score || left.order - right.order,
    );
    const selectedCandidates = queryTerms.length
      ? ranked.filter((candidate) => candidate.score > 0).slice(0, 12)
      : ranked.slice(0, 12);
    const fallback = selectedCandidates.length > 0 ? selectedCandidates : ranked.slice(0, 4);
    let remainingCharacters = 80_000;
    const evidenceSections: string[] = [];
    for (const candidate of fallback) {
      if (remainingCharacters <= 0) {
        break;
      }
      const excerpt = candidate.text.slice(0, remainingCharacters);
      remainingCharacters -= excerpt.length;
      evidenceSections.push(`${candidate.label}\n${excerpt}`);
    }

    return {
      text: evidenceSections.filter(Boolean).join("\n\n"),
      images,
    };
  }

  async getPageImage(
    projectId: string,
    attachmentId: string,
    pageNumber: number,
  ): Promise<{ readonly jpegBytes: Uint8Array; readonly mimeType: "image/jpeg" }> {
    const record = (await this.list(projectId)).find(
      (attachment) => attachment.id === attachmentId,
    );
    const page = record?.pages.find((candidate) => candidate.pageNumber === pageNumber);
    if (!record || !page?.imageRelativePath) {
      throw new Error("That rendered attachment page is not available in this project.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    return {
      jpegBytes: new Uint8Array(
        await readFile(await resolveExistingProjectPath(projectDirectory, page.imageRelativePath)),
      ),
      mimeType: "image/jpeg",
    };
  }

  async trash(projectId: string, attachmentId: string): Promise<readonly AttachmentRecord[]> {
    const record = (await this.list(projectId)).find((candidate) => candidate.id === attachmentId);
    if (!record) {
      throw new Error("That attachment is not available in the active project.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const originalPath = await resolveExistingProjectPath(
      projectDirectory,
      record.originalRelativePath,
    );
    const extractedPath = await resolveExistingProjectPath(
      projectDirectory,
      path.posix.join("attachments", "extracted", record.id),
    );
    const trashId = randomUUID();
    const trashRoot = path.join(projectDirectory, "trash", "attachments");
    const stagingDirectory = path.join(trashRoot, `.${trashId}.deleting`);
    const finalDirectory = path.join(trashRoot, trashId);
    const storedOriginalName = `original${path.extname(record.originalRelativePath)}`;
    const trashed = TrashedAttachmentSchema.parse({
      schemaVersion: 1,
      trashId,
      projectId,
      deletedAt: new Date().toISOString(),
      storedOriginalName,
      record,
    });
    let movedOriginal = false;
    let movedExtracted = false;

    try {
      await mkdir(trashRoot, { recursive: true, mode: 0o700 });
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      await writeJsonAtomic(path.join(stagingDirectory, "manifest.json"), trashed);
      await rename(originalPath, path.join(stagingDirectory, storedOriginalName));
      movedOriginal = true;
      await rename(extractedPath, path.join(stagingDirectory, "extracted"));
      movedExtracted = true;
      await rename(stagingDirectory, finalDirectory);
    } catch (reason) {
      if (movedExtracted) {
        await rename(path.join(stagingDirectory, "extracted"), extractedPath).catch(
          () => undefined,
        );
      }
      if (movedOriginal) {
        await rename(path.join(stagingDirectory, storedOriginalName), originalPath).catch(
          () => undefined,
        );
      }
      await rm(stagingDirectory, { recursive: true, force: true });
      throw reason;
    }
    return this.list(projectId);
  }

  async listTrashed(projectId: string): Promise<readonly TrashedAttachment[]> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const trashRoot = path.join(projectDirectory, "trash", "attachments");
    let entries: Dirent[];
    try {
      entries = await readdir(trashRoot, { withFileTypes: true });
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw reason;
    }
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) =>
          TrashedAttachmentSchema.parse(
            JSON.parse(await readFile(path.join(trashRoot, entry.name, "manifest.json"), "utf8")),
          ),
        ),
    );
    return records
      .filter((record) => record.projectId === projectId)
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
  }

  async restore(projectId: string, trashId: string): Promise<readonly AttachmentRecord[]> {
    const trashed = (await this.listTrashed(projectId)).find(
      (candidate) => candidate.trashId === trashId,
    );
    if (!trashed) {
      throw new Error("That deleted attachment is no longer available for recovery.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const trashRoot = path.join(projectDirectory, "trash", "attachments");
    const finalTrashDirectory = path.join(trashRoot, trashId);
    const stagingTrashDirectory = path.join(trashRoot, `.${trashId}.restoring`);
    const originalDestination = path.join(
      projectDirectory,
      ...trashed.record.originalRelativePath.split("/"),
    );
    const extractedDestination = path.join(
      projectDirectory,
      "attachments",
      "extracted",
      trashed.record.id,
    );
    if ((await pathExists(originalDestination)) || (await pathExists(extractedDestination))) {
      throw new Error("A conflicting attachment already occupies the restore destination.");
    }
    let movedOriginal = false;
    let movedExtracted = false;

    await rename(finalTrashDirectory, stagingTrashDirectory);
    try {
      await rename(
        path.join(stagingTrashDirectory, trashed.storedOriginalName),
        originalDestination,
      );
      movedOriginal = true;
      await rename(path.join(stagingTrashDirectory, "extracted"), extractedDestination);
      movedExtracted = true;
      await rm(stagingTrashDirectory, { recursive: true, force: true });
    } catch (reason) {
      if (movedExtracted) {
        await rename(extractedDestination, path.join(stagingTrashDirectory, "extracted")).catch(
          () => undefined,
        );
      }
      if (movedOriginal) {
        await rename(
          originalDestination,
          path.join(stagingTrashDirectory, trashed.storedOriginalName),
        ).catch(() => undefined);
      }
      await rename(stagingTrashDirectory, finalTrashDirectory).catch(() => undefined);
      throw reason;
    }
    return this.list(projectId);
  }

  async reindex(projectId: string, attachmentId: string): Promise<readonly AttachmentRecord[]> {
    const record = (await this.list(projectId)).find((candidate) => candidate.id === attachmentId);
    if (!record) {
      throw new Error("That attachment is not available in the active project.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const originalPath = await resolveExistingProjectPath(
      projectDirectory,
      record.originalRelativePath,
    );
    const originalStats = await stat(originalPath);
    if (
      originalStats.size !== record.byteSize ||
      (await hashFile(originalPath)) !== record.sha256
    ) {
      throw new Error("The immutable attachment original changed; re-import it instead.");
    }
    const media = await detectMedia(originalPath);
    if (media.mediaKind !== record.mediaKind || media.mimeType !== record.mimeType) {
      throw new Error("The attachment content type no longer matches its manifest.");
    }
    const extractedRoot = path.join(projectDirectory, "attachments", "extracted");
    const finalDirectory = path.join(extractedRoot, record.id);
    const stagingDirectory = path.join(extractedRoot, `.${record.id}.${randomUUID()}.reindexing`);
    const backupDirectory = path.join(extractedRoot, `.${record.id}.${randomUUID()}.backup`);
    let movedCurrent = false;

    try {
      await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
      const pages = await this.extractText(media, originalPath, stagingDirectory, record.id);
      const refreshed = AttachmentRecordSchema.parse({ ...record, pages });
      await writeJsonAtomic(path.join(stagingDirectory, "manifest.json"), refreshed);
      await rename(finalDirectory, backupDirectory);
      movedCurrent = true;
      await rename(stagingDirectory, finalDirectory);
      movedCurrent = false;
      await rm(backupDirectory, { recursive: true, force: true }).catch(() => undefined);
    } catch (reason) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (movedCurrent && !(await pathExists(finalDirectory))) {
        await rename(backupDirectory, finalDirectory).catch(() => undefined);
      }
      await rm(backupDirectory, { recursive: true, force: true });
      throw reason;
    }
    return this.list(projectId);
  }

  private async importFile(projectId: string, sourcePath: string): Promise<AttachmentRecord> {
    const sourceStats = await stat(sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error("Only regular files can be attached.");
    }
    if (sourceStats.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachments are limited to 25 MB each.");
    }

    const media = await detectMedia(sourcePath);
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const attachmentId = randomUUID();
    const originalRelativePath = path.posix.join(
      "attachments",
      "originals",
      `${attachmentId}${media.extension}`,
    );
    const originalPath = path.join(projectDirectory, originalRelativePath);
    const temporaryOriginalPath = `${originalPath}.${randomUUID()}.tmp`;
    const extractedRoot = path.join(projectDirectory, "attachments", "extracted");
    const finalExtractedDirectory = path.join(extractedRoot, attachmentId);
    const stagingExtractedDirectory = path.join(
      extractedRoot,
      `.${attachmentId}.${randomUUID()}.importing`,
    );

    try {
      await mkdir(stagingExtractedDirectory, { recursive: false, mode: 0o700 });
      await copyFile(sourcePath, temporaryOriginalPath);
      await rename(temporaryOriginalPath, originalPath);
      const pages = await this.extractText(
        media,
        originalPath,
        stagingExtractedDirectory,
        attachmentId,
      );
      const record = AttachmentRecordSchema.parse({
        schemaVersion: 1,
        id: attachmentId,
        projectId,
        originalName: path.basename(sourcePath),
        mediaKind: media.mediaKind,
        mimeType: media.mimeType,
        byteSize: sourceStats.size,
        sha256: await hashFile(originalPath),
        originalRelativePath,
        importedAt: new Date().toISOString(),
        pages,
      });
      await writeJsonAtomic(path.join(stagingExtractedDirectory, "manifest.json"), record);
      await rename(stagingExtractedDirectory, finalExtractedDirectory);
      return record;
    } catch (reason) {
      await Promise.all([
        rm(temporaryOriginalPath, { force: true }),
        rm(originalPath, { force: true }),
        rm(stagingExtractedDirectory, { recursive: true, force: true }),
      ]);
      throw reason;
    }
  }

  private async extractText(
    media: DetectedMedia,
    originalPath: string,
    extractedDirectory: string,
    attachmentId: string,
  ): Promise<AttachmentRecord["pages"]> {
    if (media.mediaKind === "image") {
      return [];
    }

    let pageTexts: readonly string[];
    let renderedPagePaths: readonly string[] = [];
    if (media.mediaKind === "pdf") {
      const info = await runBounded("pdfinfo", [originalPath], 5_000, 1024 * 1024);
      const pageCount = parsePdfPageCount(info);
      if (pageCount > MAX_PDF_PAGES) {
        throw new Error(`PDFs are limited to ${MAX_PDF_PAGES} pages.`);
      }
      const extracted = await runBounded(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", originalPath, "-"],
        30_000,
        MAX_EXTRACTED_TEXT_BYTES,
      );
      const split = extracted.replaceAll("\r\n", "\n").split("\f");
      pageTexts = Array.from({ length: pageCount }, (_, index) => split[index]?.trim() ?? "");
      renderedPagePaths = await renderPdfPages(originalPath, extractedDirectory, pageCount);
    } else {
      pageTexts = [new TextDecoder("utf-8", { fatal: true }).decode(await readFile(originalPath))];
    }

    return Promise.all(
      pageTexts.map(async (nativeText, index) => {
        const pageNumber = index + 1;
        const renderedPath = renderedPagePaths[index];
        const ocr =
          media.mediaKind === "pdf" && nativeText.trim().length < 5 && renderedPath
            ? await extractOcr(renderedPath)
            : undefined;
        const text = ocr?.text.trim() || nativeText;
        const filename = `page-${String(pageNumber).padStart(4, "0")}.txt`;
        await writeFileAtomic(path.join(extractedDirectory, filename), `${text}\n`);
        return {
          pageNumber,
          textRelativePath: path.posix.join("attachments", "extracted", attachmentId, filename),
          characterCount: text.length,
          ...(renderedPath
            ? {
                imageRelativePath: path.posix.join(
                  "attachments",
                  "extracted",
                  attachmentId,
                  path.basename(renderedPath),
                ),
              }
            : {}),
          extractionMethod: ocr?.text.trim() ? "ocr" : "text",
          ...(ocr?.text.trim() ? { ocrConfidence: ocr.confidence } : {}),
        };
      }),
    );
  }
}

function chunkText(text: string, maximumCharacters = 2_000): readonly string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    let end = Math.min(normalized.length, offset + maximumCharacters);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(" ", end);
      if (boundary > offset + maximumCharacters / 2) {
        end = boundary;
      }
    }
    chunks.push(normalized.slice(offset, end).trim());
    offset = end;
    while (normalized[offset] === " ") {
      offset += 1;
    }
  }
  return chunks;
}

function tokenize(value: string): readonly string[] {
  const stopWords = new Set([
    "and",
    "are",
    "does",
    "for",
    "from",
    "how",
    "the",
    "this",
    "what",
    "with",
  ]);
  return [
    ...new Set(
      value
        .toLowerCase()
        .match(/[a-z0-9]+/g)
        ?.filter((term) => term.length > 2 && !stopWords.has(term)) ?? [],
    ),
  ];
}

function relevanceScore(text: string, queryTerms: readonly string[], rawQuery: string): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    let position = normalized.indexOf(term);
    while (position >= 0) {
      score += 1;
      position = normalized.indexOf(term, position + term.length);
    }
  }
  const phrase = rawQuery.trim().toLowerCase();
  if (phrase.length > 5 && normalized.includes(phrase)) {
    score += 10;
  }
  return score;
}

async function renderPdfPages(
  originalPath: string,
  extractedDirectory: string,
  pageCount: number,
): Promise<readonly string[]> {
  const prefix = path.join(extractedDirectory, "rendered");
  await runBounded(
    "pdftoppm",
    [
      "-jpeg",
      "-jpegopt",
      "quality=82",
      "-scale-to",
      "1600",
      "-f",
      "1",
      "-l",
      String(pageCount),
      originalPath,
      prefix,
    ],
    90_000,
    1024 * 1024,
  );
  const rendered = (await readdir(extractedDirectory))
    .filter((name) => /^rendered-\d+\.jpg$/.test(name))
    .sort((left, right) => pageNumberFromRenderedName(left) - pageNumberFromRenderedName(right));
  if (rendered.length !== pageCount) {
    throw new Error("The PDF renderer did not produce the expected number of pages.");
  }

  let totalBytes = 0;
  const finalPaths: string[] = [];
  for (const [index, name] of rendered.entries()) {
    const source = path.join(extractedDirectory, name);
    totalBytes += (await stat(source)).size;
    if (totalBytes > MAX_RENDERED_PAGE_BYTES) {
      throw new Error("Rendered PDF pages exceed the 200 MB extraction limit.");
    }
    const destination = path.join(
      extractedDirectory,
      `page-${String(index + 1).padStart(4, "0")}.jpg`,
    );
    await rename(source, destination);
    finalPaths.push(destination);
  }
  return finalPaths;
}

function pageNumberFromRenderedName(name: string): number {
  return Number.parseInt(/(\d+)\.jpg$/.exec(name)?.[1] ?? "0", 10);
}

async function extractOcr(
  imagePath: string,
): Promise<{ readonly text: string; readonly confidence: number }> {
  const tsv = await runBounded(
    "tesseract",
    [imagePath, "stdout", "-l", "eng", "tsv"],
    60_000,
    10 * 1024 * 1024,
  );
  const tokens: string[] = [];
  const confidences: number[] = [];
  for (const line of tsv.split("\n").slice(1)) {
    const columns = line.split("\t");
    const text = columns[11]?.trim();
    const confidence = Number.parseFloat(columns[10] ?? "-1");
    if (text) {
      tokens.push(text);
      if (Number.isFinite(confidence) && confidence >= 0) {
        confidences.push(confidence);
      }
    }
  }
  return {
    text: tokens.join(" "),
    confidence:
      confidences.length > 0
        ? confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length / 100
        : 0,
  };
}

async function detectMedia(filePath: string): Promise<DetectedMedia> {
  const handle = await open(filePath, "r");
  const prefix = Buffer.alloc(8192);
  try {
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    const bytes = prefix.subarray(0, bytesRead);
    if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
      return { mediaKind: "pdf", mimeType: "application/pdf", extension: ".pdf" };
    }
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { mediaKind: "image", mimeType: "image/png", extension: ".png" };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return { mediaKind: "image", mimeType: "image/jpeg", extension: ".jpg" };
    }
    if (!bytes.includes(0)) {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const markdown = [".md", ".markdown"].includes(path.extname(filePath).toLowerCase());
      return {
        mediaKind: "text",
        mimeType: markdown ? "text/markdown" : "text/plain",
        extension: markdown ? ".md" : ".txt",
      };
    }
  } finally {
    await handle.close();
  }
  throw new Error("Unsupported attachment content. Use PDF, UTF-8 text/Markdown, PNG, or JPEG.");
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw reason;
  }
}

function parsePdfPageCount(info: string): number {
  const value = /^Pages:\s+(\d+)$/m.exec(info)?.[1];
  const pages = value ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isSafeInteger(pages) || pages < 1) {
    throw new Error("The PDF page count could not be read.");
  }
  return pages;
}

function runBounded(
  command: string,
  args: readonly string[],
  timeoutMilliseconds: number,
  maxOutputBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      action();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new Error(`${command} timed out while processing the attachment.`)));
    }, timeoutMilliseconds);

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(() => reject(new Error(`${command} produced too much extracted data.`)));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve(Buffer.concat(stdout).toString("utf8"));
        } else {
          const detail = Buffer.concat(stderr).toString("utf8").trim();
          reject(
            new Error(`${command} could not process the attachment${detail ? `: ${detail}` : "."}`),
          );
        }
      });
    });
  });
}
