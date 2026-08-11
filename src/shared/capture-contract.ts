import type { CaptureRecord } from "@domain/capture";

export interface SaveCameraCaptureInput {
  readonly projectId: string;
  readonly jpegBytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly expectedCircuitRevision: number;
  readonly deviceLabel: string;
  readonly source: "local_camera" | "remote_camera";
}

export interface RemoteCameraFrameInput {
  readonly url: string;
}

export interface RemoteCameraFrame {
  readonly jpegBytes: Uint8Array;
  readonly endpointLabel: string;
}

export interface UpdateCameraPreviewFrameInput extends SaveCameraCaptureInput {}

export interface StartLanCameraRelayInput {
  readonly projectId: string;
  readonly circuitRevision: number;
}

export interface LanCameraRelayStatus {
  readonly running: boolean;
  readonly connected: boolean;
  readonly pairingUrl?: string;
  readonly qrDataUrl?: string;
  readonly certificateFingerprint?: string;
  readonly latestFrameAt?: string;
  readonly warning?: string;
}

export interface CameraPreviewFrame {
  readonly projectId: string;
  readonly jpegBytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly expectedCircuitRevision: number;
  readonly deviceLabel: string;
  readonly source: "local_camera" | "remote_camera";
}

export type ProjectCapture = CaptureRecord;
