import type { AppPreferences } from "@domain/preferences";

export type AppPreferencesSnapshot = AppPreferences;

export interface UpdateAppPreferencesInput {
  readonly preferences: AppPreferences;
}
