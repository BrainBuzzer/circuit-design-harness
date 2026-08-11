import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CircuitDocumentSchema } from "./circuit";
import { createBomRows, renderBomCsv, renderCircuitSvg } from "./circuit-export";

describe("circuit exports", () => {
  it("renders a deterministic SVG and grouped BOM for the representative fixture", async () => {
    const document = CircuitDocumentSchema.parse(
      JSON.parse(
        await readFile(
          path.resolve(
            import.meta.dirname,
            "../../tests/fixtures/circuits/led-current-limiter.json",
          ),
          "utf8",
        ),
      ),
    );

    const firstSvg = renderCircuitSvg(document);
    expect(renderCircuitSvg(document)).toBe(firstSvg);
    expect(firstSvg).toContain("Current-limited LED, revision 1");
    expect(firstSvg).toContain('width="297mm" height="210mm"');
    expect(firstSvg).toContain("STRUCTURAL SCHEMATIC · NOT SAFETY APPROVAL");
    expect(firstSvg).toContain('d="M -30 0 L -24 -13');
    expect(firstSvg).toContain(">R1</text>");
    expect(firstSvg).toContain(">D1</text>");
    expect(createBomRows(document)).toHaveLength(4);
    expect(renderBomCsv(document)).toContain("1,passive,resistor,Resistor,330 Ω,R1");
  });
});
