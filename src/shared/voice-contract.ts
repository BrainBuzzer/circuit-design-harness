export interface TranscribeAudioInput {
  readonly projectId: string;
  readonly wavBytes: Uint8Array;
  readonly durationMs: number;
}

export interface TranscriptionResult {
  readonly text: string;
  readonly provider: "local_whisper";
  readonly model: "whisper-small-multilingual-q5_1";
}

export interface VoiceAssetComponentStatus {
  readonly kind: "whisper_model" | "chatterbox_tts" | "wakeword_model";
  readonly label: string;
  readonly ready: boolean;
  readonly downloading: boolean;
  readonly error?: string | undefined;
  readonly bytesDownloaded?: number | undefined;
  readonly bytesTotal?: number | undefined;
  /** 0–100 when sizes are known */
  readonly percent?: number | undefined;
  readonly currentFile?: string | undefined;
  readonly message?: string | undefined;
}

export interface VoiceRuntimeStatus {
  readonly ready: boolean;
  readonly installing: boolean;
  readonly pythonPath?: string | undefined;
  readonly message: string;
  readonly packages: readonly string[];
  readonly logTail: string;
  readonly error?: string | undefined;
}

export interface VoiceAssetStatus {
  readonly whisper: VoiceAssetComponentStatus;
  readonly chatterbox: VoiceAssetComponentStatus;
  readonly wakeword: VoiceAssetComponentStatus;
  readonly python: VoiceRuntimeStatus;
  readonly allReady: boolean;
  /** One-line human summary for banners */
  readonly summary: string;
}

export interface WakeWordDetectionEvent {
  readonly name: string;
  readonly confidence: number;
  readonly source: "livekit" | "whisper_fallback";
}

/** Live classifier scores while listening (for UI feedback only). */
export interface WakeWordScoresEvent {
  readonly scores: Readonly<Record<string, number>>;
}

export interface PushWakeWordAudioInput {
  /** 16 kHz mono PCM samples (Int16 values as numbers for IPC structured clone). */
  readonly pcm16: Int16Array | readonly number[];
}

export interface SpeakTextInput {
  readonly text: string;
  readonly exaggeration?: number | undefined;
}

export interface SpeakTextResult {
  readonly provider: "chatterbox";
  readonly model: string;
  readonly sampleRateHz: number;
  readonly wavBytes: Uint8Array;
  readonly spokenText: string;
}
