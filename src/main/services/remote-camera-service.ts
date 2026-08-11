import { isIP } from "node:net";
import type { RemoteCameraFrame, RemoteCameraFrameInput } from "@shared/capture-contract";

const MAX_REMOTE_FRAME_BYTES = 12 * 1024 * 1024;
const REMOTE_FRAME_TIMEOUT_MS = 5_000;

export class RemoteCameraService {
  async fetchFrame(input: RemoteCameraFrameInput): Promise<RemoteCameraFrame> {
    const endpoint = validatePrivateCameraEndpoint(input.url);
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { Accept: "image/jpeg" },
      redirect: "manual",
      signal: AbortSignal.timeout(REMOTE_FRAME_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Remote camera returned HTTP ${response.status}.`);
    }
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_FRAME_BYTES) {
      throw new Error("Remote camera frames must be no larger than 12 MB.");
    }
    if (!response.body) {
      throw new Error("Remote camera returned an empty response.");
    }

    const chunks: Uint8Array[] = [];
    let byteSize = 0;
    for await (const chunk of response.body) {
      byteSize += chunk.byteLength;
      if (byteSize > MAX_REMOTE_FRAME_BYTES) {
        await response.body.cancel().catch(() => undefined);
        throw new Error("Remote camera frames must be no larger than 12 MB.");
      }
      chunks.push(chunk);
    }
    if (byteSize < 4) {
      throw new Error("Remote camera returned an empty or invalid JPEG frame.");
    }
    const jpegBytes = new Uint8Array(byteSize);
    let offset = 0;
    for (const chunk of chunks) {
      jpegBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8 || jpegBytes[2] !== 0xff) {
      throw new Error("Remote camera endpoint did not return JPEG image data.");
    }
    return {
      jpegBytes,
      endpointLabel: `${endpoint.hostname}${endpoint.port ? `:${endpoint.port}` : ""}`,
    };
  }
}

function validatePrivateCameraEndpoint(rawUrl: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(rawUrl);
  } catch {
    throw new Error("Enter a complete remote camera URL, including http:// or https://.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("Remote cameras must use an HTTP or HTTPS JPEG endpoint.");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error("Remote camera URLs cannot contain credentials or fragments.");
  }
  const hostname = endpoint.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  if ((ipVersion !== 4 && ipVersion !== 6) || !isPrivateAddress(hostname, ipVersion)) {
    throw new Error("Remote cameras must use a literal private-LAN or loopback IP address.");
  }
  return endpoint;
}

function isPrivateAddress(hostname: string, ipVersion: 4 | 6): boolean {
  if (ipVersion === 4) {
    const [first = -1, second = -1] = hostname.split(".").map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }
  const normalized = hostname.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}
