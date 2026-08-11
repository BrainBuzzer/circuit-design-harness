import type { ProjectCapture } from "@shared/capture-contract";
import { describe, expect, it, vi } from "vitest";
import { captureBuildCameraEvidence } from "./agent-camera-tools";
import { CameraEvidenceService } from "./camera-evidence-service";

const CAPTURE: ProjectCapture = {
  schemaVersion: 1,
  id: "00000000-0000-4000-8000-000000000099",
  projectId: "00000000-0000-4000-8000-000000000001",
  source: "remote_camera",
  deviceLabel: "Galaxy S23",
  mimeType: "image/jpeg",
  imageRelativePath: "captures/00000000-0000-4000-8000-000000000099/capture.jpg",
  byteSize: 4,
  sha256: "0".repeat(64),
  width: 640,
  height: 480,
  circuitRevision: 3,
  createdAt: "2026-08-09T00:00:00.000Z",
};

describe("CameraEvidenceService", () => {
  it("keeps preview frames ephemeral until an agent camera request saves one", async () => {
    const save = vi.fn(async () => CAPTURE);
    const service = new CameraEvidenceService({ save });
    const frame = {
      projectId: "00000000-0000-4000-8000-000000000001",
      jpegBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      width: 640,
      height: 480,
      expectedCircuitRevision: 3,
      deviceLabel: "Galaxy S23",
      source: "remote_camera" as const,
    };
    service.update(frame);
    expect(save).not.toHaveBeenCalled();

    const result = await service.captureForAgent(frame.projectId);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ deviceLabel: "Galaxy S23" }));
    expect(result.data).toBe(Buffer.from(frame.jpegBytes).toString("base64"));
  });

  it("rejects camera requests after preview consent is cleared", async () => {
    const service = new CameraEvidenceService({ save: vi.fn(async () => CAPTURE) });
    const projectId = "00000000-0000-4000-8000-000000000001";
    service.update({
      projectId,
      jpegBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      width: 1,
      height: 1,
      expectedCircuitRevision: 0,
      deviceLabel: "Camera",
      source: "local_camera",
    });
    service.clear(projectId);
    await expect(service.captureForAgent(projectId)).rejects.toThrow(
      "No current build-camera frame",
    );
  });

  it("uses the same consent gate for deterministic phrase routing and the Pi tool", async () => {
    const projectId = CAPTURE.projectId;
    const save = vi.fn(async () => CAPTURE);
    const service = new CameraEvidenceService({ save });
    service.update({
      projectId,
      jpegBytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      width: 640,
      height: 480,
      expectedCircuitRevision: 3,
      deviceLabel: "Galaxy S23",
      source: "remote_camera",
    });

    await expect(captureBuildCameraEvidence(projectId, service, () => false)).rejects.toThrow(
      "disabled in Harness settings",
    );
    expect(save).not.toHaveBeenCalled();
    await expect(captureBuildCameraEvidence(projectId, service, () => true)).resolves.toMatchObject(
      {
        capture: { id: CAPTURE.id, circuitRevision: 3 },
        mimeType: "image/jpeg",
      },
    );
    expect(save).toHaveBeenCalledOnce();
  });
});
