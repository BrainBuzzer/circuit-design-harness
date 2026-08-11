import type { EmbeddedTargetCapability } from "@domain/embedded";
import type {
  EspHomeBoardCatalogEntry,
  EspHomeComponentCatalogEntry,
} from "@domain/esphome-catalog";

export interface EmbeddedToolStatus {
  readonly id: "arduino_cli" | "simavr" | "qemu_xtensa" | "esphome";
  readonly available: boolean;
  readonly version?: string;
  readonly supportedTargets?: readonly string[];
}

export interface EmbeddedCatalogSnapshot {
  readonly schemaVersion: 1;
  readonly esphomeCommit: string;
  readonly documentationCommit: string;
  readonly targets: readonly EmbeddedTargetCapability[];
  readonly boards: readonly EspHomeBoardCatalogEntry[];
  readonly components: readonly EspHomeComponentCatalogEntry[];
  readonly tools: readonly EmbeddedToolStatus[];
}
