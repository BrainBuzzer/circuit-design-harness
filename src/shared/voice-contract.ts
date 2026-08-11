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
  readonly ready: boolean;
  readonly downloading: boolean;
  readonly error?: string | undefined;
  readonly bytesDownloaded?: number | undefined;
  readonly bytesTotal?: number | undefined;
}

export interface VoiceAssetStatus {
  readonly whisper: VoiceAssetComponentStatus;
  readonly chatterbox: VoiceAssetComponentStatus;
  readonly wakeword: VoiceAssetComponentStatus;
  readonly allReady: boolean;
}

export interface WakeWordDetectionEvent {
  readonly name: string;
  readonly confidence: number;
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
