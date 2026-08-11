import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { isPrivateIpv4, LanCameraRelayService, parseRelayFrame } from "./lan-camera-relay-service";

const runningRelays: LanCameraRelayService[] = [];

afterEach(async () => {
  await Promise.all(runningRelays.splice(0).map((relay) => relay.stop()));
});

describe("LAN camera relay", () => {
  it("allows only private, link-local IPv4 interfaces", () => {
    expect(isPrivateIpv4("192.168.1.20")).toBe(true);
    expect(isPrivateIpv4("172.16.2.3")).toBe(true);
    expect(isPrivateIpv4("10.0.0.2")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
  });

  it("parses bounded dimension-prefixed JPEG frames", () => {
    const packet = new Uint8Array(12);
    const view = new DataView(packet.buffer);
    view.setUint32(0, 640);
    view.setUint32(4, 480);
    packet.set([0xff, 0xd8, 0xff, 0xd9], 8);
    expect(parseRelayFrame(packet)).toMatchObject({ width: 640, height: 480 });
    expect(() => parseRelayFrame(new Uint8Array(12))).toThrow("dimensions");
  });

  it("pairs one encrypted WebSocket camera and forwards a bounded frame", async () => {
    let forwarded:
      | { readonly projectId: string; readonly width: number; readonly height: number }
      | undefined;
    let resolveForwarded: (() => void) | undefined;
    const forwardedPromise = new Promise<void>((resolve) => {
      resolveForwarded = resolve;
    });
    const relay = new LanCameraRelayService({
      update: (input) => {
        forwarded = input;
        resolveForwarded?.();
      },
    });
    runningRelays.push(relay);
    const projectId = "00000000-0000-4000-8000-000000000001";
    const status = await relay.start({ projectId, circuitRevision: 7 });
    expect(status).toMatchObject({ running: true, connected: false });
    expect(status.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(status.certificateFingerprint).toMatch(/^([A-F0-9]{2}:)+[A-F0-9]{2}$/);
    if (!status.pairingUrl) throw new Error("Expected a LAN camera pairing URL.");
    const pairingUrl = new URL(status.pairingUrl);
    const token = pairingUrl.pathname.split("/").at(-1);
    if (!token) throw new Error("Expected a token-scoped pairing URL.");
    const client = new WebSocket(
      `wss://127.0.0.1:${pairingUrl.port}/stream/${encodeURIComponent(token)}`,
      { rejectUnauthorized: false },
    );
    await new Promise<void>((resolve, reject) => {
      client.once("open", resolve);
      client.once("error", reject);
    });
    const packet = new Uint8Array(12);
    const view = new DataView(packet.buffer);
    view.setUint32(0, 640);
    view.setUint32(4, 480);
    packet.set([0xff, 0xd8, 0xff, 0xd9], 8);
    client.send(packet);
    await forwardedPromise;
    expect(forwarded).toMatchObject({ projectId, width: 640, height: 480 });
    expect(relay.getStatus()).toMatchObject({ running: true, connected: true });
    client.close();
    await relay.stop();
    expect(relay.getStatus()).toEqual({ running: false, connected: false });
  });
});
