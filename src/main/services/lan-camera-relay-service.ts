import { randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { createServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import type {
  LanCameraRelayStatus,
  StartLanCameraRelayInput,
  UpdateCameraPreviewFrameInput,
} from "@shared/capture-contract";
import QRCode from "qrcode";
import { generate } from "selfsigned";
import { WebSocket, WebSocketServer } from "ws";

const MAX_FRAME_BYTES = 12 * 1024 * 1024;

interface CameraPreviewSink {
  update(input: UpdateCameraPreviewFrameInput): void;
}

export class LanCameraRelayService {
  private server: HttpsServer | undefined;
  private webSockets: WebSocketServer | undefined;
  private project: StartLanCameraRelayInput | undefined;
  private status: LanCameraRelayStatus = { running: false, connected: false };

  constructor(private readonly cameraEvidence: CameraPreviewSink) {}

  async start(project: StartLanCameraRelayInput): Promise<LanCameraRelayStatus> {
    await this.stop();
    this.project = project;
    const addresses = privateLanIpv4Addresses();
    const advertisedAddress = addresses[0] ?? "127.0.0.1";
    const token = randomBytes(32).toString("base64url");
    const certificate = await generate(
      [{ name: "commonName", value: "Circuit Harness LAN Camera" }],
      {
        algorithm: "sha256",
        keyType: "ec",
        curve: "P-256",
        notAfterDate: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        extensions: [
          { name: "basicConstraints", cA: false },
          { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
          { name: "extKeyUsage", serverAuth: true },
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 7, ip: "127.0.0.1" },
              ...addresses.map((ip) => ({ type: 7 as const, ip })),
            ],
          },
        ],
      },
    );
    const server = createServer(
      { key: certificate.private, cert: certificate.cert },
      (request, response) => {
        const requestUrl = new URL(request.url ?? "/", "https://localhost");
        if (
          request.method !== "GET" ||
          !secureTokenMatches(requestUrl.pathname, `/pair/${token}`)
        ) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src wss:; media-src blob:; base-uri 'none'; form-action 'none'",
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
        response.end(cameraSenderPage(token));
      },
    );
    const webSockets = new WebSocketServer({
      noServer: true,
      maxPayload: MAX_FRAME_BYTES + 8,
      perMessageDeflate: false,
    });
    server.on("upgrade", (request, socket, head) => {
      const requestUrl = new URL(request.url ?? "/", "https://localhost");
      if (!secureTokenMatches(requestUrl.pathname, `/stream/${token}`)) {
        socket.destroy();
        return;
      }
      webSockets.handleUpgrade(request, socket, head, (client) =>
        webSockets.emit("connection", client, request),
      );
    });
    webSockets.on("connection", (client) => {
      for (const existing of webSockets.clients) {
        if (existing !== client && existing.readyState === WebSocket.OPEN)
          existing.close(1008, "A newer camera connected");
      }
      this.status = { ...this.status, connected: true };
      client.on("message", (data, isBinary) => {
        if (!isBinary || !this.project) return;
        try {
          const frame = parseRelayFrame(
            Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer),
          );
          this.cameraEvidence.update({
            projectId: this.project.projectId,
            jpegBytes: frame.jpegBytes,
            width: frame.width,
            height: frame.height,
            expectedCircuitRevision: this.project.circuitRevision,
            deviceLabel: "Paired LAN phone camera",
            source: "remote_camera",
          });
          this.status = { ...this.status, latestFrameAt: new Date().toISOString() };
        } catch {
          client.close(1003, "Invalid camera frame");
        }
      });
      client.on("close", () => {
        this.status = { ...this.status, connected: false };
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => resolve());
    });
    this.server = server;
    this.webSockets = webSockets;
    const port = (server.address() as AddressInfo).port;
    const pairingUrl = `https://${advertisedAddress}:${port}/pair/${token}`;
    this.status = {
      running: true,
      connected: false,
      pairingUrl,
      qrDataUrl: await QRCode.toDataURL(pairingUrl, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 256,
      }),
      certificateFingerprint: new X509Certificate(certificate.cert).fingerprint256,
      ...(!addresses.length
        ? {
            warning:
              "No private IPv4 LAN interface was found. The relay is available only on this Mac.",
          }
        : {
            warning:
              "The relay uses an ephemeral self-signed HTTPS certificate. On the phone, verify the displayed fingerprint and accept the browser warning for this one session.",
          }),
    };
    return this.status;
  }

  setProjectContext(project: StartLanCameraRelayInput): void {
    this.project = project;
  }

  getStatus(): LanCameraRelayStatus {
    return this.status;
  }

  async stop(): Promise<void> {
    this.project = undefined;
    for (const client of this.webSockets?.clients ?? []) client.close(1001, "Relay stopped");
    this.webSockets?.close();
    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
    this.webSockets = undefined;
    this.server = undefined;
    this.status = { running: false, connected: false };
  }
}

export function privateLanIpv4Addresses(): readonly string[] {
  return Object.values(networkInterfaces())
    .flatMap((records) => records ?? [])
    .filter(
      (record) => record.family === "IPv4" && !record.internal && isPrivateIpv4(record.address),
    )
    .map((record) => record.address);
}

export function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

export function parseRelayFrame(bytes: Uint8Array): {
  readonly width: number;
  readonly height: number;
  readonly jpegBytes: Uint8Array;
} {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_FRAME_BYTES + 8)
    throw new Error("Invalid relay frame size.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0, false);
  const height = view.getUint32(4, false);
  const jpegBytes = bytes.subarray(8);
  if (width < 1 || width > 16_384 || height < 1 || height > 16_384)
    throw new Error("Invalid relay dimensions.");
  if (jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8 || jpegBytes[2] !== 0xff)
    throw new Error("Relay frame is not JPEG.");
  return { width, height, jpegBytes: new Uint8Array(jpegBytes) };
}

function secureTokenMatches(actualPath: string, expectedPath: string): boolean {
  const actual = Buffer.from(actualPath);
  const expected = Buffer.from(expectedPath);
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function cameraSenderPage(token: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Circuit Harness Camera</title><style>body{font:16px system-ui;margin:0;background:#0d1117;color:#f0f6fc}main{max-width:720px;margin:auto;padding:20px}video{width:100%;max-height:70vh;background:#000;border-radius:16px}button{font:inherit;padding:12px 18px;border:0;border-radius:10px;background:#2dd4bf;color:#06201d;font-weight:700}.status{color:#9ca3af}</style></head><body><main><h1>Build camera</h1><p class="status" id="status">Tap Start camera. Frames travel only to the paired Circuit Harness on this LAN.</p><video id="preview" autoplay muted playsinline></video><p><button id="start">Start camera</button></p></main><script>const token=${JSON.stringify(token)};const status=document.getElementById('status');const video=document.getElementById('preview');document.getElementById('start').onclick=async()=>{try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});video.srcObject=stream;await video.play();const socket=new WebSocket('wss://'+location.host+'/stream/'+token);socket.binaryType='arraybuffer';socket.onopen=()=>{status.textContent='Connected securely to Circuit Harness.';const canvas=document.createElement('canvas');setInterval(()=>{if(socket.readyState!==WebSocket.OPEN||video.videoWidth<1)return;const scale=Math.min(1,1280/video.videoWidth);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(async blob=>{if(!blob||socket.bufferedAmount>2000000)return;const jpg=new Uint8Array(await blob.arrayBuffer());const packet=new Uint8Array(8+jpg.length);const view=new DataView(packet.buffer);view.setUint32(0,canvas.width);view.setUint32(4,canvas.height);packet.set(jpg,8);socket.send(packet);},'image/jpeg',.82);},500);};socket.onclose=()=>status.textContent='Disconnected. Stop and scan a new pairing code.';}catch(error){status.textContent=error instanceof Error?error.message:'Camera access failed.';}};</script></body></html>`;
}
