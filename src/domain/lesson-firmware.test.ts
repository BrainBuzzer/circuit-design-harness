import { describe, expect, it } from "vitest";
import {
  ARDUINO_CLI_FQBN,
  getLessonFirmware,
  LESSON_FIRMWARE,
  listLessonFirmwareSummaries,
  requireLessonFirmware,
} from "./lesson-firmware";
import { getStarterLessons } from "./lesson-fixtures";

describe("lesson golden firmware", () => {
  it("ships a golden sketch for every starter lesson", () => {
    const lessons = getStarterLessons();
    expect(LESSON_FIRMWARE.length).toBe(lessons.length);
    for (const lesson of lessons) {
      const firmware = requireLessonFirmware(lesson.id);
      expect(firmware.targetId).toBe(lesson.board);
      expect(firmware.source).toMatch(/void\s+setup\s*\(/);
      expect(firmware.source).toMatch(/void\s+loop\s*\(/);
      expect(firmware.source.length).toBeGreaterThan(80);
      expect(firmware.successCheck.length).toBeGreaterThan(10);
      // Pin hints from the lesson pin map should appear in source for teachability
      const pinTokens = lesson.pinMap.map((p) =>
        p.boardPin.replace(/^D/, "").replace(/^GPIO/i, ""),
      );
      const source = firmware.source;
      // At least one board pin number from the map should be referenced
      expect(pinTokens.some((token) => source.includes(token))).toBe(true);
    }
  });

  it("lists summaries and rejects unknown ids", () => {
    expect(listLessonFirmwareSummaries().length).toBeGreaterThanOrEqual(5);
    expect(getLessonFirmware("nope")).toBeUndefined();
    expect(() => requireLessonFirmware("nope")).toThrow(/No golden firmware/);
  });

  it("maps product targets to arduino-cli FQBNs", () => {
    expect(ARDUINO_CLI_FQBN.arduino_uno_r3).toBe("arduino:avr:uno");
    expect(ARDUINO_CLI_FQBN.esp32s3).toContain("esp32s3");
  });
});
