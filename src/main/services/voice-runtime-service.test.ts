import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { VoiceRuntimeService } from "./voice-runtime-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("VoiceRuntimeService", () => {
  it("creates a venv, installs packages, and reports ready with progress messages", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "voice-runtime-"));
    temporaryDirectories.push(root);
    const statuses: Array<ReturnType<VoiceRuntimeService["getStatus"]>> = [];

    spawnMock.mockImplementation((executable: string, args: string[]) => {
      const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
      const child = {
        stdout: {
          on: (event: string, cb: (chunk: Buffer) => void) => {
            if (event === "data") {
              queueMicrotask(() => cb(Buffer.from(`ok ${args.join(" ")}\n`)));
            }
          },
        },
        stderr: { on: () => undefined },
        once: (event: string, cb: (...a: unknown[]) => void) => {
          listeners[event] = listeners[event] ?? [];
          listeners[event]?.push(cb);
          if (event === "exit") {
            queueMicrotask(async () => {
              // Simulate venv python path creation on first venv call.
              if (args.includes("venv")) {
                const bin = path.join(root, "venv", "bin");
                await mkdir(bin, { recursive: true });
                await writeFile(path.join(bin, "python"), "#!/bin/sh\n", { mode: 0o755 });
              }
              for (const handler of listeners.exit ?? []) handler(0, null);
            });
          }
        },
      };
      void executable;
      return child;
    });

    const service = new VoiceRuntimeService(root, "python3", ["livekit-wakeword==0.2.1"], (s) =>
      statuses.push(s),
    );
    await service.ensureRuntime();
    expect(service.getStatus().ready).toBe(true);
    expect(service.getPythonExecutable()).toContain(`${path.sep}venv${path.sep}`);
    expect(statuses.some((status) => status.installing)).toBe(true);
    expect(statuses.at(-1)?.message).toMatch(/ready/i);
    await access(path.join(root, "install-marker.json"));
  });
});
