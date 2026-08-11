import { describe, expect, it } from "vitest";
import { createNewProjectDocuments, ProjectManifestSchema, slugifyProjectTitle } from "./project";

describe("project domain", () => {
  it("creates deterministic versioned documents when id and time are supplied", () => {
    const documents = createNewProjectDocuments("  LED Bench Test  ", {
      id: "3d2ee9e9-f804-43b0-9b99-23871f7e674d",
      now: new Date("2026-08-09T06:30:00.000Z"),
    });

    expect(documents.manifest).toEqual({
      schemaVersion: 1,
      id: "3d2ee9e9-f804-43b0-9b99-23871f7e674d",
      title: "LED Bench Test",
      slug: "led-bench-test",
      createdAt: "2026-08-09T06:30:00.000Z",
      updatedAt: "2026-08-09T06:30:00.000Z",
      circuitRevision: 0,
    });
    expect(documents.circuit.revision).toBe(0);
    expect(documents.assembly.circuitRevision).toBe(0);
    expect(ProjectManifestSchema.parse(documents.manifest)).toEqual(documents.manifest);
  });

  it("produces a portable fallback slug for non-latin titles", () => {
    expect(slugifyProjectTitle("⚡ विद्युत परिपथ ⚡")).toBe("circuit-project");
  });
});
