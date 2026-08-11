import { useEffect, useRef, useState } from "react";
import { downsample, encodedAudioBlobToWav, float32ToPcm16, rmsLevel } from "@/lib/audio";

const COMMAND_SEGMENT_MS = 8_000;
const TARGET_SAMPLE_RATE = 16_000;
/** LiveKit/openWakeWord wants ~2 s of 16 kHz mono per predict call. */
const WINDOW_SAMPLES = 32_000;
/**
 * ScriptProcessor bufferSize must be 0 or a power of two in [256, 16384].
 * Actual device rate is often 44.1/48 kHz — we resample before scoring.
 */
const SCRIPT_PROCESSOR_BUFFER = 1_024;
/** Push a scored window about every 250 ms of *target* audio (reduces IPC load). */
const HOP_SAMPLES_16K = 4_000;
const UNAVAILABLE_BACKOFF_MS = 4_000;
const MAX_UNAVAILABLE_BACKOFF_MS = 30_000;
const STATUS_LEVEL_INTERVAL_MS = 400;

export type EveWakeState =
  | "off"
  | "requesting"
  | "listening"
  | "processing"
  | "command_listening"
  | "waiting_assets"
  | "error";

/**
 * Wake control using the trained LiveKit hey_livekit ONNX classifier
 * (LiveKit wakeword). On detection, records one command segment and runs Whisper once.
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
  const [status, setStatus] = useState("Wake word is off");
  const onCommandRef = useRef(onCommand);
  const handlingDetectionRef = useRef(false);
  const lastScoreRef = useRef(0);
  const lastLevelRef = useRef(0);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    if (!enabled || paused) {
      setState("off");
      setStatus(
        enabled
          ? "Wake word is paused while the assistant or microphone is active"
          : "Wake word is off",
      );
      void window.circuitHarness.stopWakeWord();
      return;
    }

    let disposed = false;
    let stream: MediaStream | undefined;
    let audioContext: AudioContext | undefined;
    let processor: ScriptProcessorNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let silentGain: GainNode | undefined;
    let unavailableBackoffMs = UNAVAILABLE_BACKOFF_MS;
    /** Ring of float samples already resampled to 16 kHz. */
    const pcmRing16k: number[] = [];
    let samplesSinceLastPush = 0;
    let pushInFlight = false;
    let pendingPush = false;
    let statusTimer: number | undefined;

    const stopMic = (): void => {
      if (statusTimer !== undefined) {
        window.clearInterval(statusTimer);
        statusTimer = undefined;
      }
      processor?.disconnect();
      silentGain?.disconnect();
      source?.disconnect();
      void audioContext?.close();
      processor = undefined;
      silentGain = undefined;
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

    const isAssetUnavailable = (reason: unknown): boolean => {
      const message = reason instanceof Error ? reason.message : String(reason);
      return /whisper runtime is unavailable|voice assets are still downloading|wake-word model is not ready|failed verification|livekit-wakeword is not installed|Python voice runtime/i.test(
        message,
      );
    };

    const listeningStatus = (): string => {
      const levelPct = Math.round(lastLevelRef.current * 100);
      const scorePct = Math.round(lastScoreRef.current * 100);
      return `Listening for “Hey LiveKit” · mic ${levelPct}% · score ${scorePct}%`;
    };

    const recordCommandSegment = async (): Promise<Blob> => {
      if (!stream || disposed) {
        throw new Error("Wake-word microphone session is no longer active.");
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
          reject(new Error("Could not record the command segment."));
        });
        recorder.addEventListener("stop", () => {
          window.clearTimeout(timer);
          resolve(new Blob(chunks, { type: mimeType }));
        });
        recorder.start(250);
      });
    };

    const handleWake = async (confidence: number): Promise<void> => {
      if (disposed || handlingDetectionRef.current) return;
      handlingDetectionRef.current = true;
      try {
        setState("command_listening");
        setStatus(
          `“Hey LiveKit” detected (${(confidence * 100).toFixed(0)}%) — listening for your request…`,
        );
        void window.circuitHarness.stopWakeWord();
        const commandBlob = await recordCommandSegment();
        const wavBytes = await encodedAudioBlobToWav(commandBlob);
        const result = await window.circuitHarness.transcribeAudio({
          projectId,
          wavBytes,
          durationMs: COMMAND_SEGMENT_MS,
        });
        // Optional cleanup if Whisper still heard the wake phrase.
        const cleaned = extractEveCommand(result.text) ?? result.text.trim();
        const command = cleaned.trim();
        if (command && !disposed) {
          setState("processing");
          setStatus(`Heard: “${command.slice(0, 80)}” — sending to the model…`);
          await onCommandRef.current(command);
        } else if (!disposed) {
          setStatus("Heard silence after the wake word — say your request after “Hey LiveKit”.");
        }
        if (!disposed) {
          setState("listening");
          setStatus(listeningStatus());
          await window.circuitHarness.startWakeWord();
        }
      } catch (reason) {
        if (disposed) return;
        if (isAssetUnavailable(reason)) {
          setState("waiting_assets");
          setStatus("Waiting for voice assets / Python runtime… retrying.");
          void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
          await sleep(unavailableBackoffMs);
          unavailableBackoffMs = Math.min(unavailableBackoffMs * 1.5, MAX_UNAVAILABLE_BACKOFF_MS);
          if (!disposed) {
            try {
              await window.circuitHarness.startWakeWord();
              setState("listening");
              setStatus(listeningStatus());
            } catch {
              // remain waiting
            }
          }
        } else {
          setState("error");
          setStatus(reason instanceof Error ? reason.message : "Wake word control failed.");
        }
      } finally {
        handlingDetectionRef.current = false;
      }
    };

    const pushWindow = async (): Promise<void> => {
      if (disposed || handlingDetectionRef.current || pcmRing16k.length < WINDOW_SAMPLES) {
        return;
      }
      if (pushInFlight) {
        pendingPush = true;
        return;
      }
      pushInFlight = true;
      try {
        do {
          pendingPush = false;
          if (disposed || handlingDetectionRef.current || pcmRing16k.length < WINDOW_SAMPLES) {
            break;
          }
          const windowSamples = pcmRing16k.slice(pcmRing16k.length - WINDOW_SAMPLES);
          lastLevelRef.current = rmsLevel(windowSamples);
          const pcm16 = float32ToPcm16(Float32Array.from(windowSamples));
          try {
            await window.circuitHarness.pushWakeWordAudio({ pcm16: Array.from(pcm16) });
          } catch (reason) {
            if (!disposed && isAssetUnavailable(reason)) {
              setState("waiting_assets");
              setStatus("Waiting for the LiveKit wake-word runtime…");
              void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
            }
            break;
          }
        } while (pendingPush && !disposed);
      } finally {
        pushInFlight = false;
      }
    };

    const run = async (): Promise<void> => {
      try {
        setState("requesting");
        setStatus("Requesting microphone access…");
        await window.circuitHarness.authorizeMicrophone();
        void window.circuitHarness.ensureVoiceAssets().catch(() => undefined);
        try {
          await window.circuitHarness.startWakeWord();
        } catch (reason) {
          if (isAssetUnavailable(reason)) {
            setState("waiting_assets");
            setStatus("Installing/downloading LiveKit wake-word runtime… will retry.");
            await sleep(unavailableBackoffMs);
            if (disposed) return;
            await window.circuitHarness.startWakeWord();
          } else {
            throw reason;
          }
        }

        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
          },
          video: false,
        });
        // Browsers often ignore a requested 16 kHz rate and open at 44.1/48 kHz.
        // Always measure the real rate and resample to what LiveKit expects.
        audioContext = new AudioContext();
        if (audioContext.state === "suspended") {
          await audioContext.resume();
        }
        const sourceRate = audioContext.sampleRate || TARGET_SAMPLE_RATE;
        source = audioContext.createMediaStreamSource(stream);
        processor = audioContext.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1);
        // Keep the processor graph alive without playing the mic into speakers
        // (which would feedback into wake detection / TTS).
        silentGain = audioContext.createGain();
        silentGain.gain.value = 0;
        processor.onaudioprocess = (event) => {
          if (disposed || handlingDetectionRef.current) return;
          const input = event.inputBuffer.getChannelData(0);
          const inputCopy = new Float32Array(input.length);
          inputCopy.set(input);
          const at16k =
            sourceRate === TARGET_SAMPLE_RATE
              ? inputCopy
              : downsample(inputCopy, sourceRate, TARGET_SAMPLE_RATE);
          for (let index = 0; index < at16k.length; index += 1) {
            pcmRing16k.push(at16k[index] ?? 0);
          }
          if (pcmRing16k.length > WINDOW_SAMPLES * 2) {
            pcmRing16k.splice(0, pcmRing16k.length - WINDOW_SAMPLES);
          }
          samplesSinceLastPush += at16k.length;
          if (samplesSinceLastPush >= HOP_SAMPLES_16K) {
            samplesSinceLastPush = 0;
            void pushWindow();
          }
        };
        source.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(audioContext.destination);

        setState("listening");
        setStatus(`Listening for “Hey LiveKit” (${sourceRate} Hz → 16 kHz) · say the wake phrase`);
        statusTimer = window.setInterval(() => {
          if (!disposed && !handlingDetectionRef.current) {
            setStatus(listeningStatus());
          }
        }, STATUS_LEVEL_INTERVAL_MS);
      } catch (reason) {
        if (!disposed) {
          setState("error");
          setStatus(reason instanceof Error ? reason.message : "Wake word control failed.");
        }
        stopMic();
      }
    };

    const unsubscribeDetection = window.circuitHarness.onWakeWordDetection((event) => {
      lastScoreRef.current = event.confidence;
      void handleWake(event.confidence);
    });
    const unsubscribeScores = window.circuitHarness.onWakeWordScores((event) => {
      const values = Object.values(event.scores);
      if (values.length > 0) {
        lastScoreRef.current = Math.max(...values);
      }
    });

    void run();
    return () => {
      disposed = true;
      unsubscribeDetection();
      unsubscribeScores();
      stopMic();
    };
  }, [enabled, paused, projectId]);

  return { state, status };
}

/** Strip a spoken LiveKit wake prefix from a command transcript (optional cleanup). */
export function extractEveCommand(transcript: string): string | undefined {
  const match = /\b(?:hey\s+)?(?:livekit|eve)\b[\s,.:;!?-]*/i.exec(transcript);
  if (!match) {
    return undefined;
  }
  return transcript.slice((match.index ?? 0) + match[0].length).trim();
}

/** @deprecated Prefer extractEveCommand */
export function removeEveWakePhrase(transcript: string): string | undefined {
  return extractEveCommand(transcript);
}
