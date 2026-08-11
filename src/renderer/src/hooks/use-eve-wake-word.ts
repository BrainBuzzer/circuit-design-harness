import { useEffect, useRef, useState } from "react";
import { encodedAudioBlobToWav } from "@/lib/audio";

const COMMAND_SEGMENT_MS = 8_000;
const TARGET_SAMPLE_RATE = 16_000;
const WINDOW_SAMPLES = 32_000; // ~2s at 16 kHz for LiveKit/openWakeWord
const HOP_SAMPLES = 1_280; // 80 ms
const UNAVAILABLE_BACKOFF_MS = 4_000;
const MAX_UNAVAILABLE_BACKOFF_MS = 30_000;

export type EveWakeState =
  | "off"
  | "requesting"
  | "listening"
  | "processing"
  | "command_listening"
  | "waiting_assets"
  | "error";

/**
 * Eve wake control using LiveKit wake-word ONNX detection for the trigger,
 * then a single Whisper transcription only for the follow-up command segment.
 */
export function useEveWakeWord({
  enabled,
  paused,
  projectId,
  onCommand,
}: {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly projectId: string;
  readonly onCommand: (command: string) => Promise<void>;
}): { readonly state: EveWakeState; readonly status: string } {
  const [state, setState] = useState<EveWakeState>("off");
  const [status, setStatus] = useState("Eve wake word is off");
  const onCommandRef = useRef(onCommand);
  const handlingDetectionRef = useRef(false);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (!enabled || paused) {
      setState("off");
      setStatus(
        enabled
          ? "Eve is paused while the assistant or microphone is active"
          : "Eve wake word is off",
      );
      void window.circuitHarness.stopWakeWord();
      return;
    }

    let disposed = false;
    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let processor: ScriptProcessorNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;
    const pcmRing: number[] = [];
    let samplesSinceLastPush = 0;

    const stopMic = (): void => {
      processor?.disconnect();
      source?.disconnect();
      void audioContext?.close();
      processor = undefined;
      source = undefined;
      audioContext = undefined;
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      stream = undefined;
      void window.circuitHarness.stopWakeWord();
      void window.circuitHarness.cancelTranscription(projectId);
    };

    const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const recordCommandSegment = async (): Promise<Blob> => {
      if (!stream || disposed) {
        throw new Error("Eve microphone session is no longer active.");
      }
      const chunks: Blob[] = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        }, COMMAND_SEGMENT_MS);
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        recorder.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("Eve could not record the command segment."));
        });
        recorder.addEventListener("stop", () => {
          window.clearTimeout(timer);
          resolve(new Blob(chunks, { type: mimeType }));
        });
        recorder.start(250);
      });
    };

    const transcribeCommand = async (blob: Blob): Promise<string> => {
      const wavBytes = await encodedAudioBlobToWav(blob);
      const result = await window.circuitHarness.transcribeAudio({
        projectId,
        wavBytes,
        durationMs: COMMAND_SEGMENT_MS,
      });
      return result.text.trim();
    };

    const isAssetUnavailable = (reason: unknown): boolean => {
      const message = reason instanceof Error ? reason.message : String(reason);
      return /whisper runtime is unavailable|voice assets are still downloading|wake-word model is not ready|failed verification|livekit-wakeword is not installed/i.test(
        message,
      );
    };

    const handleDetection = async (confidence: number): Promise<void> => {
      if (disposed || handlingDetectionRef.current) {
        return;
      }
      handlingDetectionRef.current = true;
      try {
        setState("command_listening");
        setStatus(
          `Eve heard the wake word (${(confidence * 100).toFixed(0)}%) — listening for your request…`,
        );
        // Pause wake scoring while we capture the command to avoid re-triggers.
        void window.circuitHarness.stopWakeWord();
        const command = await transcribeCommand(await recordCommandSegment());
        if (command && !disposed) {
          setState("processing");
          setStatus(`Eve heard: “${command.slice(0, 80)}”`);
          await onCommandRef.current(command);
        }
        if (!disposed) {
          setState("listening");
          setStatus("Listening locally for “Eve” / “Hey Eve” (LiveKit wake word)");
          await window.circuitHarness.startWakeWord();
        }
      } catch (reason) {
        if (disposed) return;
        if (isAssetUnavailable(reason)) {
          setState("waiting_assets");
          setStatus(
            "Eve is waiting for local voice assets (wake word / Whisper)… will retry automatically.",
          );
          void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
          await sleep(unavailableBackoffMs);
          unavailableBackoffMs = Math.min(unavailableBackoffMs * 1.5, MAX_UNAVAILABLE_BACKOFF_MS);
          if (!disposed) {
            try {
              await window.circuitHarness.startWakeWord();
              setState("listening");
              setStatus("Listening locally for “Eve” / “Hey Eve” (LiveKit wake word)");
            } catch {
              // stay waiting
            }
          }
        } else {
          setState("error");
          setStatus(reason instanceof Error ? reason.message : "Eve voice control failed.");
        }
      } finally {
        handlingDetectionRef.current = false;
      }
    };

    const pushWindow = async (): Promise<void> => {
      if (disposed || handlingDetectionRef.current || pcmRing.length < WINDOW_SAMPLES) {
        return;
      }
      const windowSamples = pcmRing.slice(pcmRing.length - WINDOW_SAMPLES);
      const pcm16 = new Int16Array(windowSamples.length);
      for (let index = 0; index < windowSamples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, windowSamples[index] ?? 0));
        pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }
      try {
        // Structured-clone Int16Array across IPC as a plain number array.
        await window.circuitHarness.pushWakeWordAudio({ pcm16: Array.from(pcm16) });
      } catch (reason) {
        if (!disposed && isAssetUnavailable(reason)) {
          setState("waiting_assets");
          setStatus("Eve is waiting for the LiveKit wake-word model…");
          void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
        }
      }
    };

    const run = async (): Promise<void> => {
      try {
        setState("requesting");
        setStatus("Requesting microphone access for Eve…");
        await window.circuitHarness.authorizeMicrophone();
        void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
        try {
          await window.circuitHarness.startWakeWord();
        } catch (reason) {
          if (isAssetUnavailable(reason)) {
            setState("waiting_assets");
            setStatus(
              "Eve is waiting for the LiveKit wake-word model download… will retry automatically.",
            );
            await sleep(unavailableBackoffMs);
            if (disposed) return;
            await window.circuitHarness.startWakeWord();
          } else {
            throw reason;
          }
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
        // Some browsers ignore the requested rate; we still treat buffer as ~16 kHz-ish.
        source = audioContext.createMediaStreamSource(stream);
        // ScriptProcessor is deprecated but widely available without worklet packaging.
        processor = audioContext.createScriptProcessor(HOP_SAMPLES, 1, 1);
        processor.onaudioprocess = (event) => {
          if (disposed || handlingDetectionRef.current) return;
          const input = event.inputBuffer.getChannelData(0);
          for (let index = 0; index < input.length; index += 1) {
            pcmRing.push(input[index] ?? 0);
          }
          if (pcmRing.length > WINDOW_SAMPLES * 2) {
            pcmRing.splice(0, pcmRing.length - WINDOW_SAMPLES);
          }
          samplesSinceLastPush += input.length;
          if (samplesSinceLastPush >= HOP_SAMPLES) {
            samplesSinceLastPush = 0;
            void pushWindow();
          }
        };
        source.connect(processor);
        processor.connect(audioContext.destination);

        setState("listening");
        setStatus("Listening locally for “Eve” / “Hey Eve” (LiveKit wake word)");
      } catch (reason) {
        if (!disposed) {
          setState("error");
          setStatus(reason instanceof Error ? reason.message : "Eve voice control failed.");
        }
        stopMic();
      }
    };

    const unsubscribe = window.circuitHarness.onWakeWordDetection((event) => {
      void handleDetection(event.confidence);
    });

    void run();
    return () => {
      disposed = true;
      unsubscribe();
      stopMic();
    };
  }, [enabled, paused, projectId]);

  return { state, status };
}

/**
 * Kept for transcript-based tools/tests (camera routing phrases). LiveKit ONNX
 * handles continuous wake detection; this only strips a spoken Eve prefix.
 */
export function extractEveCommand(transcript: string): string | undefined {
  const match = /\b(?:hey\s+)?eve\b[\s,.:;!?-]*/i.exec(transcript);
  if (!match) {
    return undefined;
  }
  return transcript.slice((match.index ?? 0) + match[0].length).trim();
}

/** @deprecated Prefer extractEveCommand */
export function removeEveWakePhrase(transcript: string): string | undefined {
  return extractEveCommand(transcript);
}
