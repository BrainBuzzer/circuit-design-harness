import { z } from "zod";

export const EspHomeComponentCatalogEntrySchema = z.object({
  name: z.string().regex(/^[a-z0-9_]+$/),
  platforms: z.array(z.string()),
  pythonModules: z.array(z.string()),
  sourceUrl: z.url(),
  documentationUrls: z.array(z.url()),
});
export type EspHomeComponentCatalogEntry = z.infer<typeof EspHomeComponentCatalogEntrySchema>;

export const EspHomeBoardCatalogEntrySchema = z.object({
  id: z.string().min(1).max(150),
  name: z.string().min(1).max(200),
  target: z.enum([
    "esp32",
    "esp32c2",
    "esp32c3",
    "esp32c5",
    "esp32c6",
    "esp32c61",
    "esp32h2",
    "esp32p4",
    "esp32s2",
    "esp32s3",
  ]),
});
export type EspHomeBoardCatalogEntry = z.infer<typeof EspHomeBoardCatalogEntrySchema>;

export const EspHomeCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  esphomeCommit: z.string().regex(/^[a-f0-9]{40}$/),
  documentationCommit: z.string().regex(/^[a-f0-9]{40}$/),
  componentCount: z.int().positive(),
  esp32Boards: z.array(EspHomeBoardCatalogEntrySchema),
  components: z.array(EspHomeComponentCatalogEntrySchema),
});
export type EspHomeCatalog = z.infer<typeof EspHomeCatalogSchema>;
