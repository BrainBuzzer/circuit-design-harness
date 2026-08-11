import { describe, expect, it } from "vitest";
import { EmbeddedCatalogService } from "./embedded-catalog-service";

describe("EmbeddedCatalogService", () => {
  it("loads the pinned official ESPHome component and ESP32 board snapshot", async () => {
    const snapshot = await new EmbeddedCatalogService().getSnapshot();
    expect(snapshot.components).toHaveLength(738);
    expect(snapshot.boards).toHaveLength(298);
    expect(new Set(snapshot.boards.map((board) => board.target))).toEqual(
      new Set([
        "esp32",
        "esp32c2",
        "esp32c3",
        "esp32c5",
        "esp32c6",
        "esp32c61",
        "esp32h2",
        "esp32p4",
        "esp32s2",
        "esp32s3",
      ]),
    );
    expect(snapshot.components.find((component) => component.name === "dht")).toMatchObject({
      platforms: ["sensor"],
      documentationUrls: ["https://esphome.io/components/sensor/dht/"],
    });
    expect(snapshot.tools).toHaveLength(4);
    expect(snapshot.tools.map((tool) => tool.id)).not.toContain("qemu_riscv32");
    expect(snapshot.tools.map((tool) => tool.id)).not.toContain("wokwi_cli");
  });
});
