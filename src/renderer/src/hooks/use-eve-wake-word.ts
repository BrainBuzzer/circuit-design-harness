import { useEffect, useRef, useState } from "react";
import { encodedAudioBlobToWav } from "@/lib/audio";

const WAKE_SEGMENT_MS = 2_500;
const COMMAND_SEGMENT_MS = 8_000;
const WAKE_PATTERN = /\b(?:hey\s+)?eve\b[\s,.:;!?-]*/i;

export type EveWakeState =
  | "off"
  | "requesting"
  | "listening"
  | "processing"
  | "command_listening"
  | "error";

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
      return;
    }

    let disposed = false;
    let stream: MediaStream | undefined;
    let recorder: MediaRecorder | undefined;

    const stop = (): void => {
      if (recorder?.state === "recording") {
        recorder.stop();
      }
      for (const track of stream?.getTracks() ?? []) {
        track.stop();
      }
      void window.circuitHarness.cancelTranscription(projectId);
    };

    const recordSegment = async (durationMs: number): Promise<Blob> => {
      if (!stream || disposed) {
        throw new Error("Eve microphone session is no longer active.");
      }
      const chunks: Blob[] = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      recorder = new MediaRecorder(stream, { mimeType });
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          if (recorder?.state === "recording") {
            recorder.stop();
          }
        }, durationMs);
        recorder?.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        });
        recorder?.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("Eve could not record from the selected microphone."));
        });
        recorder?.addEventListener("stop", () => {
          window.clearTimeout(timer);
          resolve(new Blob(chunks, { type: mimeType }));
        });
        recorder?.start(250);
      });
    };

    const transcribe = async (blob: Blob, durationMs: number): Promise<string> => {
      const wavBytes = await encodedAudioBlobToWav(blob);
      const result = await window.circuitHarness.transcribeAudio({
        projectId,
        wavBytes,
        durationMs,
      });
      return result.text.trim();
    };

    const run = async (): Promise<void> => {
      try {
        setState("requesting");
        setStatus("Requesting microphone access for Eve…");
        await window.circuitHarness.authorizeMicrophone();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
        while (!disposed) {
          setState("listening");
          setStatus("Listening locally for “Eve” or “Hey Eve”");
          const wakeAudio = await recordSegment(WAKE_SEGMENT_MS);
          if (disposed) break;
          setState("processing");
          setStatus("Checking the wake phrase locally…");
          const transcript = await transcribe(wakeAudio, WAKE_SEGMENT_MS);
          const match = WAKE_PATTERN.exec(transcript);
          if (!match) continue;
          let command = transcript.slice((match.index ?? 0) + match[0].length).trim();
          if (!command) {
            setState("command_listening");
            setStatus("Eve heard you — listening for your request…");
            command = await transcribe(await recordSegment(COMMAND_SEGMENT_MS), COMMAND_SEGMENT_MS);
          }
          if (command && !disposed) {
            setState("processing");
            setStatus(`Eve heard: “${command.slice(0, 80)}”`);
            await onCommandRef.current(command);
          }
        }
      } catch (reason) {
        if (!disposed) {
          setState("error");
          setStatus(reason instanceof Error ? reason.message : "Eve voice control failed.");
        }
      } finally {
        stop();
      }
    };

    void run();
    return () => {
      disposed = true;
      stop();
    };
  }, [enabled, paused, projectId]);

  return { state, status };
}

export function removeEveWakePhrase(transcript: string): string | undefined {
  const match = WAKE_PATTERN.exec(transcript);
  return match ? transcript.slice((match.index ?? 0) + match[0].length).trim() : undefined;
}
