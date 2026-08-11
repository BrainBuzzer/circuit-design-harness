import type {
  ProjectCapture,
  SaveCameraCaptureInput,
  UpdateCameraPreviewFrameInput,
} from "@shared/capture-contract";

const MAX_FRAME_AGE_MS = 10_000;

interface LiveCameraFrame extends UpdateCameraPreviewFrameInput {
  readonly updatedAt: number;
}

interface CaptureSink {
  save(input: SaveCameraCaptureInput): Promise<ProjectCapture>;
}

export interface AgentCameraCapture {
  readonly capture: ProjectCapture;
  readonly data: string;
  readonly mimeType: "image/jpeg";
}

export class CameraEvidenceService {
  private readonly frames = new Map<string, LiveCameraFrame>();

  constructor(private readonly captures: CaptureSink) {}

  update(input: UpdateCameraPreviewFrameInput): void {
    this.frames.set(input.projectId, {
      ...input,
      jpegBytes: new Uint8Array(input.jpegBytes),
      updatedAt: Date.now(),
    });
  }

  clear(projectId: string): void {
    this.frames.delete(projectId);
  }

  getLatest(projectId: string): UpdateCameraPreviewFrameInput | undefined {
    const frame = this.frames.get(projectId);
    if (!frame || Date.now() - frame.updatedAt > MAX_FRAME_AGE_MS) return undefined;
    const { updatedAt: _updatedAt, ...snapshot } = frame;
    return { ...snapshot, jpegBytes: new Uint8Array(snapshot.jpegBytes) };
  }

  async captureForAgent(projectId: string): Promise<AgentCameraCapture> {
    const frame = this.frames.get(projectId);
    if (!frame || Date.now() - frame.updatedAt > MAX_FRAME_AGE_MS) {
      throw new Error(
        "No current build-camera frame is available. Start a local or LAN camera preview and try again.",
      );
    }
    const capture = await this.captures.save(frame);
    return {
      capture,
      data: Buffer.from(frame.jpegBytes).toString("base64"),
      mimeType: "image/jpeg",
    };
  }
}
