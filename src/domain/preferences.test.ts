import { describe, expect, it } from "vitest";
import { DEFAULT_APP_PREFERENCES, parseAppPreferences, VOICE_TONES } from "./preferences";

describe("application preferences", () => {
  it("defaults to an explicit opt-in wake word with a fixed Eve phrase", () => {
    expect(parseAppPreferences({})).toEqual(DEFAULT_APP_PREFERENCES);
    expect(DEFAULT_APP_PREFERENCES.wakeWordEnabled).toBe(false);
    expect(DEFAULT_APP_PREFERENCES.wakePhrase).toBe("Eve");
  });

  it("accepts every bounded local voice tone", () => {
    for (const voiceTone of VOICE_TONES) {
      expect(parseAppPreferences({ ...DEFAULT_APP_PREFERENCES, voiceTone }).voiceTone).toBe(
        voiceTone,
      );
    }
  });
});
