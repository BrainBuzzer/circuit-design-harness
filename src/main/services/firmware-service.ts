import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assessSimulation, type EmbeddedFeature, EmbeddedTargetIdSchema } from "@domain/embedded";
import { EspHomeCatalogSchema } from "@domain/esphome-catalog";
import { parseSimavrTraceOutput } from "@domain/firmware-trace";
import type {
  CompileArduinoInput,
  CompileArduinoResult,
  CompileEspHomeResult,
  EspHomeValidationResult,
  FirmwareExecutionResult,
  FirmwareSimulationCoverage,
  FirmwareSimulationResult,
  FirmwareValidationIssue,
  ReadArduinoSketchResult,
  ReadEspHomeResult,
  RunFirmwareSimulationInput,
  ValidateEspHomeInput,
} from "@shared/firmware-contract";
import { parseDocument } from "yaml";
import catalogPayload from "../../catalog/esphome-components.json" with { type: "json" };
import { writeFileAtomic } from "./json-file";
import type { ProjectService } from "./project-service";

const execFileAsync = promisify(execFile);
const catalog = EspHomeCatalogSchema.parse(catalogPayload);
const MAX_FIRMWARE_TEXT_BYTES = 1024 * 1024;
const ARDUINO_SKETCH_RELATIVE_PATH = "firmware/arduino/CircuitHarness/CircuitHarness.ino" as const;
const ESPHOME_BUILD_RELATIVE_PATH = "firmware/.esphome";
const ARDUINO_BUILD_RELATIVE_PATH = "firmware/arduino/build";
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_OUTPUT_BYTES = 2 * 1024 * 1024;
const ARDUINO_FQBN: Readonly<Record<CompileArduinoInput["targetId"], string>> = {
  arduino_uno_r3: "arduino:avr:uno",
  esp32s3: "esp32:esp32:esp32s3",
};
const CONFIG_KEYS = new Set([
  "substitutions",
  "packages",
  "esphome",
  "esp32",
  "esp8266",
  "rp2040",
  "bk72xx",
  "rtl87xx",
  "nrf52",
  "host",
  "external_components",
]);

export interface FirmwareCommandRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
}

export interface FirmwareCommandResult {
  readonly outcome: "passed" | "failed" | "not_available" | "timed_out";
  readonly output?: string;
}

export type FirmwareCommandRunner = (
  request: FirmwareCommandRequest,
) => Promise<FirmwareCommandResult>;
export type FirmwareExecutableResolver = (name: string) => Promise<string | undefined>;

export class FirmwareService {
  constructor(
    private readonly projects: ProjectService,
    private readonly commandRunner: FirmwareCommandRunner = runFirmwareCommand,
    private readonly resolveExecutable: FirmwareExecutableResolver = async (name) => name,
  ) {}

  private async execute(request: FirmwareCommandRequest): Promise<FirmwareCommandResult> {
    assertFirmwareCommandStoragePolicy(request);
    const executable = await this.resolveExecutable(request.executable);
    if (!executable) {
      return { outcome: "not_available" };
    }
    return this.commandRunner({ ...request, executable });
  }

  async readArduino(projectId: string): Promise<ReadArduinoSketchResult> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const sketchPath = path.join(projectDirectory, ARDUINO_SKETCH_RELATIVE_PATH);
    try {
      return {
        source: await readFile(sketchPath, "utf8"),
        relativePath: ARDUINO_SKETCH_RELATIVE_PATH,
      };
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== "ENOENT") {
        throw reason;
      }
      return { source: "", relativePath: ARDUINO_SKETCH_RELATIVE_PATH };
    }
  }

  async readEspHome(projectId: string): Promise<ReadEspHomeResult> {
    const projectDirectory = await this.projects.getProjectDirectory(projectId);
    const configPath = path.join(projectDirectory, "firmware", "esphome.yaml");
    try {
      return { yaml: await readFile(configPath, "utf8"), relativePath: "firmware/esphome.yaml" };
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== "ENOENT") {
        throw reason;
      }
      return { yaml: "", relativePath: "firmware/esphome.yaml" };
    }
  }

  async compileArduino(input: CompileArduinoInput): Promise<CompileArduinoResult> {
    const byteSize = Buffer.byteLength(input.source);
    if (byteSize === 0 || byteSize > MAX_FIRMWARE_TEXT_BYTES) {
      throw new Error("Arduino source must be between 1 byte and 1 MiB.");
    }
    const targetId = EmbeddedTargetIdSchema.parse(input.targetId);
    const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
    const sketchPath = path.join(projectDirectory, ARDUINO_SKETCH_RELATIVE_PATH);
    const sketchDirectory = path.dirname(sketchPath);
    const buildDirectory = path.join(projectDirectory, ARDUINO_BUILD_RELATIVE_PATH, targetId);
    await mkdir(sketchDirectory, { recursive: true, mode: 0o700 });
    await mkdir(buildDirectory, { recursive: true, mode: 0o700 });
    await writeFileAtomic(sketchPath, input.source);

    const issues = validateArduinoSource(input.source);
    const requiredFeatures = inferArduinoFeatures(input.source);
    const simulation = assessSimulation({
      targetId,
      requiredFeatures: ["cpu", ...requiredFeatures],
    });
    const fqbn = ARDUINO_FQBN[targetId];
    let compilation: FirmwareExecutionResult;
    if (issues.some((issue) => issue.severity === "error")) {
      compilation = {
        outcome: "blocked",
        summary: "Compilation was blocked by source validation errors.",
        artifactRelativePaths: [],
      };
    } else {
      const command = await this.execute({
        executable: "arduino-cli",
        args: [
          "compile",
          "--fqbn",
          fqbn,
          "--output-dir",
          buildDirectory,
          "--warnings",
          "all",
          sketchDirectory,
        ],
        cwd: sketchDirectory,
        timeoutMs: COMMAND_TIMEOUT_MS,
      });
      compilation = await executionFromCommand(
        command,
        projectDirectory,
        buildDirectory,
        command.outcome === "passed"
          ? `Arduino CLI compiled the sketch for ${fqbn}.`
          : command.outcome === "not_available"
            ? "Arduino CLI is not installed or not available on PATH. The source was saved and statically checked only."
            : `Arduino CLI failed to compile the sketch for ${fqbn}.`,
      );
    }

    return {
      targetId,
      ...(fqbn ? { fqbn } : {}),
      sourceValid: !issues.some((issue) => issue.severity === "error"),
      requiredFeatures,
      simulation,
      issues,
      compilation,
      savedRelativePath: ARDUINO_SKETCH_RELATIVE_PATH,
    };
  }

  async compileEspHome(input: ValidateEspHomeInput): Promise<CompileEspHomeResult> {
    const validation = await this.validateEspHome(input);
    if (!validation.valid) {
      return {
        validation,
        compilation: {
          outcome: "blocked",
          summary: "Compilation was blocked because the ESPHome configuration is invalid.",
          artifactRelativePaths: [],
        },
      };
    }
    if (validation.nativeValidation === "skipped_unsafe_features") {
      return {
        validation,
        compilation: {
          outcome: "blocked",
          summary:
            "Compilation was blocked because packages, includes, secrets, or external sources require an isolated dependency sandbox.",
          artifactRelativePaths: [],
        },
      };
    }

    const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
    const firmwareDirectory = path.join(projectDirectory, "firmware");
    const configPath = path.join(firmwareDirectory, "esphome.yaml");
    const command = await this.execute({
      executable: "esphome",
      args: ["compile", configPath],
      cwd: firmwareDirectory,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return {
      validation,
      compilation: await executionFromCommand(
        command,
        projectDirectory,
        path.join(projectDirectory, ESPHOME_BUILD_RELATIVE_PATH),
        command.outcome === "passed"
          ? "ESPHome compiled the configuration."
          : command.outcome === "not_available"
            ? "ESPHome is not installed or not available on PATH. Structural validation still ran."
            : "ESPHome failed to compile the configuration.",
      ),
    };
  }

  async runSimulation(input: RunFirmwareSimulationInput): Promise<FirmwareSimulationResult> {
    const targetId = EmbeddedTargetIdSchema.parse(input.targetId);
    const assessment = assessSimulation({
      targetId,
      preferredEngine: input.engine,
      requiredFeatures: ["cpu", "gpio", "uart"],
    });
    if (assessment.selectedEngine.engine !== input.engine) {
      return {
        outcome: "blocked",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary: `${input.engine} does not support the selected target in the pinned capability matrix.`,
        coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
      };
    }
    if (input.engine === "simavr" && targetId !== "arduino_uno_r3") {
      return {
        outcome: "blocked",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary: "simavr execution is available only for the Arduino Uno R3 target.",
        coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
      };
    }

    const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
    if (input.firmwareKind === "esphome") {
      const storedTarget = await readStoredEspHomeTarget(projectDirectory);
      if (storedTarget !== targetId) {
        return {
          outcome: "blocked",
          engine: input.engine,
          targetId,
          firmwareKind: input.firmwareKind,
          assessment,
          summary:
            "The saved ESPHome board does not match the selected simulation target. Validate and compile the matching configuration first.",
          coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
        };
      }
    }
    const artifactRoot =
      input.firmwareKind === "arduino"
        ? path.join(projectDirectory, ARDUINO_BUILD_RELATIVE_PATH, targetId)
        : path.join(projectDirectory, ESPHOME_BUILD_RELATIVE_PATH);
    const artifacts = await listArtifactPaths(projectDirectory, artifactRoot);
    const artifactRelativePath =
      input.engine === "simavr"
        ? (artifacts.find((candidate) => candidate.endsWith(".elf")) ??
          artifacts.find((candidate) => candidate.endsWith(".hex")))
        : selectEspressifFlashArtifact(artifacts);
    if (!artifactRelativePath) {
      return {
        outcome: "blocked",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary:
          input.engine === "simavr"
            ? "No compiled ELF/HEX artifact exists for this firmware and target. Compile it first."
            : "No merged or factory ESP32 flash image exists for this firmware and target. Compile it first.",
        coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
      };
    }
    const artifactPath = path.join(projectDirectory, ...artifactRelativePath.split("/"));

    if (input.engine === "simavr") {
      const virtualDurationMicros = input.virtualDurationMicros ?? 250_000;
      const command = await this.execute({
        executable: "circuit-simavr-trace",
        args: [artifactPath, String(virtualDurationMicros)],
        cwd: path.dirname(artifactPath),
        timeoutMs: 30_000,
      });
      const trace = parseSimavrTraceOutput(command.output);
      const executed = Boolean(
        command.outcome === "passed" && trace && trace.termination !== "cpu_crashed",
      );
      const displayOutput = stripStructuredTrace(command.output);
      return {
        outcome:
          command.outcome === "not_available" ? "not_available" : executed ? "executed" : "failed",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary:
          executed && trace
            ? `simavr executed ${trace.cyclesExecuted.toLocaleString()} processor cycles and captured digital output/UART events for ${trace.requestedDurationMicros.toLocaleString()} µs of virtual time.`
            : command.outcome === "not_available"
              ? "The bundled circuit-simavr-trace runner is unavailable."
              : command.outcome === "timed_out"
                ? "simavr did not finish the requested virtual-time window within the 30-second host-time guard."
                : "simavr failed or did not return a valid versioned signal trace.",
        ...(displayOutput ? { output: displayOutput } : {}),
        firmwareArtifactRelativePath: artifactRelativePath,
        ...(trace ? { trace } : {}),
        coverage: {
          cpuExecution: executed ? "executed" : "not_executed",
          gpioOutputTrace: trace ? "verified" : "unavailable",
          uartOutputTrace: trace ? "verified" : "unavailable",
          circuitAssertions: input.circuit ? "blocked" : "not_requested",
          notes: [
            "Uno GPIO events include only pins observed while configured as digital outputs.",
            "PWM appears as digital transitions; analog voltage/current and external electrical loading are not modeled.",
          ],
        },
      };
    }

    const qemuTarget =
      targetId === "esp32s3" ? { executable: "qemu-system-xtensa", machine: "esp32s3" } : undefined;
    if (!qemuTarget) {
      return {
        outcome: "blocked",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary: "The local QEMU engine has no machine model for this ESP32 target.",
        firmwareArtifactRelativePath: artifactRelativePath,
        coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
      };
    }
    const probe = await this.execute({
      executable: qemuTarget.executable,
      args: ["-machine", "help"],
      cwd: path.dirname(artifactPath),
      timeoutMs: 5_000,
    });
    if (
      probe.outcome === "not_available" ||
      !new RegExp(`^${qemuTarget.machine}\\s`, "m").test(probe.output ?? "")
    ) {
      return {
        outcome: "not_available",
        engine: input.engine,
        targetId,
        firmwareKind: input.firmwareKind,
        assessment,
        summary: `The bundled/local QEMU executable does not contain the required ${qemuTarget.machine} machine model. Generic system QEMU is not accepted as an ESP32 simulator.`,
        firmwareArtifactRelativePath: artifactRelativePath,
        coverage: unavailableFirmwareCoverage(Boolean(input.circuit)),
      };
    }
    const command = await this.execute({
      executable: qemuTarget.executable,
      args: [
        "-nographic",
        "-machine",
        qemuTarget.machine,
        "-drive",
        `file=${artifactPath},if=mtd,format=raw`,
      ],
      cwd: path.dirname(artifactPath),
      timeoutMs: 5_000,
    });
    const executed = command.outcome === "passed" || command.outcome === "timed_out";
    return {
      outcome: executed
        ? "executed"
        : command.outcome === "not_available"
          ? "not_available"
          : "failed",
      engine: input.engine,
      targetId,
      firmwareKind: input.firmwareKind,
      assessment,
      summary: executed
        ? `Local Espressif QEMU executed the ${qemuTarget.machine} firmware for a bounded five-second host-time window. GPIO tracing and external-circuit assertions are unavailable because this pinned machine's GPIO device is a register stub.`
        : command.outcome === "not_available"
          ? "The required local Espressif QEMU executable is not bundled or available."
          : "Local Espressif QEMU exited with a process-level failure.",
      ...(command.output ? { output: command.output } : {}),
      firmwareArtifactRelativePath: artifactRelativePath,
      coverage: {
        cpuExecution: executed ? "executed" : "not_executed",
        gpioOutputTrace: "unsupported",
        uartOutputTrace: executed ? "console_only" : "unavailable",
        circuitAssertions: input.circuit ? "blocked" : "not_requested",
        notes: [
          "ESP32-S3 QEMU UART/ROM console text is captured as process output without structured timestamps.",
          "The pinned QEMU esp32s3 GPIO peripheral implements strap reads only and cannot drive circuit nets.",
        ],
      },
    };
  }

  async validateEspHome(input: ValidateEspHomeInput): Promise<EspHomeValidationResult> {
    const byteSize = Buffer.byteLength(input.yaml);
    if (byteSize === 0 || byteSize > MAX_FIRMWARE_TEXT_BYTES) {
      throw new Error("ESPHome YAML must be between 1 byte and 1 MiB.");
    }
    const projectDirectory = await this.projects.getProjectDirectory(input.projectId);
    const firmwareDirectory = path.join(projectDirectory, "firmware");
    await mkdir(firmwareDirectory, { recursive: true, mode: 0o700 });
    const configPath = path.join(firmwareDirectory, "esphome.yaml");
    await writeFileAtomic(configPath, input.yaml);

    const issues: FirmwareValidationIssue[] = [];
    const parsed = parseDocument(input.yaml, { prettyErrors: true });
    for (const error of parsed.errors) {
      issues.push({
        severity: "error",
        code: "yaml_syntax",
        path: "firmware/esphome.yaml",
        message: error.message.slice(0, 1_000),
      });
    }
    if (parsed.errors.length) {
      return baseResult({ issues, nativeValidation: "not_available" });
    }
    const root = parsed.toJS() as unknown;
    if (!isRecord(root)) {
      issues.push({
        severity: "error",
        code: "yaml_root",
        path: "firmware/esphome.yaml",
        message: "ESPHome configuration must be a top-level mapping.",
      });
      return baseResult({ issues, nativeValidation: "not_available" });
    }
    if (!isRecord(root.esphome)) {
      issues.push({
        severity: "error",
        code: "missing_esphome",
        path: "esphome",
        message: "Add an esphome: block with a device name.",
        documentationUrl: "https://esphome.io/components/esphome/",
      });
    }
    const esp32 = isRecord(root.esp32) ? root.esp32 : undefined;
    const boardId = typeof esp32?.board === "string" ? esp32.board : undefined;
    const board = boardId
      ? catalog.esp32Boards.find((candidate) => candidate.id === boardId)
      : undefined;
    if (!esp32) {
      issues.push({
        severity: "error",
        code: "missing_esp32",
        path: "esp32",
        message: "This harness currently requires an esp32: target block for ESPHome validation.",
        documentationUrl: "https://esphome.io/components/esp32/",
      });
    } else if (!boardId) {
      issues.push({
        severity: "error",
        code: "missing_board",
        path: "esp32.board",
        message: "Select one of the official ESPHome ESP32 board IDs.",
        documentationUrl: "https://esphome.io/components/esp32/",
      });
    } else if (!board) {
      issues.push({
        severity: "error",
        code: "unknown_board",
        path: "esp32.board",
        message: `${boardId} is not present in the pinned official ESPHome board catalog.`,
        documentationUrl: "https://esphome.io/components/esp32/",
      });
    }

    const componentNames = collectComponentNames(root);
    for (const name of componentNames) {
      if (CONFIG_KEYS.has(name)) {
        continue;
      }
      const component = catalog.components.find((candidate) => candidate.name === name);
      if (!component) {
        issues.push({
          severity: "warning",
          code: "unknown_or_external_component",
          path: name,
          message: `${name} is not in the pinned official in-tree catalog. It may be external, misspelled, or newer than the snapshot.`,
        });
      }
    }
    const requiredFeatures = inferFeatures(componentNames);
    const targetId = board?.target;
    const supportedTarget = EmbeddedTargetIdSchema.safeParse(targetId);
    const simulation = supportedTarget.success
      ? assessSimulation({
          targetId: supportedTarget.data,
          requiredFeatures: ["cpu", ...requiredFeatures],
        })
      : undefined;
    if (targetId && !supportedTarget.success) {
      issues.push({
        severity: "warning",
        code: "unsupported_product_target",
        path: "esp32.board",
        message: `${boardId} targets ${targetId}. It remains available in the reference catalog, but this harness executes only ESP32-S3 firmware.`,
        documentationUrl: "https://esphome.io/components/esp32/",
      });
    }
    if (simulation?.unsupportedFeatures.length) {
      issues.push({
        severity: "warning",
        code: "simulation_gap",
        path: "simulation",
        message: `Selected simulation does not cover: ${simulation.unsupportedFeatures.join(", ")}.`,
      });
    }

    const hasUnsafeExpansion =
      "external_components" in root ||
      "packages" in root ||
      /!(?:include|secret)|\bsource:\s*(?:github|git|http|https)/.test(input.yaml);
    let nativeValidation: EspHomeValidationResult["nativeValidation"] = "not_available";
    let nativeOutput: string | undefined;
    if (hasUnsafeExpansion) {
      nativeValidation = "skipped_unsafe_features";
      issues.push({
        severity: "warning",
        code: "native_validation_sandbox_required",
        path: "firmware/esphome.yaml",
        message:
          "Native ESPHome validation was not executed because packages, includes, secrets, or external sources require an isolated dependency sandbox.",
      });
    } else if (!issues.some((issue) => issue.severity === "error")) {
      const native = await this.execute({
        executable: "esphome",
        args: ["config", configPath],
        cwd: firmwareDirectory,
        timeoutMs: 60_000,
      });
      nativeValidation = native.outcome === "timed_out" ? "failed" : native.outcome;
      nativeOutput = native.output;
      if (nativeValidation === "failed") {
        issues.push({
          severity: "error",
          code: "esphome_native_validation",
          path: "firmware/esphome.yaml",
          message: "ESPHome rejected the configuration. Review the native validation output.",
        });
      }
    }

    return {
      valid: !issues.some((issue) => issue.severity === "error") && nativeValidation !== "failed",
      structuralValidation: issues.some((issue) => issue.severity === "error")
        ? "failed"
        : "passed",
      nativeValidation,
      ...(boardId ? { boardId } : {}),
      ...(targetId ? { targetId } : {}),
      detectedComponents: [...componentNames].sort(),
      requiredFeatures,
      ...(simulation ? { simulation } : {}),
      issues,
      ...(nativeOutput ? { nativeOutput } : {}),
      savedRelativePath: "firmware/esphome.yaml",
    };
  }
}

function baseResult(input: {
  readonly issues: readonly FirmwareValidationIssue[];
  readonly nativeValidation: EspHomeValidationResult["nativeValidation"];
}): EspHomeValidationResult {
  return {
    valid: false,
    structuralValidation: "failed",
    nativeValidation: input.nativeValidation,
    detectedComponents: [],
    requiredFeatures: [],
    issues: input.issues,
    savedRelativePath: "firmware/esphome.yaml",
  };
}

function collectComponentNames(root: Record<string, unknown>): Set<string> {
  const names = new Set(Object.keys(root));
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (isRecord(value)) {
      if (typeof value.platform === "string") {
        names.add(value.platform);
      }
      Object.values(value).forEach(visit);
    }
  };
  visit(root);
  return names;
}

function inferFeatures(components: ReadonlySet<string>): EmbeddedFeature[] {
  const features = new Set<EmbeddedFeature>();
  for (const feature of ["gpio", "adc", "pwm", "i2c", "spi", "uart", "wifi"] as const) {
    if (components.has(feature)) {
      features.add(feature);
    }
  }
  if (["esp32_ble", "esp32_ble_tracker", "bluetooth_proxy"].some((name) => components.has(name))) {
    features.add("bluetooth");
  }
  if (["esp32_camera", "esp32_camera_web_server"].some((name) => components.has(name))) {
    features.add("camera");
  }
  return [...features];
}

function validateArduinoSource(source: string): FirmwareValidationIssue[] {
  const issues: FirmwareValidationIssue[] = [];
  if (!/\bvoid\s+setup\s*\(\s*\)/.test(source)) {
    issues.push({
      severity: "error",
      code: "missing_setup",
      path: ARDUINO_SKETCH_RELATIVE_PATH,
      message: "Arduino sketches must define void setup().",
      documentationUrl: "https://docs.arduino.cc/learn/starting-guide/sketches/",
    });
  }
  if (!/\bvoid\s+loop\s*\(\s*\)/.test(source)) {
    issues.push({
      severity: "error",
      code: "missing_loop",
      path: ARDUINO_SKETCH_RELATIVE_PATH,
      message: "Arduino sketches must define void loop().",
      documentationUrl: "https://docs.arduino.cc/learn/starting-guide/sketches/",
    });
  }
  return issues;
}

function inferArduinoFeatures(source: string): EmbeddedFeature[] {
  const rules: ReadonlyArray<readonly [EmbeddedFeature, RegExp]> = [
    ["gpio", /\b(?:pinMode|digitalRead|digitalWrite)\s*\(/],
    ["adc", /\banalogRead\s*\(/],
    ["pwm", /\b(?:analogWrite|ledcWrite)\s*\(/],
    ["i2c", /\bWire\s*\./],
    ["spi", /\bSPI\s*\./],
    ["uart", /\b(?:Serial|Serial\d+)\s*\./],
    ["wifi", /\bWiFi\s*\./],
    ["bluetooth", /\b(?:BLE|BluetoothSerial|NimBLE)/],
    ["ieee802154", /\b(?:Zigbee|IEEE802154|esp_ieee802154)/],
    ["usb", /\b(?:USB|TinyUSB)\b/],
    ["can", /\b(?:CAN|TWAI)\b/],
    ["camera", /\b(?:esp_camera|Camera)\b/],
  ];
  return rules.filter(([, pattern]) => pattern.test(source)).map(([feature]) => feature);
}

async function executionFromCommand(
  command: FirmwareCommandResult,
  projectDirectory: string,
  artifactRoot: string,
  summary: string,
): Promise<FirmwareExecutionResult> {
  return {
    outcome: command.outcome === "timed_out" ? "failed" : command.outcome,
    summary,
    ...(command.output ? { output: command.output } : {}),
    artifactRelativePaths: await listArtifactPaths(projectDirectory, artifactRoot),
  };
}

async function readStoredEspHomeTarget(
  projectDirectory: string,
): Promise<CompileArduinoInput["targetId"] | undefined> {
  try {
    const yaml = await readFile(path.join(projectDirectory, "firmware", "esphome.yaml"), "utf8");
    const parsed = parseDocument(yaml).toJS() as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    const esp32 = parsed.esp32;
    if (!isRecord(esp32) || typeof esp32.board !== "string") {
      return undefined;
    }
    const target = catalog.esp32Boards.find((board) => board.id === esp32.board)?.target;
    const parsedTarget = EmbeddedTargetIdSchema.safeParse(target);
    return parsedTarget.success ? parsedTarget.data : undefined;
  } catch {
    return undefined;
  }
}

async function listArtifactPaths(
  projectDirectory: string,
  artifactRoot: string,
): Promise<string[]> {
  const artifacts: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw reason;
    }
    for (const entry of entries) {
      if (artifacts.length >= 500) {
        return;
      }
      const absolutePath = path.join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        continue;
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath);
      } else if (metadata.isFile()) {
        artifacts.push(path.relative(projectDirectory, absolutePath).split(path.sep).join("/"));
      }
    }
  };
  await visit(artifactRoot);
  return artifacts.sort();
}

function selectEspressifFlashArtifact(artifacts: readonly string[]): string | undefined {
  return (
    artifacts.find((candidate) => candidate.endsWith(".merged.bin")) ??
    artifacts.find((candidate) => candidate.endsWith(".factory.bin")) ??
    artifacts.find(
      (candidate) =>
        candidate.endsWith(".bin") &&
        !/(?:bootloader|partitions|ota_data_initial|littlefs|spiffs)\.bin$/.test(candidate),
    )
  );
}

async function runFirmwareCommand(request: FirmwareCommandRequest): Promise<FirmwareCommandResult> {
  try {
    const result = await execFileAsync(request.executable, [...request.args], {
      cwd: request.cwd,
      encoding: "utf8",
      timeout: request.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
      windowsHide: true,
      env: { PATH: process.env.PATH ?? "", LANG: process.env.LANG ?? "C.UTF-8" },
    });
    return {
      outcome: "passed",
      output: truncateOutput(`${result.stdout}\n${result.stderr}`),
    };
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return { outcome: "not_available" };
    }
    const failure = reason as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    return {
      outcome: failure.killed ? "timed_out" : "failed",
      output: truncateOutput(
        `${failure.stdout ?? ""}\n${failure.stderr ?? ""}\n${failure.message ?? ""}`,
      ),
    };
  }
}

export function assertFirmwareCommandStoragePolicy(request: FirmwareCommandRequest): void {
  if (!path.basename(request.executable).startsWith("qemu-system-")) {
    return;
  }
  const forbidden = request.args.find(
    (argument, index) =>
      argument === "-D" ||
      argument.startsWith("-D") ||
      argument.startsWith("file:") ||
      (request.args[index - 1] === "-chardev" && /(?:^|,)path=|^file,/.test(argument)) ||
      (request.args[index - 1] === "-trace" && /(?:^|,)file=/.test(argument)),
  );
  if (forbidden) {
    throw new Error(
      "Persistent QEMU output is prohibited. Capture bounded stdout/stderr in memory instead.",
    );
  }
}

function truncateOutput(output: string): string {
  const trimmed = output.trim();
  const marker = trimmed.lastIndexOf("CDH_TRACE_V1 ");
  if (marker >= 0) {
    const traceLine = trimmed.slice(marker).split(/\r?\n/, 1)[0] ?? "";
    const preceding = trimmed.slice(0, marker).trim().slice(0, 4_000);
    return preceding ? `${preceding}\n${traceLine}` : traceLine;
  }
  return trimmed.slice(0, 20_000);
}

function stripStructuredTrace(output: string | undefined): string | undefined {
  if (!output) return undefined;
  const marker = output.lastIndexOf("CDH_TRACE_V1 ");
  const display = (marker >= 0 ? output.slice(0, marker) : output).trim();
  return display || undefined;
}

function unavailableFirmwareCoverage(circuitRequested: boolean): FirmwareSimulationCoverage {
  return {
    cpuExecution: "not_executed",
    gpioOutputTrace: "unavailable",
    uartOutputTrace: "unavailable",
    circuitAssertions: circuitRequested ? "blocked" : "not_requested",
    notes: ["No firmware signal claims are available because processor execution did not run."],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
