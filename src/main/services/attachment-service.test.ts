import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttachmentService } from "./attachment-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("AttachmentService", () => {
  it("sniffs, hashes, copies, extracts, and cites UTF-8 text evidence", async () => {
    const { root, projectId, projects } = await createProjectFixture();
    const sourcePath = path.join(root, "requirements.bin");
    await writeFile(sourcePath, "Use a 330 ohm current-limiting resistor.\n", "utf8");
    const attachments = new AttachmentService(projects);

    const [record] = await attachments.importFiles(projectId, [sourcePath]);
    if (!record) throw new Error("Expected imported attachment.");
    expect(record).toMatchObject({
      originalName: "requirements.bin",
      mediaKind: "text",
      mimeType: "text/plain",
      byteSize: 41,
    });
    expect(record?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.pages).toHaveLength(1);
    expect(await attachments.list(projectId)).toEqual([record]);

    const irrelevantPath = path.join(root, "mechanical-notes.txt");
    await writeFile(irrelevantPath, "Enclosure color is blue.", "utf8");
    const [irrelevant] = await attachments.importFiles(projectId, [irrelevantPath]);
    if (!irrelevant) throw new Error("Expected second imported attachment.");
    const evidence = await attachments.buildPromptEvidence(
      projectId,
      [record.id, irrelevant.id],
      "Which current limiting resistor should I use?",
    );
    expect(evidence.images).toEqual([]);
    expect(evidence.text).toContain(
      `[attachment ${record.id}, requirements.bin, page 1, excerpt 1]`,
    );
    expect(evidence.text).toContain("330 ohm");
    expect(evidence.text).not.toContain("Enclosure color");

    const projectDirectory = await projects.getProjectDirectory(projectId);
    const pagePath = path.join(projectDirectory, record.pages[0]?.textRelativePath ?? "missing");
    const outsidePath = path.join(root, "outside-secret.txt");
    await writeFile(outsidePath, "outside project", "utf8");
    await rm(pagePath);
    await symlink(outsidePath, pagePath);
    await expect(
      attachments.buildPromptEvidence(projectId, [record?.id ?? "missing"]),
    ).rejects.toThrow("outside its project");
  });

  it("extracts PDF text with page-level provenance in a subprocess", async () => {
    const { root, projectId, projects } = await createProjectFixture();
    const sourcePath = path.join(root, "fixture.pdf");
    await writeFile(sourcePath, createMinimalPdf("MAXIMUM VOLTAGE 5 V"));
    const attachments = new AttachmentService(projects);

    const [record] = await attachments.importFiles(projectId, [sourcePath]);
    expect(record).toMatchObject({ mediaKind: "pdf", mimeType: "application/pdf" });
    expect(record?.pages).toHaveLength(1);
    expect(record?.pages[0]).toMatchObject({ extractionMethod: "text" });
    const projectDirectory = await projects.getProjectDirectory(projectId);
    const extractedText = await readFile(
      path.join(projectDirectory, record?.pages[0]?.textRelativePath ?? "missing"),
      "utf8",
    );
    expect(extractedText).toContain("MAXIMUM VOLTAGE 5 V");
    const renderedPage = await readFile(
      path.join(projectDirectory, record?.pages[0]?.imageRelativePath ?? "missing"),
    );
    expect([...renderedPage.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it("labels OCR-derived text and confidence for an image-only PDF", async () => {
    const { projectId, projects } = await createProjectFixture();
    const sourcePath = path.resolve(
      import.meta.dirname,
      "../../../tests/fixtures/pdfs/scanned-voltage.pdf",
    );
    const attachments = new AttachmentService(projects);

    const [record] = await attachments.importFiles(projectId, [sourcePath]);
    expect(record?.pages[0]?.extractionMethod).toBe("ocr");
    expect(record?.pages[0]?.ocrConfidence).toBeGreaterThan(0.8);
    const evidence = await attachments.buildPromptEvidence(projectId, [record?.id ?? "missing"]);
    expect(evidence.text).toContain("ABSOLUTE MAXIMUM VOLTAGE");
    expect(evidence.text).toContain("330 OHM");
  });

  it("does not allow attachment IDs from another project into prompt evidence", async () => {
    const { root, projectId, projects } = await createProjectFixture();
    const sourcePath = path.join(root, "notes.txt");
    await writeFile(sourcePath, "Project one only.", "utf8");
    const attachments = new AttachmentService(projects);
    const [record] = await attachments.importFiles(projectId, [sourcePath]);
    const second = await projects.createProject("Second project");
    const secondProjectId = second.activeProjectId;
    if (!secondProjectId || !record) {
      throw new Error("Expected attachment and second project IDs.");
    }

    await expect(attachments.buildPromptEvidence(secondProjectId, [record.id])).rejects.toThrow(
      "do not belong",
    );
  });

  it("re-indexes deterministically and moves originals plus derived data through recoverable trash", async () => {
    const { root, projectId, projects } = await createProjectFixture();
    const sourcePath = path.join(root, "recoverable-notes.txt");
    await writeFile(sourcePath, "Use the approved 5 V supply.\n", "utf8");
    const attachments = new AttachmentService(projects);
    const [record] = await attachments.importFiles(projectId, [sourcePath]);
    if (!record) {
      throw new Error("Expected an imported attachment.");
    }
    const before = await attachments.buildPromptEvidence(projectId, [record.id], "approved supply");
    const reindexed = await attachments.reindex(projectId, record.id);
    expect(reindexed).toEqual([record]);
    expect(
      await attachments.buildPromptEvidence(projectId, [record.id], "approved supply"),
    ).toEqual(before);

    expect(await attachments.trash(projectId, record.id)).toEqual([]);
    const trashed = await attachments.listTrashed(projectId);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]?.record).toEqual(record);
    await expect(attachments.buildPromptEvidence(projectId, [record.id])).rejects.toThrow(
      "do not belong",
    );

    expect(await attachments.restore(projectId, trashed[0]?.trashId ?? "missing")).toEqual([
      record,
    ]);
    expect(await attachments.listTrashed(projectId)).toEqual([]);
    expect(
      await attachments.buildPromptEvidence(projectId, [record.id], "approved supply"),
    ).toEqual(before);
  });
});

async function createProjectFixture(): Promise<{
  root: string;
  projectId: string;
  projects: ProjectService;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "attachment-service-test-"));
  temporaryDirectories.push(root);
  const projects = new ProjectService(
    path.join(root, "app-data", "settings.json"),
    path.join(root, "projects"),
  );
  await projects.initialize();
  const state = await projects.createProject("Attachment fixture");
  const projectId = state.activeProjectId;
  if (!projectId) {
    throw new Error("Expected a project ID.");
  }
  return { root, projectId, projects };
}

function createMinimalPdf(text: string): Uint8Array {
  const escapedText = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}
