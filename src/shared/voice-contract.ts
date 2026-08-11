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
