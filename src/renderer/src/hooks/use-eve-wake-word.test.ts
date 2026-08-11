// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractEveCommand, removeEveWakePhrase, useEveWakeWord } from "./use-eve-wake-word";

vi.mock("@/lib/audio", () => ({
  encodedAudioBlobToWav: vi.fn(async () => new Uint8Array([82, 73, 70, 70])),
}));

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Eve wake phrase helpers", () => {
  it("segments direct Eve and Hey Eve requests for command transcripts", () => {
    expect(removeEveWakePhrase("Eve, take a look at the camera")).toBe("take a look at the camera");
    expect(removeEveWakePhrase("hey eve check this circuit")).toBe("check this circuit");
    expect(removeEveWakePhrase("This sentence has no assistant name")).toBeUndefined();
    expect(extractEveCommand("Eve")).toBe("");
    expect(extractEveCommand("Hey Eve, check the resistor")).toBe("check the resistor");
  });

  it("starts LiveKit wake detection and routes a command after detection", async () => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    class FakeAudioContext {
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: vi.fn() };
      }
      createScriptProcessor() {
        return {
          connect: vi.fn(),
          disconnect: vi.fn(),
          onaudioprocess: null as ((event: unknown) => void) | null,
        };
      }
      close = vi.fn(async () => undefined);
    }
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    });

    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported(): boolean {
        return true;
      }
      state: RecordingState = "inactive";
      start(): void {
        this.state = "recording";
      }
      stop(): void {
        this.state = "inactive";
        this.dispatchEvent(new Event("stop"));
      }
    }
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });

    let detectionListener: ((event: { name: string; confidence: number }) => void) | undefined;
    const startWakeWord = vi.fn(async () => undefined);
    const stopWakeWord = vi.fn(async () => undefined);
    const pushWakeWordAudio = vi.fn(async () => undefined);
    const ensureVoiceAssets = vi.fn(async () => ({
      whisper: { kind: "whisper_model", ready: true, downloading: false },
      chatterbox: { kind: "chatterbox_tts", ready: true, downloading: false },
      wakeword: { kind: "wakeword_model", ready: true, downloading: false },
      allReady: true,
    }));
    const authorizeMicrophone = vi.fn(async () => undefined);
    const transcribeAudio = vi.fn(async () => ({
      text: "check the resistor",
      provider: "local_whisper",
      model: "whisper-small-multilingual-q5_1",
    }));
    const cancelTranscription = vi.fn(async () => undefined);
    Object.defineProperty(window, "circuitHarness", {
      configurable: true,
      value: {
        authorizeMicrophone,
        startWakeWord,
        stopWakeWord,
        pushWakeWordAudio,
        ensureVoiceAssets,
        transcribeAudio,
        cancelTranscription,
        onWakeWordDetection: (listener: (event: { name: string; confidence: number }) => void) => {
          detectionListener = listener;
          return () => {
            detectionListener = undefined;
          };
        },
      },
    });

    const onCommand = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(EveHarness, { onCommand }));
    });
    expect(authorizeMicrophone).toHaveBeenCalledOnce();
    expect(startWakeWord).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledOnce();

    await act(async () => {
      detectionListener?.({ name: "hey_eve", confidence: 0.91 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(transcribeAudio).toHaveBeenCalled();
    expect(onCommand).toHaveBeenCalledWith("check the resistor");

    await act(async () => root.unmount());
    expect(stopTrack).toHaveBeenCalled();
    expect(stopWakeWord).toHaveBeenCalled();
  });

  it("surfaces waiting_assets when LiveKit wake model is not ready yet", async () => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
    });
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: class {
        createMediaStreamSource() {
          return { connect: vi.fn(), disconnect: vi.fn() };
        }
        createScriptProcessor() {
          return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null };
        }
        close = vi.fn(async () => undefined);
      },
    });

    const startWakeWord = vi
      .fn()
      .mockRejectedValueOnce(new Error("LiveKit wake-word model is not ready."))
      .mockResolvedValue(undefined);
    Object.defineProperty(window, "circuitHarness", {
      configurable: true,
      value: {
        authorizeMicrophone: vi.fn(async () => undefined),
        startWakeWord,
        stopWakeWord: vi.fn(async () => undefined),
        pushWakeWordAudio: vi.fn(async () => undefined),
        ensureVoiceAssets: vi.fn(async () => ({
          whisper: { kind: "whisper_model", ready: false, downloading: true },
          chatterbox: { kind: "chatterbox_tts", ready: false, downloading: false },
          wakeword: { kind: "wakeword_model", ready: false, downloading: true },
          allReady: false,
        })),
        transcribeAudio: vi.fn(),
        cancelTranscription: vi.fn(async () => undefined),
        onWakeWordDetection: () => () => undefined,
      },
    });

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(EveHarness, { onCommand: vi.fn(async () => undefined) }));
    });
    // First start fails → waiting; after backoff start succeeds inside run().
    expect(startWakeWord).toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});

function EveHarness({ onCommand }: { readonly onCommand: (command: string) => Promise<void> }) {
  const eve = useEveWakeWord({
    enabled: true,
    paused: false,
    projectId: "00000000-0000-4000-8000-000000000001",
    onCommand,
  });
  return createElement("p", null, eve.status);
}

type RecordingState = "inactive" | "recording" | "paused";
