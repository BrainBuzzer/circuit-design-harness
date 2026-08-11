import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  type AppPreferences,
  AppPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
} from "@domain/preferences";
import { writeJsonAtomic } from "./json-file";

export class PreferencesService {
  private preferences: AppPreferences = DEFAULT_APP_PREFERENCES;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<AppPreferences> {
    try {
      this.preferences = AppPreferencesSchema.parse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
    } catch {
      this.preferences = DEFAULT_APP_PREFERENCES;
      await this.persist();
    }
    return this.preferences;
  }

  get(): AppPreferences {
    return this.preferences;
  }

  async update(rawPreferences: unknown): Promise<AppPreferences> {
    this.preferences = AppPreferencesSchema.parse(rawPreferences);
    await this.persist();
    return this.preferences;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(this.filePath, this.preferences);
  }
}
