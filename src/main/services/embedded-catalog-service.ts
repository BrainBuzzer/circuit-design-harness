import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EMBEDDED_TARGET_CAPABILITIES } from "@domain/embedded";
import { EspHomeCatalogSchema } from "@domain/esphome-catalog";
import type { EmbeddedCatalogSnapshot, EmbeddedToolStatus } from "@shared/embedded-contract";
import catalogPayload from "../../catalog/esphome-components.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const catalog = EspHomeCatalogSchema.parse(catalogPayload);

export class EmbeddedCatalogService {
  constructor(
    private readonly resolveExecutable: (name: string) => Promise<string | undefined> = async (
      name,
    ) => name,
  ) {}

  async getSnapshot(): Promise<EmbeddedCatalogSnapshot> {
    const [simavr, qemuXtensa] = await Promise.all([
      this.resolveExecutable("simavr"),
      this.resolveExecutable("qemu-system-xtensa"),
    ]);
    return {
      schemaVersion: 1,
      esphomeCommit: catalog.esphomeCommit,
      documentationCommit: catalog.documentationCommit,
      targets: EMBEDDED_TARGET_CAPABILITIES,
      boards: catalog.esp32Boards,
      components: catalog.components,
      tools: await Promise.all([
        detectTool("arduino_cli", "arduino-cli", ["version"]),
        detectTool("simavr", simavr, ["--help"]),
        detectEspressifQemu("qemu_xtensa", qemuXtensa, ["esp32s3"]),
        detectTool("esphome", "esphome", ["version"]),
      ]),
    };
  }
}

async function detectEspressifQemu(
  id: "qemu_xtensa",
  command: string | undefined,
  machines: readonly string[],
): Promise<EmbeddedToolStatus> {
  if (!command) {
    return { id, available: false, version: "Bundled simulator binary is missing or invalid" };
  }
  try {
    const result = await execFileAsync(command, ["-machine", "help"], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const supportedTargets = machines.filter((machine) =>
      new RegExp(`^${machine}\\s`, "m").test(output),
    );
    const available = supportedTargets.length > 0;
    return {
      id,
      available,
      version: available
        ? `Local Espressif machines: ${supportedTargets.join(", ")}`
        : `Installed QEMU does not contain Espressif machines: ${machines.join(", ")}`,
      ...(available ? { supportedTargets } : {}),
    };
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return { id, available: false };
    }
    return { id, available: false, version: "QEMU machine probe failed" };
  }
}

async function detectTool(
  id: EmbeddedToolStatus["id"],
  command: string | undefined,
  args: readonly string[],
): Promise<EmbeddedToolStatus> {
  if (!command) {
    return { id, available: false };
  }
  try {
    const result = await execFileAsync(command, [...args], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const version = `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 200);
    return { id, available: true, ...(version ? { version } : {}) };
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === "ENOENT") {
      return { id, available: false };
    }
    return { id, available: true, version: "Installed; version probe returned an error" };
  }
}
