import { describe, expect, it } from "vitest";
import { PortableRelativePathSchema } from "./portable-path";

describe("PortableRelativePathSchema", () => {
  it("accepts project paths and rejects absolute or traversing paths", () => {
    expect(PortableRelativePathSchema.parse("attachments/extracted/id/page.txt")).toBe(
      "attachments/extracted/id/page.txt",
    );
    for (const unsafe of ["../secret", "attachments/../../secret", "/etc/passwd", "C:\\secret"]) {
      expect(PortableRelativePathSchema.safeParse(unsafe).success).toBe(false);
    }
  });
});
