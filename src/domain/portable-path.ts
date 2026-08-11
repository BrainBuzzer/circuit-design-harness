import { z } from "zod";

export const PortableRelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    "Expected a portable project-relative path without traversal.",
  );
