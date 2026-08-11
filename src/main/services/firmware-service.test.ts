import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFirmwareCommandStoragePolicy,
  type FirmwareCommandRequest,
  type FirmwareCommandRunner,
  FirmwareService,
} from "./firmware-service";
import { ProjectService } from "./project-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FirmwareService", () => {
  it("prohibits persistent QEMU output paths while allowing bounded firmware input", () => {
    const baseRequest = {
      executable: "qemu-system-xtensa",
      cwd: "/tmp/fixture",
      timeoutMs: 5_000,
    } as const;
    expect(() =>
      assertFirmwareCommandStoragePolicy({
        ...baseRequest,
        args: ["-machine", "esp32s3", "-D", "/tmp/unbounded.log"],
      }),
    ).toThrow("Persistent QEMU output is prohibited");
    expect(() =>
      assertFirmwareCommandStoragePolicy({
        ...baseRequest,
        args: ["-machine", "esp32s3", "-serial", "file:/tmp/unbounded.log"],
      }),
    ).toThrow("Persistent QEMU output is prohibited");
    expect(() =>
      assertFirmwareCommandStoragePolicy({
        ...baseRequest,
        args: ["-machine", "esp32s3", "-drive", "file=firmware.bin,if=mtd,format=raw"],
      }),
    ).not.toThrow();
  });

  it("keeps non-S3 ESPHome boards in the reference catalog without claiming simulation", async () => {
    const fixture = await createFixture();
    const yaml = `esphome:
  name: bench-node

esp32:
  board: esp32dev

logger:
i2c:
sensor:
  - platform: dht
    pin: GPIO23
    temperature:
      name: Bench temperature
`;
    const result = await fixture.service.validateEspHome({ projectId: fixture.projectId, yaml });
    expect(result.valid).toBe(true);
    expect(result.structuralValidation).toBe("passed");
    expect(result.boardId).toBe("esp32dev");
    expect(result.targetId).toBe("esp32");
    expect(result.detectedComponents).toEqual(
      expect.arrayContaining(["dht", "esphome", "esp32", "i2c", "logger", "sensor"]),
    );
    expect(result.requiredFeatures).toContain("i2c");
    expect(result.simulation).toBeUndefined();
    expect(result.issues.map((issue) => issue.code)).toContain("unsupported_product_target");
    expect(
      await readFile(path.join(fixture.projectDirectory, "firmware", "esphome.yaml"), "utf8"),
    ).toBe(yaml);
  });

  it("reports unknown boards and skips native expansion of external sources", async () => {
    const fixture = await createFixture();
    const result = await fixture.service.validateEspHome({
      projectId: fixture.projectId,
      yaml: `esphome:
  name: unsafe-node
esp32:
  board: made_up_board
external_components:
  - source: github://example/components
`,
    });
    expect(result.valid).toBe(false);
    expect(result.nativeValidation).toBe("skipped_unsafe_features");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["unknown_board", "native_validation_sandbox_required"]),
    );
  });

  it("reports YAML syntax errors without invoking a native tool", async () => {
    const fixture = await createFixture();
    const result = await fixture.service.validateEspHome({
      projectId: fixture.projectId,
      yaml: "esphome: [\n",
    });
    expect(result.valid).toBe(false);
    expect(result.structuralValidation).toBe("failed");
    expect(result.issues[0]?.code).toBe("yaml_syntax");
  });

  it("saves and invokes Arduino CLI with an allowlisted target mapping", async () => {
    const commands: FirmwareCommandRequest[] = [];
    const fixture = await createFixture(async (request) => {
      commands.push(request);
      if (request.executable === "arduino-cli") {
        const outputIndex = request.args.indexOf("--output-dir");
        const outputDirectory = request.args[outputIndex + 1];
        if (outputDirectory) {
          await mkdir(outputDirectory, { recursive: true });
          await writeFile(path.join(outputDirectory, "CircuitHarness.ino.elf"), "fixture");
        }
      }
      if (request.executable === "circuit-simavr-trace") {
        return { outcome: "passed", output: unoTraceOutput() };
      }
      return { outcome: "passed", output: "Sketch uses 924 bytes" };
    });
    const source = `void setup() { Serial.begin(115200); pinMode(13, OUTPUT); }
void loop() { digitalWrite(13, HIGH); }
`;
    const result = await fixture.service.compileArduino({
      projectId: fixture.projectId,
      targetId: "arduino_uno_r3",
      source,
    });
    expect(result.sourceValid).toBe(true);
    expect(result.fqbn).toBe("arduino:avr:uno");
    expect(result.requiredFeatures).toEqual(expect.arrayContaining(["gpio", "uart"]));
    expect(result.compilation.outcome).toBe("passed");
    expect(result.compilation.artifactRelativePaths).toContain(
      "firmware/arduino/build/arduino_uno_r3/CircuitHarness.ino.elf",
    );
    expect(commands[0]?.executable).toBe("arduino-cli");
    expect(commands[0]?.args).toEqual(expect.arrayContaining(["--fqbn", "arduino:avr:uno"]));
    expect(
      await readFile(
        path.join(fixture.projectDirectory, "firmware/arduino/CircuitHarness/CircuitHarness.ino"),
        "utf8",
      ),
    ).toBe(source);
    const simulation = await fixture.service.runSimulation({
      projectId: fixture.projectId,
      targetId: "arduino_uno_r3",
      firmwareKind: "arduino",
      engine: "simavr",
    });
    expect(simulation.outcome).toBe("executed");
    expect(simulation.firmwareArtifactRelativePath).toBe(
      "firmware/arduino/build/arduino_uno_r3/CircuitHarness.ino.elf",
    );
    expect(commands[1]?.executable).toBe("circuit-simavr-trace");
    expect(simulation.trace?.finalPins.D13).toBe(1);
    expect(simulation.coverage.gpioOutputTrace).toBe("verified");
  });

  it("runs native ESPHome validation before compilation and reports generated artifacts", async () => {
    const commands: FirmwareCommandRequest[] = [];
    const fixture = await createFixture(async (request) => {
      commands.push(request);
      if (request.args[0] === "compile") {
        const artifactDirectory = path.join(request.cwd, ".esphome/build/bench/.pioenvs/bench");
        await mkdir(artifactDirectory, { recursive: true });
        await writeFile(path.join(artifactDirectory, "firmware.elf"), "fixture");
      }
      return { outcome: "passed", output: `${request.args[0]} passed` };
    });
    const yaml = "esphome:\n  name: bench\nesp32:\n  board: esp32-s3-devkitc-1\nlogger:\n";
    const result = await fixture.service.compileEspHome({
      projectId: fixture.projectId,
      yaml,
    });
    expect(result.validation.valid).toBe(true);
    expect(result.compilation.outcome).toBe("passed");
    expect(result.compilation.artifactRelativePaths).toContain(
      "firmware/.esphome/build/bench/.pioenvs/bench/firmware.elf",
    );
    expect(commands.map((command) => command.args[0])).toEqual(["config", "compile"]);
  });

  it("does not classify a successful process without a valid signal record as execution", async () => {
    const fixture = await createFixture(async (request) => {
      if (request.executable === "arduino-cli") {
        const outputDirectory = request.args[request.args.indexOf("--output-dir") + 1];
        if (!outputDirectory) throw new Error("Expected Arduino output directory.");
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, "CircuitHarness.ino.elf"), "fixture");
      }
      return { outcome: "passed", output: "process exited zero without a trace marker" };
    });
    await fixture.service.compileArduino({
      projectId: fixture.projectId,
      targetId: "arduino_uno_r3",
      source: "void setup() {}\nvoid loop() {}\n",
    });
    const result = await fixture.service.runSimulation({
      projectId: fixture.projectId,
      targetId: "arduino_uno_r3",
      firmwareKind: "arduino",
      engine: "simavr",
    });
    expect(result.outcome).toBe("failed");
    expect(result.coverage.cpuExecution).toBe("not_executed");
    expect(result.coverage.gpioOutputTrace).toBe("unavailable");
  });

  it("runs the local ESP32-S3 QEMU model only when the exact machine is present", async () => {
    const commands: FirmwareCommandRequest[] = [];
    const fixture = await createFixture(async (request) => {
      commands.push(request);
      if (request.executable === "arduino-cli") {
        const outputIndex = request.args.indexOf("--output-dir");
        const outputDirectory = request.args[outputIndex + 1];
        if (!outputDirectory) {
          throw new Error("Expected Arduino output directory.");
        }
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, "CircuitHarness.ino.merged.bin"), "fixture");
        return { outcome: "passed" };
      }
      if (request.args[0] === "-machine" && request.args[1] === "help") {
        return {
          outcome: "passed",
          output: "Supported machines are:\nesp32s3  Espressif ESP32-S3\n",
        };
      }
      return { outcome: "timed_out", output: "ESP-ROM:esp32" };
    });
    await fixture.service.compileArduino({
      projectId: fixture.projectId,
      targetId: "esp32s3",
      source: "void setup() {}\nvoid loop() {}\n",
    });
    const result = await fixture.service.runSimulation({
      projectId: fixture.projectId,
      targetId: "esp32s3",
      firmwareKind: "arduino",
      engine: "qemu",
    });
    expect(result.outcome).toBe("executed");
    expect(result.firmwareArtifactRelativePath).toBe(
      "firmware/arduino/build/esp32s3/CircuitHarness.ino.merged.bin",
    );
    expect(commands.at(-1)?.executable).toBe("qemu-system-xtensa");
    expect(commands.at(-1)?.args).toEqual(
      expect.arrayContaining(["-machine", "esp32s3", "-nographic"]),
    );
  });

  it("rejects generic architecture QEMU as an ESP32-S3 simulator", async () => {
    const fixture = await createFixture(async (request) => {
      if (request.executable === "arduino-cli") {
        const outputDirectory = request.args[request.args.indexOf("--output-dir") + 1];
        if (!outputDirectory) {
          throw new Error("Expected Arduino output directory.");
        }
        await mkdir(outputDirectory, { recursive: true });
        await writeFile(path.join(outputDirectory, "CircuitHarness.ino.merged.bin"), "fixture");
        return { outcome: "passed" };
      }
      return { outcome: "passed", output: "Supported machines are:\nvirt  RISC-V VirtIO\n" };
    });
    await fixture.service.compileArduino({
      projectId: fixture.projectId,
      targetId: "esp32s3",
      source: "void setup() {}\nvoid loop() {}\n",
    });
    const result = await fixture.service.runSimulation({
      projectId: fixture.projectId,
      targetId: "esp32s3",
      firmwareKind: "arduino",
      engine: "qemu",
    });
    expect(result.outcome).toBe("not_available");
    expect(result.summary).toContain("Generic system QEMU is not accepted");
  });
});

function unoTraceOutput(): string {
  return `CDH_TRACE_V1 ${JSON.stringify({
    schemaVersion: 1,
    targetId: "arduino_uno_r3",
    engine: "simavr",
    clockHz: 16_000_000,
    requestedDurationMicros: 250_000,
    cyclesExecuted: 4_000_000,
    termination: "duration_reached",
    pinEvents: [{ cycle: 100, pin: "D13", level: 1 }],
    finalPins: { D13: 1 },
    uartEvents: [],
    pinEventsTruncated: false,
    uartEventsTruncated: false,
  })}`;
}

async function createFixture(commandRunner?: FirmwareCommandRunner): Promise<{
  readonly service: FirmwareService;
  readonly projectId: string;
  readonly projectDirectory: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "firmware-service-test-"));
  temporaryDirectories.push(root);
  const projects = new ProjectService(
    path.join(root, "app-data", "settings.json"),
    path.join(root, "projects"),
  );
  await projects.initialize();
  const state = await projects.createProject("Firmware fixture");
  const projectId = state.activeProjectId;
  if (!projectId) {
    throw new Error("Expected a project ID.");
  }
  return {
    service: new FirmwareService(projects, commandRunner),
    projectId,
    projectDirectory: await projects.getProjectDirectory(projectId),
  };
}
