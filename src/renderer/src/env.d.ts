import type { CircuitHarnessApi } from "@shared/app-contract";

declare global {
  interface Window {
    circuitHarness: CircuitHarnessApi;
  }
}
