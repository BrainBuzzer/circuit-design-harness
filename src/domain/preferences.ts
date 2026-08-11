import { z } from "zod";

export const VOICE_TONES = ["warm", "focused", "calm", "energetic"] as const;

export const AppPreferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    wakeWordEnabled: z.boolean(),
    wakePhrase: z.literal("Hey LiveKit"),
    autoCaptureVisualRequests: z.boolean(),
    spokenReplies: z.boolean(),
    voiceTone: z.enum(VOICE_TONES),
    speechVoiceUri: z.string().max(500),
    speechRate: z.number().finite().min(0.5).max(2),
    speechVolume: z.number().finite().min(0).max(1),
  })
  .strict();

export type AppPreferences = z.infer<typeof AppPreferencesSchema>;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  schemaVersion: 1,
  wakeWordEnabled: false,
  wakePhrase: "Hey LiveKit",
  autoCaptureVisualRequests: true,
  spokenReplies: false,
  voiceTone: "warm",
  speechVoiceUri: "",
  speechRate: 1,
  speechVolume: 1,
};

export function parseAppPreferences(raw: unknown): AppPreferences {
  // Migrate pre-LiveKit wake phrase values without rejecting the whole prefs file.
  const candidate =
    raw && typeof raw === "object"
      ? {
          ...(raw as Record<string, unknown>),
          ...((raw as { wakePhrase?: unknown }).wakePhrase === "Eve"
            ? { wakePhrase: "Hey LiveKit" }
            : {}),
        }
      : raw;
  const parsed = AppPreferencesSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_APP_PREFERENCES;
}
