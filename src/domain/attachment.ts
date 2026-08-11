import { z } from "zod";
import { PortableRelativePathSchema } from "./portable-path";

export const ATTACHMENT_SCHEMA_VERSION = 1;

export const AttachmentPageSchema = z.object({
  pageNumber: z.int().positive(),
  textRelativePath: PortableRelativePathSchema,
  characterCount: z.int().nonnegative(),
  imageRelativePath: PortableRelativePathSchema.optional(),
  extractionMethod: z.enum(["text", "ocr"]).default("text"),
  ocrConfidence: z.number().min(0).max(1).optional(),
});

export const AttachmentRecordSchema = z.object({
  schemaVersion: z.literal(ATTACHMENT_SCHEMA_VERSION),
  id: z.uuid(),
  projectId: z.uuid(),
  originalName: z.string().trim().min(1).max(255),
  mediaKind: z.enum(["pdf", "text", "image"]),
  mimeType: z.enum(["application/pdf", "text/plain", "text/markdown", "image/png", "image/jpeg"]),
  byteSize: z.int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  originalRelativePath: PortableRelativePathSchema,
  importedAt: z.iso.datetime(),
  pages: z.array(AttachmentPageSchema),
});

export type AttachmentRecord = z.infer<typeof AttachmentRecordSchema>;

export const TrashedAttachmentSchema = z.object({
  schemaVersion: z.literal(1),
  trashId: z.uuid(),
  projectId: z.uuid(),
  deletedAt: z.iso.datetime(),
  storedOriginalName: z.string().min(1).max(300),
  record: AttachmentRecordSchema,
});

export type TrashedAttachment = z.infer<typeof TrashedAttachmentSchema>;
