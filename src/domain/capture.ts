import { z } from "zod";
import { PortableRelativePathSchema } from "./portable-path";

export const CAPTURE_SCHEMA_VERSION = 1;

export const CaptureRecordSchema = z.object({
  schemaVersion: z.literal(CAPTURE_SCHEMA_VERSION),
  id: z.uuid(),
  projectId: z.uuid(),
  source: z.enum(["local_camera", "remote_camera"]),
  deviceLabel: z.string().trim().min(1).max(200),
  mimeType: z.literal("image/jpeg"),
  imageRelativePath: PortableRelativePathSchema,
  byteSize: z.int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.int().positive().max(16_384),
  height: z.int().positive().max(16_384),
  circuitRevision: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;
