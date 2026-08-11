import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WakeWordService } from "./wake-word-service";

vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: {
          writable: boolean;
          write: ReturnType<typeof vi.fn>;
          end: ReturnType<typeof vi.fn>;
        };
        stdout: EventEmitter;
        stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
        killed: boolean;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stdin = {
        writable: true,
        write: vi.fn((_buf: Buffer, cb?: (error?: Error | null) => void) => {
          cb?.(null);
          return true;
        }),
        end: vi.fn(),
      };
      child.stdout = new EventEmitter();
      child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
      });
      // Defer ready line so start() attaches listeners first.
      queueMicrotask(() => {
        child.stdout.emit("data", `${JSON.stringify({ type: "ready", model: "hey_eve" })}\n`);
      });
      return child;
    }),
  };
});

vi.mock("node:readline", () => {
  return {
    createInterface: ({ input }: { input: EventEmitter }) => {
      const iface = new EventEmitter();
      input.on("data", (chunk: string) => {
        for (const line of String(chunk).split("\n")) {
          if (line.trim()) iface.emit("line", line);
        }
      });
      return iface;
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("WakeWordService", () => {
  it("starts the LiveKit sidecar when the model is ready and accepts PCM frames", async () => {
    const events: unknown[] = [];
    const service = new WakeWordService(
      async () => ({
        modelPath: "/assets/wakeword/hey_eve.onnx",
        modelId: "hey_eve",
        threshold: 0.5,
        sampleRateHz: 16_000,
        windowSamples: 32_000,
        hopSamples: 1_280,
      }),
      "/app/scripts/wakeword-detect.py",
      "python3",
      (event) => events.push(event),
    );

    await service.start();
    expect(events.some((event) => (event as { type: string }).type === "ready")).toBe(true);
    expect(service.isReady()).toBe(true);

    await service.pushPcm16(new Int16Array(1_280));
    service.stop();
    expect(service.isRunning()).toBe(false);
  });

  it("rejects start when the wake-word model is not ready", async () => {
    const service = new WakeWordService(async () => undefined, "/app/scripts/wakeword-detect.py");
    await expect(service.start()).rejects.toThrow(/not ready/i);
  });
});
