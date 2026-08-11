// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removeEveWakePhrase, useEveWakeWord } from "./use-eve-wake-word";

vi.mock("@/lib/audio", () => ({
  encodedAudioBlobToWav: vi.fn(async () => new Uint8Array([82, 73, 70, 70])),
}));

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("Eve wake phrase parsing", () => {
  it("segments direct Eve and Hey Eve requests", () => {
    expect(removeEveWakePhrase("Eve, take a look at the camera")).toBe("take a look at the camera");
    expect(removeEveWakePhrase("hey eve check this circuit")).toBe("check this circuit");
    expect(removeEveWakePhrase("This sentence has no assistant name")).toBeUndefined();
  });

  it("starts only when enabled and routes a segmented command to the active project", async () => {
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
    const authorizeMicrophone = vi.fn(async () => undefined);
    const transcribeAudio = vi.fn(async () => ({
      text: "Hey Eve, take a look at the camera",
      provider: "local_whisper",
      model: "whisper-small-multilingual-q5_1",
      durationMs: 2_500,
    }));
    const cancelTranscription = vi.fn(async () => undefined);
    Object.defineProperty(window, "circuitHarness", {
      configurable: true,
      value: { authorizeMicrophone, transcribeAudio, cancelTranscription },
    });
    const onCommand = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(EveHarness, { onCommand }));
    });
    expect(authorizeMicrophone).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(transcribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "00000000-0000-4000-8000-000000000001" }),
    );
    expect(onCommand).toHaveBeenCalledWith("take a look at the camera");

    await act(async () => root.unmount());
    expect(stopTrack).toHaveBeenCalled();
    expect(cancelTranscription).toHaveBeenCalled();
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
