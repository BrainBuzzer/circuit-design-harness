import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSpokenReply, summarizeForSpeech } from "./speech-summary";

describe("summarizeForSpeech", () => {
  it("shortens long electronics replies and omits dense component value dumps", () => {
    const full = [
      "I proposed a current-limited LED circuit on the breadboard.",
      "Place R1 (330 Ω) pin 1 in a1 and pin 2 in a2, C1 (10 µF) between b3 and GND,",
      "D1 anode in b2, cathode in a3, and connect nets VCC, LED_A, GND via jumpers on",
      "pins D2, D3, D4, D5, D6, D7 and rails top+1 through top+12.",
      "BOM residual: 4.7kΩ, 100nF, 2.2k, 1N4148.",
      "Nothing is applied until you approve the build-map proposal.",
    ].join(" ");

    const spoken = summarizeForSpeech(full);

    expect(spoken.length).toBeLessThan(full.length);
    expect(spoken.length).toBeLessThanOrEqual(280);
    expect(spoken.toLowerCase()).toMatch(/proposed|led|breadboard|approve|build/);
    expect(spoken).not.toMatch(/330\s*Ω/i);
    expect(spoken).not.toMatch(/10\s*µF/i);
    expect(spoken).not.toMatch(/4\.7k/i);
    expect(spoken).not.toMatch(/D2,\s*D3,\s*D4,\s*D5,\s*D6,\s*D7/i);
  });

  it("preserves a short non-technical reply nearly intact", () => {
    const full = "Ready when you are.";
    expect(summarizeForSpeech(full)).toBe(full);
  });

  it("strips code fences and markdown tables without inventing content", () => {
    const full = [
      "Here is the sketch update.",
      "```cpp",
      "digitalWrite(13, HIGH); // 5V on D13",
      "```",
      "| Part | Value |",
      "| --- | --- |",
      "| R1 | 220 Ω |",
      "Approve when the pin map looks right.",
    ].join("\n");

    const spoken = summarizeForSpeech(full);
    expect(spoken.toLowerCase()).toMatch(/sketch|approve|pin map/);
    expect(spoken).not.toContain("digitalWrite");
    expect(spoken).not.toMatch(/220\s*Ω/i);
  });
});

describe("prepareSpokenReply (shipped speak-pipeline entry)", () => {
  it("returns a shorter gist without dense electrical dumps for long replies", () => {
    const full = [
      "I proposed a current-limited LED circuit on the breadboard.",
      "Place R1 (330 Ω) pin 1 in a1 and pin 2 in a2, C1 (10 µF) between b3 and GND,",
      "and connect pins D2, D3, D4, D5, D6, D7.",
      "Nothing is applied until you approve the build-map proposal.",
    ].join(" ");
    const spoken = prepareSpokenReply(full);
    expect(spoken).not.toBe(full);
    expect(spoken.length).toBeLessThan(full.length);
    expect(spoken).not.toMatch(/330\s*Ω/i);
    expect(spoken.toLowerCase()).toMatch(/proposed|approve|breadboard|led/);
  });

  it("is what workbench wires to TTS; production workbench never uses speechSynthesis.speak", () => {
    const workbenchPath = path.resolve(
      import.meta.dirname,
      "../renderer/src/components/workbench.tsx",
    );
    const source = readFileSync(workbenchPath, "utf8");
    expect(source).toContain("prepareSpokenReply");
    expect(source).toContain("speakText");
    expect(source).not.toContain("speechSynthesis.speak");
    expect(source).not.toContain("SpeechSynthesisUtterance");
  });
});
