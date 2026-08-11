import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { migrateAssemblyDocument } from "@domain/assembly";
import { CircuitDocumentSchema } from "@domain/circuit";
import { PortableRelativePathSchema } from "@domain/portable-path";
import { AssemblyDocumentSchema, ProjectManifestSchema } from "@domain/project";
import type { ProjectArchiveResult } from "@shared/export-contract";
import type { ProjectState } from "@shared/project-contract";
import { z } from "zod";
import { writeJsonAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

const TAR_BLOCK_SIZE = 512;
const ARCHIVE_DIRECTORY = path.join("exports", "project-archives");
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;
const ProjectArchiveResultSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  circuitRevision: z.int().nonnegative(),
  archiveRelativePath: z.string().min(1),
  manifestRelativePath: z.string().min(1),
  byteSize: z.int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fileCount: z.int().nonnegative(),
});
const EmbeddedArchiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.uuid(),
  title: z.string().min(1).max(120),
  circuitRevision: z.int().nonnegative(),
  rootDirectory: z.string().min(1).max(200),
  files: z.array(
    z.object({
      path: PortableRelativePathSchema,
      byteSize: z.int().nonnegative(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});

interface ArchiveSourceEntry {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly type: "directory" | "file";
  readonly byteSize: number;
}

interface ArchivedFile {
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export class ArchiveService {
  constructor(private readonly projects: ProjectService) {}

  async exportProject(projectId: string): Promise<ProjectArchiveResult> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const projectPayload = await readFile(path.join(projectDirectory, "project.json"));
    const circuitPayload = await readFile(path.join(projectDirectory, "circuit.json"));
    const project = ProjectManifestSchema.parse(JSON.parse(projectPayload.toString("utf8")));
    const circuit = CircuitDocumentSchema.parse(JSON.parse(circuitPayload.toString("utf8")));
    if (project.id !== projectId || project.circuitRevision !== circuit.revision) {
      throw new Error("Project and circuit revisions disagree; reopen or repair before archiving.");
    }

    const archiveDirectory = path.join(projectDirectory, ARCHIVE_DIRECTORY);
    await mkdir(archiveDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(archiveDirectory, `.${randomUUID()}.tar.gz.creating`);
    const rootName = path.basename(projectDirectory);
    const sourceEntries = await collectEntries(projectDirectory);
    const expectedProjectHash = sha256(projectPayload);
    const expectedCircuitHash = sha256(circuitPayload);
    const archivedFiles: ArchivedFile[] = [];
    const gzip = createGzip({ level: 9 });
    const destination = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    const completion = pipeline(gzip, destination);

    try {
      for (const entry of sourceEntries) {
        const archivePath = `${rootName}/${entry.relativePath}${entry.type === "directory" ? "/" : ""}`;
        await writeChunk(gzip, createTarHeader(archivePath, entry.byteSize, entry.type));
        if (entry.type === "file") {
          const digest = createHash("sha256");
          let bytesWritten = 0;
          if (entry.byteSize > 0) {
            for await (const chunk of createReadStream(entry.absolutePath, {
              start: 0,
              end: entry.byteSize - 1,
            })) {
              const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytesWritten += payload.byteLength;
              digest.update(payload);
              await writeChunk(gzip, payload);
            }
          }
          if (bytesWritten !== entry.byteSize) {
            throw new Error(`Project file changed while archiving: ${entry.relativePath}`);
          }
          await writePadding(gzip, entry.byteSize);
          archivedFiles.push({
            path: entry.relativePath,
            byteSize: entry.byteSize,
            sha256: digest.digest("hex"),
          });
        }
      }

      if (
        archivedFiles.find((entry) => entry.path === "project.json")?.sha256 !==
          expectedProjectHash ||
        archivedFiles.find((entry) => entry.path === "circuit.json")?.sha256 !== expectedCircuitHash
      ) {
        throw new Error("The project changed while its archive was being created; try again.");
      }

      const embeddedManifest = Buffer.from(
        `${JSON.stringify(
          {
            schemaVersion: 1,
            projectId,
            title: project.title,
            circuitRevision: circuit.revision,
            rootDirectory: rootName,
            files: archivedFiles,
          },
          null,
          2,
        )}\n`,
      );
      await writeChunk(
        gzip,
        createTarHeader(`${rootName}/archive-manifest.json`, embeddedManifest.byteLength, "file"),
      );
      await writeChunk(gzip, embeddedManifest);
      await writePadding(gzip, embeddedManifest.byteLength);
      await writeChunk(gzip, Buffer.alloc(TAR_BLOCK_SIZE * 2));
      gzip.end();
      await completion;

      const archiveHash = await hashFile(temporaryPath);
      const baseName = `${project.slug}--rev-${String(circuit.revision).padStart(8, "0")}--${archiveHash.slice(0, 12)}`;
      const archiveRelativePath = path.posix.join(
        "exports",
        "project-archives",
        `${baseName}.tar.gz`,
      );
      const manifestRelativePath = path.posix.join(
        "exports",
        "project-archives",
        `${baseName}.manifest.json`,
      );
      const finalPath = path.join(projectDirectory, archiveRelativePath);
      try {
        await link(temporaryPath, finalPath);
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== "EEXIST") {
          throw reason;
        }
      }
      await rm(temporaryPath, { force: true });
      const result = ProjectArchiveResultSchema.parse({
        schemaVersion: 1,
        projectId,
        circuitRevision: circuit.revision,
        archiveRelativePath,
        manifestRelativePath,
        byteSize: (await stat(finalPath)).size,
        sha256: archiveHash,
        fileCount: archivedFiles.length,
      });
      await writeJsonAtomic(path.join(projectDirectory, manifestRelativePath), result);
      return result;
    } catch (reason) {
      gzip.destroy();
      await completion.catch(() => undefined);
      await rm(temporaryPath, { force: true });
      throw reason;
    }
  }

  async importProject(archivePath: string): Promise<ProjectState> {
    const archiveStats = await stat(archivePath);
    if (!archiveStats.isFile() || archiveStats.size > MAX_ARCHIVE_BYTES) {
      throw new Error("Project archives must be regular files no larger than 1 GiB.");
    }
    const state = await this.projects.getState();
    const stagingDirectory = path.join(state.rootPath, `.project-import.${randomUUID()}.staging`);
    await mkdir(stagingDirectory, { recursive: false, mode: 0o700 });
    let finalDirectory: string | undefined;

    try {
      const extracted = await extractArchive(archivePath, stagingDirectory);
      const embeddedManifest = EmbeddedArchiveManifestSchema.parse(
        JSON.parse(await readFile(path.join(stagingDirectory, "archive-manifest.json"), "utf8")),
      );
      if (embeddedManifest.rootDirectory !== extracted.rootDirectory) {
        throw new Error("Archive root and embedded manifest disagree.");
      }
      if (embeddedManifest.files.length !== extracted.files.size) {
        throw new Error("Archive manifest does not describe every extracted file.");
      }
      for (const expected of embeddedManifest.files) {
        const actual = extracted.files.get(expected.path);
        if (!actual || actual.byteSize !== expected.byteSize || actual.sha256 !== expected.sha256) {
          throw new Error(`Archive content hash mismatch: ${expected.path}`);
        }
      }
      await rm(path.join(stagingDirectory, "archive-manifest.json"), { force: true });

      const project = ProjectManifestSchema.parse(
        JSON.parse(await readFile(path.join(stagingDirectory, "project.json"), "utf8")),
      );
      const circuit = CircuitDocumentSchema.parse(
        JSON.parse(await readFile(path.join(stagingDirectory, "circuit.json"), "utf8")),
      );
      const assemblyPath = path.join(stagingDirectory, "assembly.json");
      const assembly = migrateAssemblyDocument(JSON.parse(await readFile(assemblyPath, "utf8")));
      AssemblyDocumentSchema.parse(assembly);
      await writeJsonAtomic(assemblyPath, assembly);
      await readFile(path.join(stagingDirectory, "AGENTS.md"), "utf8");
      if (
        project.id !== embeddedManifest.projectId ||
        project.title !== embeddedManifest.title ||
        project.circuitRevision !== embeddedManifest.circuitRevision ||
        circuit.revision !== embeddedManifest.circuitRevision
      ) {
        throw new Error("Archived project identity or revision does not match its manifest.");
      }
      if (state.projects.some((candidate) => candidate.id === project.id)) {
        throw new Error("A project with this archive's ID already exists in the selected root.");
      }
      for (const relativeDirectory of [
        "chat",
        "attachments/originals",
        "attachments/extracted",
        "captures",
        "history",
        "exports",
        "firmware",
        "trash",
      ]) {
        await mkdir(path.join(stagingDirectory, relativeDirectory), {
          recursive: true,
          mode: 0o700,
        });
      }
      const directoryName = `${project.slug}--${project.id.slice(0, 8)}`;
      const destinationDirectory = path.join(state.rootPath, directoryName);
      if (await pathExists(destinationDirectory)) {
        throw new Error("The imported project's destination directory already exists.");
      }
      await rename(stagingDirectory, destinationDirectory);
      finalDirectory = destinationDirectory;
      return await this.projects.activateProject(project.id);
    } catch (reason) {
      await rm(stagingDirectory, { recursive: true, force: true });
      if (finalDirectory) {
        await rm(finalDirectory, { recursive: true, force: true });
      }
      throw reason;
    }
  }
}

async function extractArchive(
  archivePath: string,
  stagingDirectory: string,
): Promise<{
  readonly rootDirectory: string;
  readonly files: ReadonlyMap<string, ArchivedFile>;
}> {
  const decompressed = createReadStream(archivePath).pipe(createGunzip());
  const reader = new StreamBlockReader(decompressed);
  const files = new Map<string, ArchivedFile>();
  const seenPaths = new Set<string>();
  let rootDirectory: string | undefined;
  let totalBytes = 0;
  let entryCount = 0;

  while (true) {
    const header = await reader.readBlock(TAR_BLOCK_SIZE);
    if (!header) {
      throw new Error("Project archive ended before its tar trailer.");
    }
    if (header.every((byte) => byte === 0)) {
      const secondTrailerBlock = await reader.readBlock(TAR_BLOCK_SIZE);
      if (!secondTrailerBlock?.every((byte) => byte === 0)) {
        throw new Error("Project archive has an invalid tar trailer.");
      }
      await reader.assertZeroRemainder();
      break;
    }
    entryCount += 1;
    if (entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new Error(`Project archives are limited to ${MAX_ARCHIVE_ENTRIES} entries.`);
    }
    const parsed = parseTarHeader(header);
    if (parsed.byteSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw new Error("A project archive entry exceeds the 512 MiB limit.");
    }
    totalBytes += parsed.byteSize;
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error("Project archive expands beyond the 2 GiB limit.");
    }
    const safePath = safeImportedPath(parsed.archivePath);
    rootDirectory ??= safePath.rootDirectory;
    if (rootDirectory !== safePath.rootDirectory) {
      throw new Error("Project archive contains more than one root directory.");
    }
    if (seenPaths.has(safePath.relativePath)) {
      throw new Error(`Project archive repeats a path: ${safePath.relativePath}`);
    }
    seenPaths.add(safePath.relativePath);
    const destinationPath = path.resolve(stagingDirectory, ...safePath.relativePath.split("/"));
    const allowedPrefix = `${path.resolve(stagingDirectory)}${path.sep}`;
    if (!destinationPath.startsWith(allowedPrefix)) {
      throw new Error("Project archive entry escapes the import staging directory.");
    }

    if (parsed.type === "directory") {
      if (parsed.byteSize !== 0) {
        throw new Error("Project archive directory entries must be empty.");
      }
      await mkdir(destinationPath, { recursive: true, mode: 0o700 });
    } else {
      await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
      const output = createWriteStream(destinationPath, { flags: "wx", mode: 0o600 });
      const digest = createHash("sha256");
      let byteSize = 0;
      try {
        for await (const chunk of reader.readChunks(parsed.byteSize)) {
          byteSize += chunk.byteLength;
          digest.update(chunk);
          await writeChunk(output, chunk);
        }
        output.end();
        await finished(output);
      } catch (reason) {
        output.destroy();
        throw reason;
      }
      const padding = (TAR_BLOCK_SIZE - (parsed.byteSize % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
      if (padding > 0) {
        const paddingBytes = await reader.readBlock(padding);
        if (!paddingBytes?.every((byte) => byte === 0)) {
          throw new Error("Project archive contains invalid file padding.");
        }
      }
      if (safePath.relativePath !== "archive-manifest.json") {
        files.set(safePath.relativePath, {
          path: safePath.relativePath,
          byteSize,
          sha256: digest.digest("hex"),
        });
      } else {
        digest.digest();
      }
    }
  }

  if (!rootDirectory || !(await pathExists(path.join(stagingDirectory, "archive-manifest.json")))) {
    throw new Error("Project archive is missing its embedded manifest.");
  }
  return { rootDirectory, files };
}

class StreamBlockReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private pending = Buffer.alloc(0);
  private ended = false;

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]();
  }

  async readBlock(byteCount: number): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    let remaining = byteCount;
    while (remaining > 0) {
      if (this.pending.byteLength === 0 && !(await this.fillPending())) {
        if (remaining === byteCount) {
          return undefined;
        }
        throw new Error("Project archive ended inside a tar block.");
      }
      const consumed = Math.min(remaining, this.pending.byteLength);
      chunks.push(this.pending.subarray(0, consumed));
      this.pending = this.pending.subarray(consumed);
      remaining -= consumed;
    }
    return Buffer.concat(chunks, byteCount);
  }

  async *readChunks(byteCount: number): AsyncGenerator<Buffer> {
    let remaining = byteCount;
    while (remaining > 0) {
      if (this.pending.byteLength === 0 && !(await this.fillPending())) {
        throw new Error("Project archive ended inside a file entry.");
      }
      const consumed = Math.min(remaining, this.pending.byteLength);
      yield this.pending.subarray(0, consumed);
      this.pending = this.pending.subarray(consumed);
      remaining -= consumed;
    }
  }

  async assertZeroRemainder(): Promise<void> {
    if (!this.pending.every((byte) => byte === 0)) {
      throw new Error("Project archive contains data after its tar trailer.");
    }
    this.pending = Buffer.alloc(0);
    while (await this.fillPending()) {
      if (!this.pending.every((byte) => byte === 0)) {
        throw new Error("Project archive contains data after its tar trailer.");
      }
      this.pending = Buffer.alloc(0);
    }
  }

  private async fillPending(): Promise<boolean> {
    if (this.ended) {
      return false;
    }
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    this.pending = Buffer.from(next.value);
    return true;
  }
}

function parseTarHeader(header: Buffer): {
  readonly archivePath: string;
  readonly byteSize: number;
  readonly type: "directory" | "file";
} {
  if (readTarText(header, 257, 6) !== "ustar") {
    throw new Error("Project archive uses an unsupported tar format.");
  }
  const storedChecksum = readTarOctal(header, 148, 8);
  const checksumHeader = Buffer.from(header);
  checksumHeader.fill(0x20, 148, 156);
  const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
  if (storedChecksum !== actualChecksum) {
    throw new Error("Project archive tar header checksum is invalid.");
  }
  const name = readTarText(header, 0, 100);
  const prefix = readTarText(header, 345, 155);
  const archivePath = prefix ? `${prefix}/${name}` : name;
  const byteSize = readTarOctal(header, 124, 12);
  const typeFlag = header[156] ?? 0;
  if (typeFlag !== 0 && typeFlag !== 0x30 && typeFlag !== 0x35) {
    throw new Error("Project archive contains links or another unsupported tar entry type.");
  }
  return { archivePath, byteSize, type: typeFlag === 0x35 ? "directory" : "file" };
}

function safeImportedPath(archivePath: string): {
  readonly rootDirectory: string;
  readonly relativePath: string;
} {
  if (archivePath.includes("\\") || archivePath.includes("\0") || archivePath.startsWith("/")) {
    throw new Error("Project archive contains an unsafe path.");
  }
  const normalized = archivePath.endsWith("/") ? archivePath.slice(0, -1) : archivePath;
  const segments = normalized.split("/");
  const rootDirectory = segments.shift();
  const relativePath = segments.join("/");
  if (
    !rootDirectory ||
    rootDirectory === "." ||
    rootDirectory === ".." ||
    rootDirectory.length > 200 ||
    !relativePath
  ) {
    throw new Error("Project archive must contain one named root directory.");
  }
  PortableRelativePathSchema.parse(relativePath);
  return { rootDirectory, relativePath };
}

function readTarText(buffer: Buffer, offset: number, length: number): string {
  const field = buffer.subarray(offset, offset + length);
  const terminator = field.indexOf(0);
  return field.subarray(0, terminator < 0 ? field.length : terminator).toString("utf8");
}

function readTarOctal(buffer: Buffer, offset: number, length: number): number {
  const value = readTarText(buffer, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) {
    throw new Error("Project archive contains an invalid tar number field.");
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Project archive tar number exceeds the supported range.");
  }
  return parsed;
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

async function collectEntries(projectDirectory: string): Promise<readonly ArchiveSourceEntry[]> {
  const entries: ArchiveSourceEntry[] = [];

  const visit = async (relativeDirectory: string): Promise<void> => {
    const absoluteDirectory = path.join(projectDirectory, relativeDirectory);
    const children = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const child of children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      const relativePath = path.posix.join(relativeDirectory.split(path.sep).join("/"), child.name);
      if (relativePath === "exports/project-archives") {
        continue;
      }
      const absolutePath = path.join(projectDirectory, ...relativePath.split("/"));
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Project archives reject symbolic links: ${relativePath}`);
      }
      if (metadata.isDirectory()) {
        entries.push({ absolutePath, relativePath, type: "directory", byteSize: 0 });
        await visit(relativePath);
      } else if (metadata.isFile()) {
        entries.push({
          absolutePath,
          relativePath,
          type: "file",
          byteSize: metadata.size,
        });
      } else {
        throw new Error(`Project archives reject special filesystem entries: ${relativePath}`);
      }
    }
  };

  await visit("");
  return entries;
}

function createTarHeader(
  archivePath: string,
  byteSize: number,
  type: ArchiveSourceEntry["type"],
): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  const { name, prefix } = splitTarPath(archivePath);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, type === "directory" ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, byteSize);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeText(header, 257, 6, "ustar");
  writeText(header, 263, 2, "00");
  writeText(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function splitTarPath(archivePath: string): { readonly name: string; readonly prefix: string } {
  if (Buffer.byteLength(archivePath) <= 100) {
    return { name: archivePath, prefix: "" };
  }
  let separator = archivePath.lastIndexOf("/");
  while (separator > 0) {
    const prefix = archivePath.slice(0, separator);
    const name = archivePath.slice(separator + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
    separator = archivePath.lastIndexOf("/", separator - 1);
  }
  throw new Error(`Project path is too long for a portable tar archive: ${archivePath}`);
}

function writeText(buffer: Buffer, offset: number, length: number, value: string): void {
  const payload = Buffer.from(value);
  if (payload.byteLength > length) {
    throw new Error("Tar header field exceeds its portable size limit.");
  }
  payload.copy(buffer, offset);
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const payload = `${value.toString(8).padStart(length - 1, "0")}\0`;
  buffer.write(payload, offset, length, "ascii");
}

async function writePadding(stream: Writable, byteSize: number): Promise<void> {
  const remainder = byteSize % TAR_BLOCK_SIZE;
  if (remainder > 0) {
    await writeChunk(stream, Buffer.alloc(TAR_BLOCK_SIZE - remainder));
  }
}

async function writeChunk(stream: Writable, payload: Buffer): Promise<void> {
  if (!stream.write(payload)) {
    await once(stream, "drain");
  }
}

function sha256(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

async function hashFile(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}
