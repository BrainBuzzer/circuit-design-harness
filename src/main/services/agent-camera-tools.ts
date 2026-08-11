import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { AgentCameraCapture, CameraEvidenceService } from "./camera-evidence-service";

export function createAgentCameraTools(
  projectId: string,
  cameraEvidence: CameraEvidenceService,
  cameraCaptureAllowed: () => boolean,
  getCoachStepContext?: () => Promise<string | undefined>,
): ToolDefinition[] {
  return [
    defineTool({
      name: "inspect_build_camera",
      label: "Inspect build camera",
      description:
        "Captures the current local or paired-LAN build-camera frame, saves it as revision-linked project evidence, and returns the actual image for multimodal inspection. Use this immediately when the user says take a look, check the camera, look at this build, or equivalent wording. When a lab lesson step is active, compare against that golden step checklist—not a newly invented circuit.",
      promptSnippet:
        "Capture and inspect the current build-camera frame when the user asks visually.",
      promptGuidelines: [
        "When the user explicitly asks you to look/check/inspect the camera, call inspect_build_camera before answering.",
        "If the current prompt already contains an Automatic build-camera tool capture, inspect that attached frame and do not capture a duplicate.",
        "Describe only visible evidence. A frame cannot establish hidden connectivity, continuity, voltage, current, polarity, or safety.",
        "If lab coach context is present (active lesson step), compare only against that step's referenceSummary and cameraChecklist; call get_lab_coach_status if needed. Do not invent a new netlist.",
        "If no lesson is active, compare visible evidence with the canonical circuit/breadboard read tools when relevant; keep unknown details unknown; prefer suggesting a golden lab lesson for starter kits.",
      ],
      parameters: Type.Object({}),
      execute: async () => {
        const result = await captureBuildCameraEvidence(
          projectId,
          cameraEvidence,
          cameraCaptureAllowed,
        );
        const coachContext = getCoachStepContext ? await getCoachStepContext() : undefined;
        const coachBlock = coachContext
          ? `\n\nActive lab coach step context (golden fixture—compare the image to this step only):\n${coachContext}`
          : "\n\nNo active lab lesson step. Visible evidence only; do not invent a full circuit from the photo.";
        return {
          content: [
            {
              type: "text",
              text: `Captured build-camera evidence ${result.capture.id} at circuit revision ${result.capture.circuitRevision}. Treat it as visible evidence only.${coachBlock}`,
            },
            { type: "image", data: result.data, mimeType: result.mimeType },
          ],
          details: {
            captureId: result.capture.id,
            circuitRevision: result.capture.circuitRevision,
            coachBound: Boolean(coachContext),
          },
        };
      },
    }),
  ];
}

export async function captureBuildCameraEvidence(
  projectId: string,
  cameraEvidence: CameraEvidenceService,
  cameraCaptureAllowed: () => boolean,
): Promise<AgentCameraCapture> {
  if (!cameraCaptureAllowed()) {
    throw new Error(
      "Camera capture for visual requests is disabled in Harness settings. Enable it before asking Eve to inspect the build camera.",
    );
  }
  return cameraEvidence.captureForAgent(projectId);
}

export function requestsBuildCameraInspection(text: string): boolean {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  return (
    /\b(?:take|have)\s+(?:a\s+)?look\b/i.test(normalized) ||
    /\bdoes\s+this(?:\s+(?:design|build|circuit|breadboard))?\s+look\s+(?:correct|right|okay|ok|good)\b/i.test(
      normalized,
    ) ||
    /\b(?:check|inspect|review|look\s+at)\b.{0,60}\b(?:camera|build|breadboard|this)\b/i.test(
      normalized,
    ) ||
    /\b(?:camera|build|breadboard)\b.{0,60}\b(?:check|inspect|review|look)\b/i.test(normalized)
  );
}
