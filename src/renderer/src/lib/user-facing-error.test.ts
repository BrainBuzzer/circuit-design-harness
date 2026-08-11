import { describe, expect, it } from "vitest";
import { userFacingProjectError } from "./user-facing-error";

describe("userFacingProjectError", () => {
  it("turns raw filesystem IPC failures into actionable project-folder guidance", () => {
    expect(
      userFacingProjectError(
        new Error("Error invoking remote method 'project:create': ENOSPC: no space left on device"),
      ),
    ).toContain("disk is full");
    expect(userFacingProjectError(new Error("EACCES: permission denied"))).toContain(
      "does not have permission",
    );
    expect(userFacingProjectError(new Error("EROFS: read-only file system"))).toContain(
      "read-only",
    );
  });

  it("preserves a useful application error", () => {
    expect(userFacingProjectError(new Error("That project no longer exists."))).toBe(
      "That project no longer exists.",
    );
  });
});
