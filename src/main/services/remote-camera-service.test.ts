import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { RemoteCameraService } from "./remote-camera-service";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("RemoteCameraService", () => {
  it("fetches a bounded JPEG from an explicit local endpoint", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
    const url = await serve((_, response) => {
      response.writeHead(200, { "content-type": "image/jpeg", "content-length": jpeg.byteLength });
      response.end(jpeg);
    });

    const frame = await new RemoteCameraService().fetchFrame({ url });
    expect(frame.jpegBytes).toEqual(new Uint8Array(jpeg));
    expect(frame.endpointLabel).toMatch(/^127\.0\.0\.1:/);
  });

  it("rejects public hosts, redirects, and non-JPEG payloads", async () => {
    const service = new RemoteCameraService();
    await expect(service.fetchFrame({ url: "https://8.8.8.8/frame.jpg" })).rejects.toThrow(
      "private-LAN",
    );

    const redirectUrl = await serve((_, response) => {
      response.writeHead(302, { location: "http://127.0.0.1/elsewhere" });
      response.end();
    });
    await expect(service.fetchFrame({ url: redirectUrl })).rejects.toThrow("HTTP 302");

    const textUrl = await serve((_, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("not a camera frame");
    });
    await expect(service.fetchFrame({ url: textUrl })).rejects.toThrow("JPEG image data");
  });
});

async function serve(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a local TCP server address.");
  }
  return `http://127.0.0.1:${address.port}/frame.jpg`;
}
